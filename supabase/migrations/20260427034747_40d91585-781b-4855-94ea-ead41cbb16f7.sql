-- 1. Adicionar 'arquivado' aos enums de status
ALTER TYPE public.solicitacao_status ADD VALUE IF NOT EXISTS 'arquivado';
ALTER TYPE public.emprestimo_status ADD VALUE IF NOT EXISTS 'arquivado';

-- 2. Marcar requisições existentes como "estoque já baixado" (legado)
ALTER TABLE public.solicitacoes
  ADD COLUMN IF NOT EXISTS estoque_baixado boolean NOT NULL DEFAULT false;

-- Backfill: tudo que já existe hoje teve baixa imediata
UPDATE public.solicitacoes SET estoque_baixado = true WHERE estoque_baixado = false;

-- 3. Nova versão: criar_solicitacao SEM baixa de estoque
CREATE OR REPLACE FUNCTION public.criar_solicitacao(_itens jsonb, _observacao text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_sala UUID;
  v_solic UUID;
  v_item JSONB;
  v_qtd INTEGER;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  v_sala := public.get_user_sala(v_user);
  IF v_sala IS NULL THEN RAISE EXCEPTION 'usuário sem sala'; END IF;

  INSERT INTO public.solicitacoes (usuario_id, sala_id, observacao, estoque_baixado)
  VALUES (v_user, v_sala, _observacao, false) RETURNING id INTO v_solic;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_itens) LOOP
    v_qtd := (v_item->>'quantidade')::INTEGER;
    IF v_qtd <= 0 THEN RAISE EXCEPTION 'quantidade inválida'; END IF;

    INSERT INTO public.solicitacao_itens (solicitacao_id, produto_id, quantidade)
    VALUES (v_solic, (v_item->>'produto_id')::UUID, v_qtd);
  END LOOP;

  RETURN v_solic;
END;
$function$;

