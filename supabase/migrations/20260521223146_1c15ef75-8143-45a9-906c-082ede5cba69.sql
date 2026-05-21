-- 1) Remove duplicated overloads (1-arg) causing "could not choose the best candidate function" errors
DROP FUNCTION IF EXISTS public.arquivar_solicitacao(uuid);
DROP FUNCTION IF EXISTS public.arquivar_emprestimo(uuid);

-- 2) Block archiving approved loans while there are pending returns;
--    keep withdrawal fields optional (defaults) for compatibility with current frontend.
CREATE OR REPLACE FUNCTION public.arquivar_emprestimo(
  _emp uuid,
  _retirado_por text DEFAULT NULL,
  _retirado_em timestamp with time zone DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_status public.emprestimo_status;
  v_pendente integer;
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN
    RAISE EXCEPTION 'apenas master pode arquivar empréstimos';
  END IF;

  SELECT status INTO v_status FROM public.emprestimos WHERE id = _emp;
  IF v_status IS NULL THEN RAISE EXCEPTION 'empréstimo não encontrado'; END IF;
  IF v_status NOT IN ('aprovado','rejeitado') THEN
    RAISE EXCEPTION 'só é possível arquivar empréstimos já decididos';
  END IF;

  IF v_status = 'aprovado' THEN
    SELECT COALESCE(SUM(quantidade - quantidade_devolvida), 0)
      INTO v_pendente
      FROM public.emprestimo_itens
     WHERE emprestimo_id = _emp;
    IF v_pendente > 0 THEN
      RAISE EXCEPTION 'não é possível arquivar: ainda existem % unidade(s) pendentes de devolução', v_pendente;
    END IF;
  END IF;

  UPDATE public.emprestimos
     SET status = 'arquivado',
         retirado_por = COALESCE(_retirado_por, retirado_por),
         retirado_em  = COALESCE(_retirado_em, retirado_em)
   WHERE id = _emp;
END;
$function$;

-- 3) Restrict registrar_devolucao to MASTER only
CREATE OR REPLACE FUNCTION public.registrar_devolucao(
  _emp uuid,
  _itens jsonb,
  _observacao text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_origem uuid;
  v_destino uuid;
  v_status public.emprestimo_status;
  v_dev uuid;
  v_item jsonb;
  v_emp_item RECORD;
  v_qtd integer;
  v_pendente integer;
  v_saldo_destino integer;
  v_saldo_origem integer;
  v_total_pendente integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  IF NOT public.has_role(v_user, 'master') THEN
    RAISE EXCEPTION 'apenas master pode registrar devoluções';
  END IF;

  SELECT sala_origem_id, sala_destino_id, status INTO v_origem, v_destino, v_status
  FROM public.emprestimos WHERE id = _emp;
  IF v_status IS NULL THEN RAISE EXCEPTION 'empréstimo não encontrado'; END IF;
  IF v_status <> 'aprovado' THEN RAISE EXCEPTION 'só é possível devolver empréstimos aprovados'; END IF;

  INSERT INTO public.devolucoes (emprestimo_id, usuario_id, observacao)
  VALUES (_emp, v_user, _observacao) RETURNING id INTO v_dev;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_itens) LOOP
    v_qtd := (v_item->>'quantidade')::integer;
    IF v_qtd IS NULL OR v_qtd <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_emp_item
    FROM public.emprestimo_itens
    WHERE id = (v_item->>'emprestimo_item_id')::uuid AND emprestimo_id = _emp;

    IF v_emp_item.id IS NULL THEN RAISE EXCEPTION 'item do empréstimo não encontrado'; END IF;

    v_pendente := v_emp_item.quantidade - v_emp_item.quantidade_devolvida;
    IF v_qtd > v_pendente THEN
      RAISE EXCEPTION 'quantidade devolvida (%) maior que pendente (%)', v_qtd, v_pendente;
    END IF;

    UPDATE public.estoque SET quantidade = quantidade - v_qtd
      WHERE produto_id = v_emp_item.produto_id AND sala_id = v_destino
      RETURNING quantidade INTO v_saldo_destino;
    IF v_saldo_destino IS NULL THEN RAISE EXCEPTION 'estoque destino não encontrado'; END IF;
    IF v_saldo_destino < 0 THEN RAISE EXCEPTION 'estoque insuficiente para devolver'; END IF;

    INSERT INTO public.movimentacoes (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos, referencia_tipo, referencia_id, observacao)
    VALUES (v_emp_item.produto_id, v_destino, v_user, 'emprestimo_saida', -v_qtd, v_saldo_destino, 'devolucao', v_dev, 'devolução ao credor');

    UPDATE public.estoque SET quantidade = quantidade + v_qtd
      WHERE produto_id = v_emp_item.produto_id AND sala_id = v_origem
      RETURNING quantidade INTO v_saldo_origem;
    IF v_saldo_origem IS NULL THEN
      INSERT INTO public.estoque (produto_id, sala_id, quantidade) VALUES (v_emp_item.produto_id, v_origem, v_qtd)
      RETURNING quantidade INTO v_saldo_origem;
    END IF;

    INSERT INTO public.movimentacoes (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos, referencia_tipo, referencia_id, observacao)
    VALUES (v_emp_item.produto_id, v_origem, v_user, 'emprestimo_entrada', v_qtd, v_saldo_origem, 'devolucao', v_dev, 'devolução recebida');

    UPDATE public.emprestimo_itens
       SET quantidade_devolvida = quantidade_devolvida + v_qtd
     WHERE id = v_emp_item.id;

    UPDATE public.dividas
       SET saldo = GREATEST(saldo - v_qtd, 0), updated_at = now()
     WHERE sala_devedora_id = v_destino
       AND sala_credora_id = v_origem
       AND produto_id = v_emp_item.produto_id;
    DELETE FROM public.dividas
     WHERE sala_devedora_id = v_destino
       AND sala_credora_id = v_origem
       AND produto_id = v_emp_item.produto_id
       AND saldo <= 0;

    INSERT INTO public.devolucao_itens (devolucao_id, emprestimo_item_id, produto_id, quantidade)
    VALUES (v_dev, v_emp_item.id, v_emp_item.produto_id, v_qtd);
  END LOOP;

  -- não arquiva automaticamente; master decide quando arquivar
  RETURN v_dev;
END;
$function$;