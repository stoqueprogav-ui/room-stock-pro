-- ============================================================
-- 1) Tabela system_logs (append-only)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.system_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  actor_nome text,
  actor_email text,
  event_type text NOT NULL,
  event_category text NOT NULL DEFAULT 'geral',
  sala_id uuid,
  entity_type text,
  entity_id uuid,
  description text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_system_logs_created_at ON public.system_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_logs_actor ON public.system_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_system_logs_event_type ON public.system_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_system_logs_sala ON public.system_logs(sala_id);
CREATE INDEX IF NOT EXISTS idx_system_logs_entity ON public.system_logs(entity_type, entity_id);

ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS system_logs_select_master ON public.system_logs;
CREATE POLICY system_logs_select_master ON public.system_logs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'master'));

-- Sem INSERT/UPDATE/DELETE policies → tabela imutável via API.
-- A escrita acontece apenas via função SECURITY DEFINER log_event.

-- ============================================================
-- 2) log_event: função interna para gravar eventos
-- ============================================================
CREATE OR REPLACE FUNCTION public.log_event(
  _event_type text,
  _description text,
  _event_category text DEFAULT 'geral',
  _sala_id uuid DEFAULT NULL,
  _entity_type text DEFAULT NULL,
  _entity_id uuid DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb,
  _actor_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := COALESCE(_actor_id, auth.uid());
  v_nome text;
  v_email text;
  v_id uuid;
BEGIN
  IF v_actor IS NOT NULL THEN
    SELECT nome, email INTO v_nome, v_email FROM public.profiles WHERE id = v_actor;
  END IF;
  INSERT INTO public.system_logs (
    actor_id, actor_nome, actor_email, event_type, event_category,
    sala_id, entity_type, entity_id, description, metadata
  ) VALUES (
    v_actor, v_nome, v_email, _event_type, COALESCE(_event_category,'geral'),
    _sala_id, _entity_type, _entity_id, _description, COALESCE(_metadata,'{}'::jsonb)
  ) RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  -- Auditoria nunca quebra a operação principal
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.log_event(text, text, text, uuid, text, uuid, jsonb, uuid) FROM public, anon, authenticated;

-- ============================================================
-- 3) listar_system_logs: leitura paginada para Master
-- ============================================================
CREATE OR REPLACE FUNCTION public.listar_system_logs(
  _actor uuid DEFAULT NULL,
  _event_type text DEFAULT NULL,
  _event_category text DEFAULT NULL,
  _sala uuid DEFAULT NULL,
  _from timestamptz DEFAULT NULL,
  _to timestamptz DEFAULT NULL,
  _search text DEFAULT NULL,
  _cursor timestamptz DEFAULT NULL,
  _limit int DEFAULT 50
) RETURNS SETOF public.system_logs
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'master') THEN
    RAISE EXCEPTION 'apenas master';
  END IF;
  RETURN QUERY
  SELECT * FROM public.system_logs l
  WHERE (_actor IS NULL OR l.actor_id = _actor)
    AND (_event_type IS NULL OR l.event_type = _event_type)
    AND (_event_category IS NULL OR l.event_category = _event_category)
    AND (_sala IS NULL OR l.sala_id = _sala)
    AND (_from IS NULL OR l.created_at >= _from)
    AND (_to IS NULL OR l.created_at <= _to)
    AND (_cursor IS NULL OR l.created_at < _cursor)
    AND (
      _search IS NULL OR _search = ''
      OR l.description ILIKE '%'||_search||'%'
      OR l.actor_nome ILIKE '%'||_search||'%'
      OR l.actor_email ILIKE '%'||_search||'%'
    )
  ORDER BY l.created_at DESC
  LIMIT LEAST(GREATEST(_limit,1), 200);
END;
$$;

GRANT EXECUTE ON FUNCTION public.listar_system_logs(uuid, text, text, uuid, timestamptz, timestamptz, text, timestamptz, int) TO authenticated;

-- ============================================================
-- 4) Instrumentação das RPCs críticas
-- ============================================================

