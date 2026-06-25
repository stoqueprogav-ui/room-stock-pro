
-- 1. Optional motivo
ALTER TABLE public.emprestimos ADD COLUMN IF NOT EXISTS motivo_decisao text;
ALTER TABLE public.solicitacoes ADD COLUMN IF NOT EXISTS motivo_decisao text;

-- 2. decidir_emprestimo with optional motivo
DROP FUNCTION IF EXISTS public.decidir_emprestimo(uuid, boolean);
CREATE OR REPLACE FUNCTION public.decidir_emprestimo(_emp uuid, _aprovar boolean, _motivo text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_origem UUID; v_destino UUID;
  v_status public.emprestimo_status;
  v_item RECORD;
  v_saldo_origem INTEGER;
  v_user_sala UUID;
  v_cmp NUMERIC;
  v_total INT := 0;
  v_total_valor NUMERIC := 0;
  v_motivo text := NULLIF(btrim(COALESCE(_motivo,'')), '');
BEGIN
  SELECT sala_origem_id, sala_destino_id, status INTO v_origem, v_destino, v_status
  FROM public.emprestimos WHERE id = _emp;
  IF v_status IS NULL THEN RAISE EXCEPTION 'empréstimo não encontrado'; END IF;
  IF v_status <> 'pendente' THEN RAISE EXCEPTION 'empréstimo já decidido'; END IF;

  v_user_sala := public.get_user_sala(v_user);
  IF NOT (public.has_role(v_user, 'admin') AND v_user_sala = v_origem) THEN
    RAISE EXCEPTION 'apenas o administrador da sala que empresta pode decidir';
  END IF;

  IF NOT _aprovar THEN
    UPDATE public.emprestimos
       SET status='rejeitado', decidido_por=v_user, decidido_em=now(), motivo_decisao=v_motivo
     WHERE id=_emp;
    PERFORM public.log_event('emprestimo.rejeitado','Empréstimo rejeitado','emprestimos', v_origem, 'emprestimo', _emp,
      jsonb_build_object('sala_destino', v_destino, 'motivo', v_motivo));
    RETURN;
  END IF;

  FOR v_item IN SELECT id, produto_id, quantidade FROM public.emprestimo_itens WHERE emprestimo_id = _emp LOOP
    SELECT custo_medio INTO v_cmp FROM public.estoque
      WHERE produto_id = v_item.produto_id AND sala_id = v_origem;
    UPDATE public.estoque SET quantidade = quantidade - v_item.quantidade
    WHERE produto_id = v_item.produto_id AND sala_id = v_origem
    RETURNING quantidade INTO v_saldo_origem;
    IF v_saldo_origem IS NULL THEN RAISE EXCEPTION 'produto sem estoque registrado na origem'; END IF;
    IF v_saldo_origem < 0 THEN RAISE EXCEPTION 'estoque insuficiente na sala origem'; END IF;
    PERFORM public._recalc_estoque_valor(v_item.produto_id, v_origem);

    UPDATE public.emprestimo_itens
       SET valor_unitario_aplicado = COALESCE(v_cmp,0),
           valor_total = ROUND(v_item.quantidade * COALESCE(v_cmp,0), 2)
     WHERE id = v_item.id;

    INSERT INTO public.movimentacoes
      (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos,
       referencia_tipo, referencia_id, observacao,
       custo_unitario_aplicado, valor_financeiro)
    VALUES (v_item.produto_id, v_origem, v_user, 'emprestimo_saida', -v_item.quantidade, v_saldo_origem,
            'emprestimo', _emp, 'empréstimo concedido (saída temporária)',
            COALESCE(v_cmp,0), ROUND(v_item.quantidade * COALESCE(v_cmp,0), 2));

    INSERT INTO public.dividas (sala_devedora_id, sala_credora_id, produto_id, saldo, valor_financeiro)
    VALUES (v_destino, v_origem, v_item.produto_id, v_item.quantidade,
            ROUND(v_item.quantidade * COALESCE(v_cmp,0), 2))
    ON CONFLICT (sala_devedora_id, sala_credora_id, produto_id)
    DO UPDATE SET saldo = public.dividas.saldo + EXCLUDED.saldo,
                  valor_financeiro = public.dividas.valor_financeiro + EXCLUDED.valor_financeiro,
                  updated_at = now();

    v_total := v_total + v_item.quantidade;
    v_total_valor := v_total_valor + ROUND(v_item.quantidade * COALESCE(v_cmp,0), 2);
  END LOOP;

  UPDATE public.emprestimos
     SET status='aprovado', decidido_por=v_user, decidido_em=now(), motivo_decisao=v_motivo
   WHERE id=_emp;
  PERFORM public.log_event('emprestimo.aprovado','Empréstimo aprovado','emprestimos', v_origem, 'emprestimo', _emp,
    jsonb_build_object('sala_destino', v_destino, 'total_unidades', v_total, 'valor_financeiro', v_total_valor, 'motivo', v_motivo));
END;
$function$;

-- 3. decidir_solicitacao with optional motivo
DROP FUNCTION IF EXISTS public.decidir_solicitacao(uuid, boolean);
CREATE OR REPLACE FUNCTION public.decidir_solicitacao(_solic uuid, _aprovar boolean, _motivo text DEFAULT NULL)
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
  v_cmp NUMERIC;
  v_total INT := 0;
  v_total_valor NUMERIC := 0;
  v_motivo text := NULLIF(btrim(COALESCE(_motivo,'')), '');
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN RAISE EXCEPTION 'apenas master'; END IF;
  SELECT status, sala_id, estoque_baixado INTO v_status, v_sala, v_baixado
  FROM public.solicitacoes WHERE id = _solic;
  IF v_status IS NULL THEN RAISE EXCEPTION 'requisição não encontrada'; END IF;
  IF v_status <> 'pendente' THEN RAISE EXCEPTION 'requisição já decidida'; END IF;

  IF _aprovar THEN
    IF NOT v_baixado THEN
      FOR v_item IN SELECT produto_id, quantidade FROM public.solicitacao_itens WHERE solicitacao_id=_solic LOOP
        SELECT custo_medio INTO v_cmp FROM public.estoque
          WHERE produto_id = v_item.produto_id AND sala_id = v_sala;
        UPDATE public.estoque SET quantidade = quantidade - v_item.quantidade
        WHERE produto_id = v_item.produto_id AND sala_id = v_sala
        RETURNING quantidade INTO v_saldo;
        IF v_saldo IS NULL THEN RAISE EXCEPTION 'produto não existe no estoque da sala'; END IF;
        IF v_saldo < 0 THEN RAISE EXCEPTION 'estoque insuficiente para aprovar'; END IF;
        PERFORM public._recalc_estoque_valor(v_item.produto_id, v_sala);
        INSERT INTO public.movimentacoes
          (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos,
           referencia_tipo, referencia_id, custo_unitario_aplicado, valor_financeiro)
        VALUES (v_item.produto_id, v_sala, v_user, 'solicitacao', -v_item.quantidade, v_saldo,
                'solicitacao', _solic, COALESCE(v_cmp,0),
                ROUND(v_item.quantidade * COALESCE(v_cmp,0), 2));
        v_total := v_total + v_item.quantidade;
        v_total_valor := v_total_valor + ROUND(v_item.quantidade * COALESCE(v_cmp,0), 2);
      END LOOP;
    END IF;
    UPDATE public.solicitacoes
       SET status='aprovado', decidido_por=v_user, decidido_em=now(),
           estoque_baixado=true, motivo_decisao=v_motivo
     WHERE id=_solic;
    PERFORM public.log_event('requisicao.aprovada', 'Requisição aprovada', 'requisicoes', v_sala, 'solicitacao', _solic,
      jsonb_build_object('total_unidades', v_total, 'valor_financeiro', v_total_valor, 'motivo', v_motivo));
  ELSE
    IF v_baixado THEN
      FOR v_item IN SELECT produto_id, quantidade FROM public.solicitacao_itens WHERE solicitacao_id=_solic LOOP
        SELECT custo_medio INTO v_cmp FROM public.estoque
          WHERE produto_id = v_item.produto_id AND sala_id = v_sala;
        UPDATE public.estoque SET quantidade = quantidade + v_item.quantidade
        WHERE produto_id = v_item.produto_id AND sala_id = v_sala
        RETURNING quantidade INTO v_saldo;
        PERFORM public._recalc_estoque_valor(v_item.produto_id, v_sala);
        INSERT INTO public.movimentacoes
          (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos,
           referencia_tipo, referencia_id, observacao,
           custo_unitario_aplicado, valor_financeiro)
        VALUES (v_item.produto_id, v_sala, v_user, 'estorno', v_item.quantidade, v_saldo,
                'solicitacao', _solic, 'estorno por rejeição',
                COALESCE(v_cmp,0), ROUND(v_item.quantidade * COALESCE(v_cmp,0), 2));
      END LOOP;
    END IF;
    UPDATE public.solicitacoes
       SET status='rejeitado', decidido_por=v_user, decidido_em=now(),
           estoque_baixado=false, motivo_decisao=v_motivo
     WHERE id=_solic;
    PERFORM public.log_event('requisicao.rejeitada', 'Requisição rejeitada', 'requisicoes', v_sala, 'solicitacao', _solic,
      jsonb_build_object('motivo', v_motivo));
  END IF;
END;
$function$;

-- 4. Replace loan notification trigger with detailed delivery
CREATE OR REPLACE FUNCTION public._tg_notif_emprestimo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_short text;
  v_link text := '/app/emprestimos?id=' || NEW.id::text;
  v_credora_nome text;
  v_devedora_nome text;
  v_msg text;
  v_recipients uuid[];
BEGIN
  v_short := substr(NEW.id::text, 1, 8);

  SELECT nome INTO v_credora_nome FROM public.salas WHERE id = NEW.sala_origem_id;
  SELECT nome INTO v_devedora_nome FROM public.salas WHERE id = NEW.sala_destino_id;

  IF TG_OP = 'INSERT' THEN
    -- Notifica sala credora (quem empresta)
    PERFORM public._notify_sala(NEW.sala_origem_id, 'emprestimo', 'emprestimo.criado',
      'Novo pedido de empréstimo',
      'A sala ' || COALESCE(v_devedora_nome, '—') || ' solicitou um empréstimo (#'||v_short||').',
      v_link, 'emprestimo', NEW.id, NEW.solicitante_id);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    -- Sempre garante que solicitante + membros da sala devedora recebam
    SELECT array_agg(user_id) INTO v_recipients
      FROM public.user_salas WHERE sala_id = NEW.sala_destino_id;
    v_recipients := COALESCE(v_recipients, ARRAY[]::uuid[]) || ARRAY[NEW.solicitante_id];

    IF NEW.status = 'aprovado' THEN
      v_msg := 'Sua solicitação de empréstimo para a sala ' || COALESCE(v_credora_nome, '—') || ' foi aprovada.';
      IF NEW.motivo_decisao IS NOT NULL THEN
        v_msg := v_msg || E'\n\nObservação:\n' || NEW.motivo_decisao;
      END IF;
      PERFORM public._notify_users(v_recipients, 'emprestimo', 'emprestimo.aprovado',
        'Empréstimo aprovado', v_msg, v_link, 'emprestimo', NEW.id, NEW.sala_destino_id, NEW.decidido_por);
      -- Credora (registro de auditoria interno)
      PERFORM public._notify_sala(NEW.sala_origem_id, 'emprestimo', 'emprestimo.aprovado',
        'Empréstimo aprovado',
        'Aprovação registrada para o pedido #'||v_short||' da sala ' || COALESCE(v_devedora_nome, '—') || '.',
        v_link, 'emprestimo', NEW.id, NEW.decidido_por);

    ELSIF NEW.status = 'rejeitado' THEN
      v_msg := 'Sua solicitação de empréstimo para a sala ' || COALESCE(v_credora_nome, '—') || ' foi rejeitada.';
      IF NEW.motivo_decisao IS NOT NULL THEN
        v_msg := v_msg || E'\n\nMotivo:\n' || NEW.motivo_decisao;
      END IF;
      PERFORM public._notify_users(v_recipients, 'emprestimo', 'emprestimo.rejeitado',
        'Empréstimo rejeitado', v_msg, v_link, 'emprestimo', NEW.id, NEW.sala_destino_id, NEW.decidido_por);
      PERFORM public._notify_sala(NEW.sala_origem_id, 'emprestimo', 'emprestimo.rejeitado',
        'Empréstimo rejeitado',
        'Rejeição registrada para o pedido #'||v_short||' da sala ' || COALESCE(v_devedora_nome, '—') || '.',
        v_link, 'emprestimo', NEW.id, NEW.decidido_por);

    ELSIF NEW.status = 'arquivado' THEN
      PERFORM public._notify_users(v_recipients, 'emprestimo', 'emprestimo.arquivado',
        'Empréstimo arquivado',
        'O empréstimo #'||v_short||' com a sala ' || COALESCE(v_credora_nome, '—') || ' foi arquivado.',
        v_link, 'emprestimo', NEW.id, NEW.sala_destino_id, auth.uid());
      PERFORM public._notify_sala(NEW.sala_origem_id, 'emprestimo', 'emprestimo.arquivado',
        'Empréstimo arquivado',
        'O empréstimo #'||v_short||' com a sala ' || COALESCE(v_devedora_nome, '—') || ' foi arquivado.',
        v_link, 'emprestimo', NEW.id, auth.uid());
    END IF;
    RETURN NEW;
  END IF;

  -- Edição enquanto pendente
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'pendente' AND NEW.status = 'pendente'
     AND (OLD.sala_origem_id IS DISTINCT FROM NEW.sala_origem_id
       OR COALESCE(OLD.observacao,'') IS DISTINCT FROM COALESCE(NEW.observacao,'')) THEN
    PERFORM public._notify_sala(NEW.sala_origem_id, 'emprestimo', 'emprestimo.editado',
      'Solicitação de empréstimo alterada',
      'O solicitante editou o pedido (#'||v_short||').', v_link,
      'emprestimo', NEW.id, auth.uid());
    IF OLD.sala_origem_id IS DISTINCT FROM NEW.sala_origem_id THEN
      PERFORM public._notify_sala(OLD.sala_origem_id, 'emprestimo', 'emprestimo.editado',
        'Pedido de empréstimo redirecionado',
        'A sala credora foi alterada (#'||v_short||').', v_link,
        'emprestimo', NEW.id, auth.uid());
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 5. Replace request notification trigger
CREATE OR REPLACE FUNCTION public._tg_notif_solicitacao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_short text;
  v_link text := '/app/minhas-requisicoes?id=' || NEW.id::text;
  v_recipients uuid[];
  v_msg text;
BEGIN
  v_short := substr(NEW.id::text, 1, 8);

  IF TG_OP = 'INSERT' THEN
    PERFORM public._notify_masters(
      'requisicao', 'requisicao.criada',
      'Nova requisição recebida',
      'Aguardando análise (#'||v_short||').',
      '/app/requisicoes?id=' || NEW.id::text,
      'solicitacao', NEW.id, NEW.sala_id, NEW.usuario_id);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT array_agg(user_id) INTO v_recipients
      FROM public.user_salas WHERE sala_id = NEW.sala_id;
    v_recipients := COALESCE(v_recipients, ARRAY[]::uuid[]) || ARRAY[NEW.usuario_id];

    IF NEW.status = 'aprovado' THEN
      v_msg := 'Sua requisição #'||v_short||' foi aprovada.';
      IF NEW.motivo_decisao IS NOT NULL THEN
        v_msg := v_msg || E'\n\nObservação:\n' || NEW.motivo_decisao;
      END IF;
      PERFORM public._notify_users(v_recipients, 'requisicao', 'requisicao.aprovada',
        'Requisição aprovada', v_msg, v_link, 'solicitacao', NEW.id, NEW.sala_id, NEW.decidido_por);

    ELSIF NEW.status = 'rejeitado' THEN
      v_msg := 'Sua requisição #'||v_short||' foi rejeitada.';
      IF NEW.motivo_decisao IS NOT NULL THEN
        v_msg := v_msg || E'\n\nMotivo:\n' || NEW.motivo_decisao;
      END IF;
      PERFORM public._notify_users(v_recipients, 'requisicao', 'requisicao.rejeitada',
        'Requisição rejeitada', v_msg, v_link, 'solicitacao', NEW.id, NEW.sala_id, NEW.decidido_por);

    ELSIF NEW.status = 'arquivado' THEN
      PERFORM public._notify_users(v_recipients, 'requisicao', 'requisicao.arquivada',
        'Requisição arquivada',
        'Sua requisição #'||v_short||' foi concluída e arquivada.',
        v_link, 'solicitacao', NEW.id, NEW.sala_id, NEW.decidido_por);
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