-- 4. Nova versão: decidir_solicitacao baixa estoque NA APROVAÇÃO (se ainda não baixado)
CREATE OR REPLACE FUNCTION public.decidir_solicitacao(_solic uuid, _aprovar boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_sala UUID;
  v_status public.solicitacao_status;
  v_baixado BOOLEAN;
  v_item RECORD;
  v_saldo INTEGER;
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN RAISE EXCEPTION 'apenas master'; END IF;

  SELECT status, sala_id, estoque_baixado INTO v_status, v_sala, v_baixado
  FROM public.solicitacoes WHERE id = _solic;
  IF v_status IS NULL THEN RAISE EXCEPTION 'requisição não encontrada'; END IF;
  IF v_status <> 'pendente' THEN RAISE EXCEPTION 'requisição já decidida'; END IF;

  IF _aprovar THEN
    -- Se ainda não baixou (fluxo novo), baixa agora
    IF NOT v_baixado THEN
      FOR v_item IN SELECT produto_id, quantidade FROM public.solicitacao_itens WHERE solicitacao_id=_solic LOOP
        UPDATE public.estoque SET quantidade = quantidade - v_item.quantidade
        WHERE produto_id = v_item.produto_id AND sala_id = v_sala
        RETURNING quantidade INTO v_saldo;

        IF v_saldo IS NULL THEN RAISE EXCEPTION 'produto não existe no estoque da sala'; END IF;
        IF v_saldo < 0 THEN RAISE EXCEPTION 'estoque insuficiente para aprovar'; END IF;

        INSERT INTO public.movimentacoes (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos, referencia_tipo, referencia_id)
        VALUES (v_item.produto_id, v_sala, v_user, 'solicitacao', -v_item.quantidade, v_saldo, 'solicitacao', _solic);
      END LOOP;
    END IF;

    UPDATE public.solicitacoes
       SET status='aprovado', decidido_por=v_user, decidido_em=now(), estoque_baixado=true
     WHERE id=_solic;
  ELSE
    -- Rejeição: só estorna se já tinha baixado (legado)
    IF v_baixado THEN
      FOR v_item IN SELECT produto_id, quantidade FROM public.solicitacao_itens WHERE solicitacao_id=_solic LOOP
        UPDATE public.estoque SET quantidade = quantidade + v_item.quantidade
        WHERE produto_id = v_item.produto_id AND sala_id = v_sala
        RETURNING quantidade INTO v_saldo;

        INSERT INTO public.movimentacoes (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos, referencia_tipo, referencia_id, observacao)
        VALUES (v_item.produto_id, v_sala, v_user, 'estorno', v_item.quantidade, v_saldo, 'solicitacao', _solic, 'estorno por rejeição');
      END LOOP;
    END IF;
    UPDATE public.solicitacoes
       SET status='rejeitado', decidido_por=v_user, decidido_em=now(), estoque_baixado=false
     WHERE id=_solic;
  END IF;
END;
$function$;

-- 5. Função para arquivar requisição (apenas master, e apenas se já decidida)
CREATE OR REPLACE FUNCTION public.arquivar_solicitacao(_solic uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_status public.solicitacao_status;
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN RAISE EXCEPTION 'apenas master'; END IF;
  SELECT status INTO v_status FROM public.solicitacoes WHERE id=_solic;
  IF v_status IS NULL THEN RAISE EXCEPTION 'requisição não encontrada'; END IF;
  IF v_status NOT IN ('aprovado','rejeitado') THEN RAISE EXCEPTION 'só é possível arquivar requisições já decididas'; END IF;
  UPDATE public.solicitacoes SET status='arquivado' WHERE id=_solic;
END;
$function$;

-- 6. Empréstimo: apenas admin da sala origem aprova (Master perde permissão de decidir)
CREATE OR REPLACE FUNCTION public.decidir_emprestimo(_emp uuid, _aprovar boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_origem UUID;
  v_destino UUID;
  v_status public.emprestimo_status;
  v_item RECORD;
  v_saldo_origem INTEGER;
  v_saldo_destino INTEGER;
  v_user_sala UUID;
BEGIN
  SELECT sala_origem_id, sala_destino_id, status INTO v_origem, v_destino, v_status
  FROM public.emprestimos WHERE id = _emp;
  IF v_status IS NULL THEN RAISE EXCEPTION 'empréstimo não encontrado'; END IF;
  IF v_status <> 'pendente' THEN RAISE EXCEPTION 'empréstimo já decidido'; END IF;

  v_user_sala := public.get_user_sala(v_user);
  -- Apenas admin da sala origem
  IF NOT (public.has_role(v_user, 'admin') AND v_user_sala = v_origem) THEN
    RAISE EXCEPTION 'apenas o administrador da sala que empresta pode decidir';
  END IF;

  IF NOT _aprovar THEN
    UPDATE public.emprestimos SET status='rejeitado', decidido_por=v_user, decidido_em=now() WHERE id=_emp;
    RETURN;
  END IF;

  FOR v_item IN SELECT produto_id, quantidade FROM public.emprestimo_itens WHERE emprestimo_id = _emp LOOP
    UPDATE public.estoque SET quantidade = quantidade - v_item.quantidade
    WHERE produto_id = v_item.produto_id AND sala_id = v_origem
    RETURNING quantidade INTO v_saldo_origem;
    IF v_saldo_origem IS NULL THEN RAISE EXCEPTION 'produto sem estoque registrado na origem'; END IF;
    IF v_saldo_origem < 0 THEN RAISE EXCEPTION 'estoque insuficiente na sala origem'; END IF;

    INSERT INTO public.movimentacoes (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos, referencia_tipo, referencia_id)
    VALUES (v_item.produto_id, v_origem, v_user, 'emprestimo_saida', -v_item.quantidade, v_saldo_origem, 'emprestimo', _emp);

    UPDATE public.estoque SET quantidade = quantidade + v_item.quantidade
    WHERE produto_id = v_item.produto_id AND sala_id = v_destino
    RETURNING quantidade INTO v_saldo_destino;
    IF v_saldo_destino IS NULL THEN
      INSERT INTO public.estoque (produto_id, sala_id, quantidade) VALUES (v_item.produto_id, v_destino, v_item.quantidade)
      RETURNING quantidade INTO v_saldo_destino;
    END IF;

    INSERT INTO public.movimentacoes (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos, referencia_tipo, referencia_id)
    VALUES (v_item.produto_id, v_destino, v_user, 'emprestimo_entrada', v_item.quantidade, v_saldo_destino, 'emprestimo', _emp);

    INSERT INTO public.dividas (sala_devedora_id, sala_credora_id, produto_id, saldo)
    VALUES (v_destino, v_origem, v_item.produto_id, v_item.quantidade)
    ON CONFLICT (sala_devedora_id, sala_credora_id, produto_id)
    DO UPDATE SET saldo = public.dividas.saldo + EXCLUDED.saldo, updated_at = now();
  END LOOP;

  UPDATE public.emprestimos SET status='aprovado', decidido_por=v_user, decidido_em=now() WHERE id=_emp;
END;
$function$;

-- 7. Arquivar empréstimo (apenas master, apenas se já decidido)
CREATE OR REPLACE FUNCTION public.arquivar_emprestimo(_emp uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_status public.emprestimo_status;
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN RAISE EXCEPTION 'apenas master'; END IF;
  SELECT status INTO v_status FROM public.emprestimos WHERE id=_emp;
  IF v_status IS NULL THEN RAISE EXCEPTION 'empréstimo não encontrado'; END IF;
  IF v_status NOT IN ('aprovado','rejeitado') THEN RAISE EXCEPTION 'só é possível arquivar empréstimos já decididos'; END IF;
  UPDATE public.emprestimos SET status='arquivado' WHERE id=_emp;
END;
$function$;