-- 4.1 decidir_solicitacao
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
  v_total INT := 0;
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN RAISE EXCEPTION 'apenas master'; END IF;
  SELECT status, sala_id, estoque_baixado INTO v_status, v_sala, v_baixado
  FROM public.solicitacoes WHERE id = _solic;
  IF v_status IS NULL THEN RAISE EXCEPTION 'requisição não encontrada'; END IF;
  IF v_status <> 'pendente' THEN RAISE EXCEPTION 'requisição já decidida'; END IF;

  IF _aprovar THEN
    IF NOT v_baixado THEN
      FOR v_item IN SELECT produto_id, quantidade FROM public.solicitacao_itens WHERE solicitacao_id=_solic LOOP
        UPDATE public.estoque SET quantidade = quantidade - v_item.quantidade
        WHERE produto_id = v_item.produto_id AND sala_id = v_sala
        RETURNING quantidade INTO v_saldo;
        IF v_saldo IS NULL THEN RAISE EXCEPTION 'produto não existe no estoque da sala'; END IF;
        IF v_saldo < 0 THEN RAISE EXCEPTION 'estoque insuficiente para aprovar'; END IF;
        INSERT INTO public.movimentacoes (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos, referencia_tipo, referencia_id)
        VALUES (v_item.produto_id, v_sala, v_user, 'solicitacao', -v_item.quantidade, v_saldo, 'solicitacao', _solic);
        v_total := v_total + v_item.quantidade;
      END LOOP;
    END IF;
    UPDATE public.solicitacoes SET status='aprovado', decidido_por=v_user, decidido_em=now(), estoque_baixado=true WHERE id=_solic;
    PERFORM public.log_event('requisicao.aprovada', 'Requisição aprovada', 'requisicoes', v_sala, 'solicitacao', _solic, jsonb_build_object('total_unidades', v_total));
  ELSE
    IF v_baixado THEN
      FOR v_item IN SELECT produto_id, quantidade FROM public.solicitacao_itens WHERE solicitacao_id=_solic LOOP
        UPDATE public.estoque SET quantidade = quantidade + v_item.quantidade
        WHERE produto_id = v_item.produto_id AND sala_id = v_sala
        RETURNING quantidade INTO v_saldo;
        INSERT INTO public.movimentacoes (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos, referencia_tipo, referencia_id, observacao)
        VALUES (v_item.produto_id, v_sala, v_user, 'estorno', v_item.quantidade, v_saldo, 'solicitacao', _solic, 'estorno por rejeição');
      END LOOP;
    END IF;
    UPDATE public.solicitacoes SET status='rejeitado', decidido_por=v_user, decidido_em=now(), estoque_baixado=false WHERE id=_solic;
    PERFORM public.log_event('requisicao.rejeitada', 'Requisição rejeitada', 'requisicoes', v_sala, 'solicitacao', _solic, '{}'::jsonb);
  END IF;
END;
$function$;

-- 4.2 decidir_emprestimo
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
  v_user_sala UUID;
  v_total INT := 0;
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
    UPDATE public.emprestimos SET status='rejeitado', decidido_por=v_user, decidido_em=now() WHERE id=_emp;
    PERFORM public.log_event('emprestimo.rejeitado','Empréstimo rejeitado','emprestimos', v_origem, 'emprestimo', _emp,
      jsonb_build_object('sala_destino', v_destino));
    RETURN;
  END IF;

  FOR v_item IN SELECT produto_id, quantidade FROM public.emprestimo_itens WHERE emprestimo_id = _emp LOOP
    UPDATE public.estoque SET quantidade = quantidade - v_item.quantidade
    WHERE produto_id = v_item.produto_id AND sala_id = v_origem
    RETURNING quantidade INTO v_saldo_origem;
    IF v_saldo_origem IS NULL THEN RAISE EXCEPTION 'produto sem estoque registrado na origem'; END IF;
    IF v_saldo_origem < 0 THEN RAISE EXCEPTION 'estoque insuficiente na sala origem'; END IF;
    INSERT INTO public.movimentacoes (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos, referencia_tipo, referencia_id, observacao)
    VALUES (v_item.produto_id, v_origem, v_user, 'emprestimo_saida', -v_item.quantidade, v_saldo_origem, 'emprestimo', _emp, 'empréstimo concedido (saída temporária)');
    INSERT INTO public.dividas (sala_devedora_id, sala_credora_id, produto_id, saldo)
    VALUES (v_destino, v_origem, v_item.produto_id, v_item.quantidade)
    ON CONFLICT (sala_devedora_id, sala_credora_id, produto_id)
    DO UPDATE SET saldo = public.dividas.saldo + EXCLUDED.saldo, updated_at = now();
    v_total := v_total + v_item.quantidade;
  END LOOP;

  UPDATE public.emprestimos SET status='aprovado', decidido_por=v_user, decidido_em=now() WHERE id=_emp;
  PERFORM public.log_event('emprestimo.aprovado','Empréstimo aprovado','emprestimos', v_origem, 'emprestimo', _emp,
    jsonb_build_object('sala_destino', v_destino, 'total_unidades', v_total));
END;
$function$;

-- 4.3 registrar_devolucao
CREATE OR REPLACE FUNCTION public.registrar_devolucao(_emp uuid, _itens jsonb, _observacao text DEFAULT NULL::text)
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
  v_saldo_origem integer;
  v_total int := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  IF NOT public.has_role(v_user, 'master') THEN RAISE EXCEPTION 'apenas master pode registrar devoluções'; END IF;

  SELECT sala_origem_id, sala_destino_id, status INTO v_origem, v_destino, v_status
  FROM public.emprestimos WHERE id = _emp;
  IF v_status IS NULL THEN RAISE EXCEPTION 'empréstimo não encontrado'; END IF;
  IF v_status <> 'aprovado' THEN RAISE EXCEPTION 'só é possível devolver empréstimos aprovados'; END IF;

  INSERT INTO public.devolucoes (emprestimo_id, usuario_id, observacao)
  VALUES (_emp, v_user, _observacao) RETURNING id INTO v_dev;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_itens) LOOP
    v_qtd := (v_item->>'quantidade')::integer;
    IF v_qtd IS NULL OR v_qtd <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_emp_item FROM public.emprestimo_itens
    WHERE id = (v_item->>'emprestimo_item_id')::uuid AND emprestimo_id = _emp;
    IF v_emp_item.id IS NULL THEN RAISE EXCEPTION 'item do empréstimo não encontrado'; END IF;

    v_pendente := v_emp_item.quantidade - v_emp_item.quantidade_devolvida;
    IF v_qtd > v_pendente THEN RAISE EXCEPTION 'quantidade devolvida (%) maior que pendente (%)', v_qtd, v_pendente; END IF;

    UPDATE public.estoque SET quantidade = quantidade + v_qtd
      WHERE produto_id = v_emp_item.produto_id AND sala_id = v_origem
      RETURNING quantidade INTO v_saldo_origem;
    IF v_saldo_origem IS NULL THEN
      INSERT INTO public.estoque (produto_id, sala_id, quantidade) VALUES (v_emp_item.produto_id, v_origem, v_qtd)
      RETURNING quantidade INTO v_saldo_origem;
    END IF;
    INSERT INTO public.movimentacoes (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos, referencia_tipo, referencia_id, observacao)
    VALUES (v_emp_item.produto_id, v_origem, v_user, 'emprestimo_entrada', v_qtd, v_saldo_origem, 'devolucao', v_dev, 'devolução recebida do devedor');
    UPDATE public.emprestimo_itens SET quantidade_devolvida = quantidade_devolvida + v_qtd WHERE id = v_emp_item.id;
    UPDATE public.dividas SET saldo = GREATEST(saldo - v_qtd, 0), updated_at = now()
      WHERE sala_devedora_id = v_destino AND sala_credora_id = v_origem AND produto_id = v_emp_item.produto_id;
    DELETE FROM public.dividas
      WHERE sala_devedora_id = v_destino AND sala_credora_id = v_origem AND produto_id = v_emp_item.produto_id AND saldo <= 0;
    INSERT INTO public.devolucao_itens (devolucao_id, emprestimo_item_id, produto_id, quantidade)
    VALUES (v_dev, v_emp_item.id, v_emp_item.produto_id, v_qtd);
    v_total := v_total + v_qtd;
  END LOOP;

  PERFORM public.log_event('devolucao.registrada','Devolução registrada','emprestimos', v_origem, 'devolucao', v_dev,
    jsonb_build_object('emprestimo_id', _emp, 'sala_destino', v_destino, 'total_unidades', v_total));
  RETURN v_dev;
END;
$function$;

-- 4.4 ajustar_estoque
CREATE OR REPLACE FUNCTION public.ajustar_estoque(_produto uuid, _sala uuid, _quantidade integer, _observacao text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_atual INTEGER;
  v_diff INTEGER;
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN RAISE EXCEPTION 'apenas master'; END IF;
  SELECT quantidade INTO v_atual FROM public.estoque WHERE produto_id=_produto AND sala_id=_sala;
  IF v_atual IS NULL THEN
    INSERT INTO public.estoque (produto_id, sala_id, quantidade) VALUES (_produto, _sala, _quantidade);
    v_diff := _quantidade; v_atual := _quantidade;
  ELSE
    v_diff := _quantidade - v_atual;
    UPDATE public.estoque SET quantidade=_quantidade WHERE produto_id=_produto AND sala_id=_sala;
    v_atual := _quantidade;
  END IF;
  INSERT INTO public.movimentacoes (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos, observacao)
  VALUES (_produto, _sala, v_user, 'ajuste', v_diff, v_atual, _observacao);
  PERFORM public.log_event('estoque.ajustado','Ajuste manual de estoque','estoque', _sala, 'produto', _produto,
    jsonb_build_object('diferenca', v_diff, 'saldo_final', v_atual, 'observacao', _observacao));
  RETURN v_atual;
END;
$function$;

-- 4.5 criar_emprestimo
CREATE OR REPLACE FUNCTION public.criar_emprestimo(_sala_origem uuid, _itens jsonb, _observacao text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_sala_destino UUID;
  v_emp UUID;
  v_item JSONB;
  v_total INT := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  v_sala_destino := public.get_user_sala(v_user);
  IF v_sala_destino IS NULL THEN RAISE EXCEPTION 'usuário sem sala'; END IF;
  IF v_sala_destino = _sala_origem THEN RAISE EXCEPTION 'salas iguais'; END IF;

  INSERT INTO public.emprestimos (solicitante_id, sala_origem_id, sala_destino_id, observacao)
  VALUES (v_user, _sala_origem, v_sala_destino, _observacao) RETURNING id INTO v_emp;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_itens) LOOP
    INSERT INTO public.emprestimo_itens (emprestimo_id, produto_id, quantidade)
    VALUES (v_emp, (v_item->>'produto_id')::UUID, (v_item->>'quantidade')::INTEGER);
    v_total := v_total + (v_item->>'quantidade')::int;
  END LOOP;

  PERFORM public.log_event('emprestimo.criado','Empréstimo solicitado','emprestimos', _sala_origem, 'emprestimo', v_emp,
    jsonb_build_object('sala_destino', v_sala_destino, 'total_unidades', v_total));
  RETURN v_emp;
END;
$function$;

-- 4.6 quitar_divida
CREATE OR REPLACE FUNCTION public.quitar_divida(_divida uuid, _quantidade integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_saldo INTEGER;
  v_sd uuid; v_sc uuid; v_prod uuid;
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN RAISE EXCEPTION 'apenas master'; END IF;
  SELECT saldo, sala_devedora_id, sala_credora_id, produto_id INTO v_saldo, v_sd, v_sc, v_prod
    FROM public.dividas WHERE id=_divida;
  IF v_saldo IS NULL THEN RAISE EXCEPTION 'dívida não encontrada'; END IF;
  IF _quantidade <= 0 OR _quantidade > v_saldo THEN RAISE EXCEPTION 'quantidade inválida'; END IF;
  IF _quantidade = v_saldo THEN
    DELETE FROM public.dividas WHERE id=_divida;
  ELSE
    UPDATE public.dividas SET saldo = saldo - _quantidade, updated_at = now() WHERE id=_divida;
  END IF;
  PERFORM public.log_event('divida.quitada','Dívida quitada manualmente','dividas', v_sd, 'divida', _divida,
    jsonb_build_object('quantidade', _quantidade, 'sala_credora', v_sc, 'produto_id', v_prod, 'quitacao_total', _quantidade = v_saldo));
END;
$function$;

-- 4.7 reset_sistema_total
CREATE OR REPLACE FUNCTION public.reset_sistema_total(_caller uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := COALESCE(_caller, auth.uid());
  v_master_ids uuid[] := ARRAY[]::uuid[];
  v_step text := 'inicio';
  v_deleted jsonb := '{}'::jsonb;
BEGIN
  IF v_user IS NULL OR NOT public.has_role(v_user, 'master') THEN
    RAISE EXCEPTION 'apenas master pode resetar o sistema';
  END IF;
  SELECT COALESCE(array_agg(user_id), ARRAY[]::uuid[]) INTO v_master_ids
  FROM public.user_roles WHERE role = 'master';
  IF NOT (v_user = ANY(v_master_ids)) THEN
    RAISE EXCEPTION 'master não encontrado para preservação';
  END IF;

  -- log antes (porque o reset NÃO trunca system_logs)
  PERFORM public.log_event('sistema.reset.iniciado','Reset total do sistema iniciado','sistema',NULL,NULL,NULL,
    jsonb_build_object('masters_preservados', cardinality(v_master_ids)), v_user);

  v_step := 'snapshot_masters';
  CREATE TEMP TABLE _master_snapshot ON COMMIT DROP AS
    SELECT * FROM public.profiles WHERE id = ANY(v_master_ids);

  v_step := 'truncate_chat';
  TRUNCATE TABLE public.messages, public.conversation_reads, public.conversation_participants, public.conversations CASCADE;
  v_step := 'truncate_devolucoes';
  TRUNCATE TABLE public.devolucao_itens, public.devolucoes CASCADE;
  v_step := 'truncate_emprestimos';
  TRUNCATE TABLE public.emprestimo_itens, public.emprestimos CASCADE;
  v_step := 'truncate_requisicoes';
  TRUNCATE TABLE public.solicitacao_itens, public.solicitacoes CASCADE;
  v_step := 'truncate_movimentacoes_dividas';
  TRUNCATE TABLE public.dividas, public.movimentacoes CASCADE;
  v_step := 'truncate_estoques_produtos';
  TRUNCATE TABLE public.estoque, public.produtos CASCADE;
  v_step := 'truncate_estrutura';
  TRUNCATE TABLE public.categorias, public.salas CASCADE;

  v_step := 'remover_usuarios_nao_master';
  DELETE FROM public.user_roles WHERE role <> 'master';

  v_step := 'restaurar_master_profiles';
  INSERT INTO public.profiles (id, nome, email, sala_id, must_change_password, created_at, updated_at)
  SELECT id, nome, email, NULL, false, COALESCE(created_at, now()), now()
    FROM _master_snapshot
  ON CONFLICT (id) DO UPDATE SET sala_id = NULL, updated_at = now();

  v_step := 'restaurar_master_auth_users';
  INSERT INTO public.profiles (id, nome, email, sala_id, must_change_password)
  SELECT u.id,
         COALESCE(u.raw_user_meta_data->>'nome', split_part(u.email,'@',1)),
         u.email, NULL, false
    FROM auth.users u
   WHERE u.id = ANY(v_master_ids)
  ON CONFLICT (id) DO NOTHING;

  v_step := 'seed_categorias';
  PERFORM public.seed_categorias_padrao();

  v_step := 'finalizado';
  PERFORM public.log_event('sistema.reset.concluido','Reset total do sistema concluído','sistema',NULL,NULL,NULL,
    jsonb_build_object('masters_preservados', cardinality(v_master_ids)), v_user);

  RETURN jsonb_build_object(
    'success', true, 'step', v_step, 'deleted', v_deleted,
    'master_ids', v_master_ids, 'kept_masters', cardinality(v_master_ids)
  );
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_event('sistema.reset.erro','Reset falhou: '||SQLERRM,'sistema',NULL,NULL,NULL,
    jsonb_build_object('step', v_step, 'sqlstate', SQLSTATE), v_user);
  RETURN jsonb_build_object('success', false, 'step', v_step, 'error', SQLERRM, 'sqlstate', SQLSTATE, 'deleted', v_deleted);
END;
$function$;

-- 4.8 excluir_sala
CREATE OR REPLACE FUNCTION public.excluir_sala(_sala uuid, _force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_usuarios int; v_estoque int; v_solic_pend int; v_emp_pend int; v_emp_total int; v_mov int;
  v_nome text;
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN RAISE EXCEPTION 'apenas master'; END IF;
  SELECT nome INTO v_nome FROM public.salas WHERE id = _sala;
  IF v_nome IS NULL THEN RAISE EXCEPTION 'sala não encontrada'; END IF;

  SELECT COUNT(*) INTO v_usuarios FROM public.profiles WHERE sala_id = _sala;
  SELECT COUNT(*) INTO v_estoque FROM public.estoque WHERE sala_id = _sala AND quantidade > 0;
  SELECT COUNT(*) INTO v_solic_pend FROM public.solicitacoes WHERE sala_id = _sala AND status = 'pendente';
  SELECT COUNT(*) INTO v_emp_pend FROM public.emprestimos
    WHERE (sala_origem_id = _sala OR sala_destino_id = _sala) AND status = 'pendente';
  SELECT COUNT(*) INTO v_emp_total FROM public.emprestimos WHERE sala_origem_id = _sala OR sala_destino_id = _sala;
  SELECT COUNT(*) INTO v_mov FROM public.movimentacoes WHERE sala_id = _sala;

  IF NOT _force THEN
    IF v_usuarios > 0 OR v_estoque > 0 OR v_solic_pend > 0 OR v_emp_pend > 0 OR v_emp_total > 0 OR v_mov > 0 THEN
      RETURN jsonb_build_object('ok', false, 'has_deps', true,
        'usuarios', v_usuarios, 'estoque', v_estoque,
        'solicitacoes_pendentes', v_solic_pend, 'emprestimos_pendentes', v_emp_pend,
        'emprestimos_total', v_emp_total, 'movimentacoes', v_mov);
    END IF;
  END IF;

  UPDATE public.profiles SET sala_id = NULL WHERE sala_id = _sala;
  DELETE FROM public.salas WHERE id = _sala;

  PERFORM public.log_event(
    CASE WHEN _force THEN 'sala.excluida_force' ELSE 'sala.excluida' END,
    'Sala excluída: '||v_nome, 'estrutura', _sala, 'sala', _sala,
    jsonb_build_object('force', _force, 'usuarios', v_usuarios, 'movimentacoes', v_mov, 'emprestimos_total', v_emp_total));

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- 4.9 excluir_produto
CREATE OR REPLACE FUNCTION public.excluir_produto(_produto uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_tem_mov BOOLEAN; v_tem_solic BOOLEAN; v_tem_emp BOOLEAN; v_tem_estoque BOOLEAN;
  v_nome text; v_sala uuid;
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN RAISE EXCEPTION 'apenas master pode excluir produtos'; END IF;
  SELECT nome, sala_id INTO v_nome, v_sala FROM public.produtos WHERE id = _produto;
  SELECT EXISTS(SELECT 1 FROM public.movimentacoes WHERE produto_id=_produto) INTO v_tem_mov;
  SELECT EXISTS(SELECT 1 FROM public.solicitacao_itens WHERE produto_id=_produto) INTO v_tem_solic;
  SELECT EXISTS(SELECT 1 FROM public.emprestimo_itens WHERE produto_id=_produto) INTO v_tem_emp;
  SELECT EXISTS(SELECT 1 FROM public.estoque WHERE produto_id=_produto AND quantidade > 0) INTO v_tem_estoque;

  IF v_tem_mov OR v_tem_solic OR v_tem_emp OR v_tem_estoque THEN
    UPDATE public.produtos SET ativo = false, updated_at = now() WHERE id = _produto;
    PERFORM public.log_event('produto.desativado','Produto desativado: '||COALESCE(v_nome,'?'),'catalogo', v_sala, 'produto', _produto, '{}'::jsonb);
    RETURN jsonb_build_object('modo', 'desativado', 'mensagem', 'Produto desativado (possui histórico ou estoque). Histórico preservado.');
  ELSE
    DELETE FROM public.estoque WHERE produto_id = _produto;
    DELETE FROM public.produtos WHERE id = _produto;
    PERFORM public.log_event('produto.excluido','Produto excluído: '||COALESCE(v_nome,'?'),'catalogo', v_sala, 'produto', _produto, '{}'::jsonb);
    RETURN jsonb_build_object('modo', 'excluido', 'mensagem', 'Produto excluído permanentemente.');
  END IF;
END;
$function$;

-- 4.10 arquivar_solicitacao
CREATE OR REPLACE FUNCTION public.arquivar_solicitacao(_solic uuid, _retirado_por text DEFAULT NULL::text, _retirado_em timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_status public.solicitacao_status;
  v_sala uuid;
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN RAISE EXCEPTION 'apenas master'; END IF;
  SELECT status, sala_id INTO v_status, v_sala FROM public.solicitacoes WHERE id=_solic;
  IF v_status IS NULL THEN RAISE EXCEPTION 'requisição não encontrada'; END IF;
  IF v_status NOT IN ('aprovado','rejeitado') THEN RAISE EXCEPTION 'só é possível arquivar requisições já decididas'; END IF;
  IF v_status = 'aprovado' THEN
    IF _retirado_por IS NULL OR length(trim(_retirado_por)) = 0 THEN RAISE EXCEPTION 'informe quem retirou o pedido'; END IF;
    IF _retirado_em IS NULL THEN RAISE EXCEPTION 'informe a data de retirada'; END IF;
  END IF;
  UPDATE public.solicitacoes
     SET status='arquivado',
         retirado_por = COALESCE(_retirado_por, retirado_por),
         retirado_em  = COALESCE(_retirado_em, retirado_em)
   WHERE id=_solic;
  PERFORM public.log_event('requisicao.arquivada','Requisição arquivada','requisicoes', v_sala, 'solicitacao', _solic,
    jsonb_build_object('retirado_por', _retirado_por));
END;
$function$;

-- 4.11 arquivar_emprestimo
CREATE OR REPLACE FUNCTION public.arquivar_emprestimo(_emp uuid, _retirado_por text DEFAULT NULL::text, _retirado_em timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_status public.emprestimo_status;
  v_pendente integer;
  v_origem uuid;
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN RAISE EXCEPTION 'apenas master pode arquivar empréstimos'; END IF;
  SELECT status, sala_origem_id INTO v_status, v_origem FROM public.emprestimos WHERE id = _emp;
  IF v_status IS NULL THEN RAISE EXCEPTION 'empréstimo não encontrado'; END IF;
  IF v_status NOT IN ('aprovado','rejeitado') THEN RAISE EXCEPTION 'só é possível arquivar empréstimos já decididos'; END IF;
  IF v_status = 'aprovado' THEN
    SELECT COALESCE(SUM(quantidade - quantidade_devolvida), 0) INTO v_pendente
      FROM public.emprestimo_itens WHERE emprestimo_id = _emp;
    IF v_pendente > 0 THEN
      RAISE EXCEPTION 'não é possível arquivar: ainda existem % unidade(s) pendentes de devolução', v_pendente;
    END IF;
  END IF;
  UPDATE public.emprestimos
     SET status = 'arquivado',
         retirado_por = COALESCE(_retirado_por, retirado_por),
         retirado_em  = COALESCE(_retirado_em, retirado_em)
   WHERE id = _emp;
  PERFORM public.log_event('emprestimo.arquivado','Empréstimo arquivado','emprestimos', v_origem, 'emprestimo', _emp,
    jsonb_build_object('retirado_por', _retirado_por));
END;
$function$;