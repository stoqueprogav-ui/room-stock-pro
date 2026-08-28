CREATE OR REPLACE FUNCTION public.eh_master(_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.is_super_master(_user) OR public.has_role(_user,'master'); $$;

GRANT EXECUTE ON FUNCTION public.eh_master(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_access_conversation(_conv uuid, _user uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_type public.conversation_type;
  v_sala uuid;
  v_owner uuid;
  v_req uuid;
  v_emp uuid;
  v_user_sala uuid;
  v_master_audit boolean;
  v_is_master boolean;
  v_is_part boolean;
  v_req_sala uuid;
  v_emp_origem uuid;
  v_emp_destino uuid;
BEGIN
  IF _user IS NULL THEN RETURN false; END IF;

  SELECT type, sala_id, owner_user_id, related_requisicao_id, related_emprestimo_id
    INTO v_type, v_sala, v_owner, v_req, v_emp
    FROM public.conversations WHERE id = _conv;
  IF v_type IS NULL THEN RETURN false; END IF;

  IF public.is_super_master(_user) THEN RETURN true; END IF;

  v_is_master := public.has_role(_user,'master');
  v_user_sala := public.get_user_sala(_user);

  IF v_req IS NOT NULL THEN
    SELECT sala_id INTO v_req_sala FROM public.solicitacoes WHERE id = v_req;
    IF v_is_master THEN RETURN public.master_scope_sala(_user, v_req_sala); END IF;
    RETURN v_user_sala IS NOT NULL AND v_user_sala = v_req_sala;
  END IF;

  IF v_emp IS NOT NULL THEN
    SELECT sala_origem_id, sala_destino_id INTO v_emp_origem, v_emp_destino
      FROM public.emprestimos WHERE id = v_emp;
    IF v_is_master THEN
      RETURN public.master_scope_sala(_user, v_emp_origem)
          OR public.master_scope_sala(_user, v_emp_destino);
    END IF;
    RETURN v_user_sala IS NOT NULL AND v_user_sala IN (v_emp_origem, v_emp_destino);
  END IF;

  IF v_type = 'sala' THEN
    IF v_is_master THEN RETURN public.master_scope_sala(_user, v_sala); END IF;
    RETURN v_user_sala IS NOT NULL AND v_user_sala = v_sala;

  ELSIF v_type = 'master' THEN
    IF v_owner = _user THEN RETURN true; END IF;
    RETURN v_is_master AND public.usuarios_compartilham_regiao(_user, v_owner);

  ELSE
    SELECT EXISTS(SELECT 1 FROM public.conversation_participants
                   WHERE conversation_id = _conv AND user_id = _user)
      INTO v_is_part;
    IF v_is_part THEN RETURN true; END IF;
    IF NOT v_is_master THEN RETURN false; END IF;

    SELECT COALESCE((value)::boolean, false) INTO v_master_audit
      FROM public.app_settings WHERE key = 'master_can_read_all_dms';
    IF NOT COALESCE(v_master_audit, false) THEN RETURN false; END IF;

    RETURN EXISTS (
      SELECT 1 FROM public.conversation_participants p
       WHERE p.conversation_id = _conv
         AND public.usuarios_compartilham_regiao(_user, p.user_id)
    );
  END IF;
END;
$function$;

DROP POLICY IF EXISTS conv_master_all ON public.conversations;
DROP POLICY IF EXISTS conv_super_all ON public.conversations;
CREATE POLICY conv_super_all ON public.conversations
  FOR ALL TO authenticated
  USING (public.is_super_master(auth.uid()))
  WITH CHECK (public.is_super_master(auth.uid()));

DROP POLICY IF EXISTS parts_master ON public.conversation_participants;
DROP POLICY IF EXISTS parts_super_all ON public.conversation_participants;
CREATE POLICY parts_super_all ON public.conversation_participants
  FOR ALL TO authenticated
  USING (public.is_super_master(auth.uid()))
  WITH CHECK (public.is_super_master(auth.uid()));

DROP POLICY IF EXISTS parts_insert_restricted ON public.conversation_participants;
CREATE POLICY parts_insert_restricted ON public.conversation_participants
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_master(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.conversations c
       WHERE c.id = conversation_participants.conversation_id
         AND c.created_by = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.conversation_participants p
       WHERE p.conversation_id = conversation_participants.conversation_id
         AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS conv_insert_auth ON public.conversations;
CREATE POLICY conv_insert_auth ON public.conversations
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (
      sala_id IS NULL
      OR sala_id = public.get_user_sala(auth.uid())
      OR public.master_scope_sala(auth.uid(), sala_id)
    )
  );

DROP POLICY IF EXISTS msg_master_delete ON public.messages;
CREATE POLICY msg_master_delete ON public.messages
  FOR DELETE TO authenticated
  USING (
    public.is_super_master(auth.uid())
    OR (public.has_role(auth.uid(),'master')
        AND public.can_access_conversation(conversation_id, auth.uid()))
  );

DROP POLICY IF EXISTS "chat_anexos_delete_owner_or_master" ON storage.objects;
CREATE POLICY "chat_anexos_delete_owner_or_master" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'chat-anexos'
    AND (
      owner = auth.uid()
      OR public.is_super_master(auth.uid())
      OR public.can_access_conversation((split_part(name,'/',1))::uuid, auth.uid())
    )
  );

DROP POLICY IF EXISTS "chat_anexos_update_owner_or_master" ON storage.objects;
CREATE POLICY "chat_anexos_update_owner_or_master" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'chat-anexos' AND (owner = auth.uid() OR public.is_super_master(auth.uid())))
  WITH CHECK (bucket_id = 'chat-anexos' AND (owner = auth.uid() OR public.is_super_master(auth.uid())));

DROP POLICY IF EXISTS avpat_hist_master_all ON public.avaliacoes_patrimoniais_historico;
CREATE POLICY avpat_hist_master_all ON public.avaliacoes_patrimoniais_historico
  FOR ALL TO authenticated
  USING (public.master_scope_sala(auth.uid(), sala_id))
  WITH CHECK (public.master_scope_sala(auth.uid(), sala_id));

DROP POLICY IF EXISTS "auth read custo historico" ON public.produto_custo_historico;
DROP POLICY IF EXISTS custo_historico_select_scoped ON public.produto_custo_historico;
CREATE POLICY custo_historico_select_scoped ON public.produto_custo_historico
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.produtos p
     WHERE p.id = produto_custo_historico.produto_id
       AND public.user_has_sala_access(auth.uid(), p.sala_id)
  ));

DROP POLICY IF EXISTS app_settings_select_all ON public.app_settings;
DROP POLICY IF EXISTS app_settings_select_scoped ON public.app_settings;
CREATE POLICY app_settings_select_scoped ON public.app_settings
  FOR SELECT TO authenticated
  USING (
    public.is_super_master(auth.uid())
    OR key IN ('logo_url','nome_empresa','tema')
    OR (key = 'master_can_read_all_dms' AND public.eh_master(auth.uid()))
  );

DROP POLICY IF EXISTS categorias_master_all ON public.categorias;
DROP POLICY IF EXISTS categorias_super_write ON public.categorias;
CREATE POLICY categorias_super_write ON public.categorias
  FOR ALL TO authenticated
  USING (public.is_super_master(auth.uid()))
  WITH CHECK (public.is_super_master(auth.uid()));

CREATE OR REPLACE FUNCTION public.listar_minhas_salas()
RETURNS TABLE(sala_id uuid, sala_nome text, ativa boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_active uuid;
  v_count integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  v_active := public.get_user_sala(v_user);

  IF public.eh_master(v_user) THEN
    RETURN QUERY
      SELECT s.id, s.nome, (s.id = v_active)
        FROM public.salas s
       WHERE public.master_scope_sala(v_user, s.id)
       ORDER BY s.nome;
  ELSE
    SELECT count(*) INTO v_count FROM public.user_salas WHERE user_id = v_user;
    RETURN QUERY
      SELECT s.id, s.nome, (s.id = v_active OR (v_active IS NULL AND v_count = 1))
        FROM public.user_salas us
        JOIN public.salas s ON s.id = us.sala_id
       WHERE us.user_id = v_user
       ORDER BY s.nome;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.valor_estoque_por_sala()
RETURNS TABLE(sala_id uuid, sala_nome text, total_itens bigint, itens_sem_valor bigint, valor_total numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.eh_master(auth.uid()) THEN RAISE EXCEPTION 'acesso restrito ao master'; END IF;
  RETURN QUERY
  SELECT s.id, s.nome,
         COALESCE(SUM(e.quantidade_valorizada),0)::bigint,
         COALESCE(SUM(GREATEST(e.quantidade - e.quantidade_valorizada, 0)),0)::bigint,
         COALESCE(SUM(e.valor_total),0)::numeric
    FROM public.salas s
    LEFT JOIN public.estoque e ON e.sala_id = s.id
   WHERE public.master_scope_sala(auth.uid(), s.id)
   GROUP BY s.id, s.nome
   ORDER BY 5 DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.estatisticas_valorizacao()
RETURNS TABLE(produtos_valorizados bigint, produtos_sem_valor bigint, produtos_total bigint,
              percentual_valorizado numeric, itens_valorizados bigint, itens_sem_valor bigint, patrimonio_total numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.eh_master(auth.uid()) THEN RAISE EXCEPTION 'acesso restrito ao master'; END IF;
  RETURN QUERY
  WITH prod AS (
    SELECT p.id, BOOL_OR(COALESCE(e.custo_medio,0) > 0) AS valorizado
      FROM public.produtos p
      LEFT JOIN public.estoque e ON e.produto_id = p.id
     WHERE COALESCE(p.ativo, true) = true
       AND public.user_has_sala_access(auth.uid(), p.sala_id)
     GROUP BY p.id
  ), est AS (
    SELECT
      COALESCE(SUM(quantidade_valorizada),0)::bigint AS itens_val,
      COALESCE(SUM(GREATEST(quantidade - quantidade_valorizada, 0)),0)::bigint AS itens_sv,
      COALESCE(SUM(valor_total),0)::numeric AS patrim
      FROM public.estoque
     WHERE public.user_has_sala_access(auth.uid(), sala_id)
  ), tot AS (
    SELECT COUNT(*)::bigint AS total,
           COUNT(*) FILTER (WHERE valorizado)::bigint AS val
      FROM prod
  )
  SELECT
    (SELECT val FROM tot),
    (SELECT total - val FROM tot),
    (SELECT total FROM tot),
    CASE WHEN (SELECT total FROM tot) = 0 THEN 0
         ELSE ROUND(((SELECT val FROM tot)::numeric * 100) / (SELECT total FROM tot)::numeric, 1)
    END,
    (SELECT itens_val FROM est),
    (SELECT itens_sv FROM est),
    (SELECT patrim FROM est);
END;
$$;

CREATE OR REPLACE FUNCTION public.listar_avaliacoes_patrimoniais(_sala uuid DEFAULT NULL)
RETURNS TABLE(
  id uuid, produto_id uuid, produto_nome text, categoria_nome text,
  sala_id uuid, sala_nome text, quantidade_avaliada integer, quantidade_restante integer,
  valor_unitario numeric, valor_total numeric, tipo text,
  responsavel_id uuid, responsavel_nome text, observacao text,
  created_at timestamptz, updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.eh_master(auth.uid()) THEN RAISE EXCEPTION 'acesso restrito ao master'; END IF;
  IF _sala IS NOT NULL AND NOT public.master_scope_sala(auth.uid(), _sala) THEN
    RAISE EXCEPTION 'sem permissão sobre esta sala';
  END IF;
  RETURN QUERY
  SELECT ap.id, ap.produto_id, p.nome, c.nome, ap.sala_id, s.nome,
         ap.quantidade_avaliada, ap.quantidade_restante,
         ap.valor_unitario, ROUND(ap.quantidade_avaliada * ap.valor_unitario, 2),
         ap.tipo, ap.responsavel_id, pr.nome, ap.observacao,
         ap.created_at, ap.updated_at
    FROM public.avaliacoes_patrimoniais ap
    JOIN public.produtos p ON p.id = ap.produto_id
    JOIN public.salas s ON s.id = ap.sala_id
    LEFT JOIN public.categorias c ON c.id = p.categoria_id
    LEFT JOIN public.profiles pr ON pr.id = ap.responsavel_id
   WHERE (_sala IS NULL OR ap.sala_id = _sala)
     AND public.master_scope_sala(auth.uid(), ap.sala_id)
   ORDER BY ap.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.listar_system_logs(
  _actor uuid DEFAULT NULL, _event_type text DEFAULT NULL,
  _event_category text DEFAULT NULL, _sala uuid DEFAULT NULL,
  _from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL,
  _search text DEFAULT NULL, _cursor timestamptz DEFAULT NULL,
  _limit int DEFAULT 50)
RETURNS SETOF public.system_logs
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.eh_master(auth.uid()) THEN RAISE EXCEPTION 'apenas master'; END IF;
  RETURN QUERY
  SELECT * FROM public.system_logs l
  WHERE (
      public.is_super_master(auth.uid())
      OR (l.sala_id IS NOT NULL AND public.master_scope_sala(auth.uid(), l.sala_id))
    )
    AND (_actor IS NULL OR l.actor_id = _actor)
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

CREATE OR REPLACE FUNCTION public.disponibilidade_produtos(_produto_ids uuid[])
RETURNS TABLE (sala_id uuid, sala_nome text, produto_id uuid, nivel text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_user_sala uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  v_user_sala := public.get_user_sala(v_user);

  RETURN QUERY
  SELECT s.id, s.nome, p.id,
    CASE
      WHEN GREATEST(COALESCE(e.quantidade,0) - COALESCE(e.quantidade_reservada,0), 0) <= 0 THEN 'vermelho'
      WHEN GREATEST(COALESCE(e.quantidade,0) - COALESCE(e.quantidade_reservada,0), 0) <= COALESCE(p.estoque_minimo,0) THEN 'amarelo'
      ELSE 'verde'
    END
  FROM public.salas s
  CROSS JOIN public.produtos p
  LEFT JOIN public.estoque e ON e.sala_id = s.id AND e.produto_id = p.id
  WHERE p.id = ANY(_produto_ids)
    AND p.ativo = true
    AND s.regiao_id IN (SELECT public.user_regioes(v_user))
    AND (v_user_sala IS NULL OR s.id <> v_user_sala)
    AND (p.sala_id IS NULL OR p.sala_id = s.id)
    AND COALESCE(e.ativo, true) = true;
END;
$$;

CREATE OR REPLACE FUNCTION public.catalogo_disponibilidade(
  _catalogo uuid, _quantidade integer DEFAULT 1, _excluir_sala uuid DEFAULT NULL::uuid)
RETURNS TABLE(sala_id uuid, sala_nome text, produto_id uuid, unidade text,
              custo_unitario numeric, quantidade_disponivel integer,
              atende_pct integer, atende_total boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT
    s.id, s.nome, p.id, p.unidade,
    COALESCE(p.custo_unitario, 0),
    GREATEST(COALESCE(e.quantidade,0) - COALESCE(e.quantidade_reservada,0), 0)::int,
    CASE WHEN _quantidade <= 0 THEN 0 ELSE
      LEAST(100, FLOOR(
        (GREATEST(COALESCE(e.quantidade,0) - COALESCE(e.quantidade_reservada,0), 0)::numeric
         / NULLIF(_quantidade,0)) * 100)::int)
    END,
    (GREATEST(COALESCE(e.quantidade,0) - COALESCE(e.quantidade_reservada,0), 0) >= _quantidade)
  FROM public.produtos p
  JOIN public.salas s ON s.id = p.sala_id
  LEFT JOIN public.estoque e ON e.produto_id = p.id AND e.sala_id = p.sala_id
  WHERE p.catalogo_id = _catalogo
    AND p.ativo = true
    AND s.regiao_id IN (SELECT public.user_regioes(auth.uid()))
    AND (_excluir_sala IS NULL OR p.sala_id <> _excluir_sala)
    AND (_excluir_sala IS NULL OR s.regiao_id = public.sala_regiao(_excluir_sala))
  ORDER BY 8 DESC, 7 DESC, s.nome ASC;
$function$;

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
  v_deleted jsonb := '{}'::jsonb;
  n int;
BEGIN
  IF NOT public.master_scope_sala(v_user, _sala) THEN
    RAISE EXCEPTION 'sem permissão sobre esta sala';
  END IF;
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

  WITH e AS (
    SELECT id FROM public.emprestimos
     WHERE sala_origem_id = _sala OR sala_destino_id = _sala
  ), d AS (
    SELECT id FROM public.devolucoes WHERE emprestimo_id IN (SELECT id FROM e)
  ), del_di AS (
    DELETE FROM public.devolucao_itens WHERE devolucao_id IN (SELECT id FROM d) RETURNING 1
  ), del_d AS (
    DELETE FROM public.devolucoes WHERE emprestimo_id IN (SELECT id FROM e) RETURNING 1
  ), del_ei AS (
    DELETE FROM public.emprestimo_itens WHERE emprestimo_id IN (SELECT id FROM e) RETURNING 1
  ), del_e AS (
    DELETE FROM public.emprestimos WHERE id IN (SELECT id FROM e) RETURNING 1
  )
  SELECT (SELECT COUNT(*) FROM del_e) INTO n;
  v_deleted := v_deleted || jsonb_build_object('emprestimos', n);

  DELETE FROM public.dividas WHERE sala_credora_id = _sala OR sala_devedora_id = _sala;
  GET DIAGNOSTICS n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('dividas', n);

  WITH s AS (
    SELECT id FROM public.solicitacoes WHERE sala_id = _sala
  ), del_si AS (
    DELETE FROM public.solicitacao_itens WHERE solicitacao_id IN (SELECT id FROM s) RETURNING 1
  ), del_s AS (
    DELETE FROM public.solicitacoes WHERE sala_id = _sala RETURNING 1
  )
  SELECT (SELECT COUNT(*) FROM del_s) INTO n;
  v_deleted := v_deleted || jsonb_build_object('solicitacoes', n);

  DELETE FROM public.consumos_internos WHERE sala_id = _sala;
  GET DIAGNOSTICS n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('consumos_internos', n);

  DELETE FROM public.entradas_estoque WHERE sala_id = _sala;
  GET DIAGNOSTICS n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('entradas_estoque', n);

  DELETE FROM public.movimentacoes WHERE sala_id = _sala;
  GET DIAGNOSTICS n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('movimentacoes', n);

  DELETE FROM public.estoque WHERE sala_id = _sala;
  GET DIAGNOSTICS n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('estoque', n);

  DELETE FROM public.produto_custo_historico
    WHERE produto_id IN (SELECT id FROM public.produtos WHERE sala_id = _sala);
  GET DIAGNOSTICS n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('produto_custo_historico', n);

  DELETE FROM public.produtos WHERE sala_id = _sala;
  GET DIAGNOSTICS n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('produtos', n);

  WITH c AS (
    SELECT id FROM public.conversations WHERE sala_id = _sala
  ), del_msg AS (
    DELETE FROM public.messages WHERE conversation_id IN (SELECT id FROM c) RETURNING 1
  ), del_reads AS (
    DELETE FROM public.conversation_reads WHERE conversation_id IN (SELECT id FROM c) RETURNING 1
  ), del_parts AS (
    DELETE FROM public.conversation_participants WHERE conversation_id IN (SELECT id FROM c) RETURNING 1
  ), del_c AS (
    DELETE FROM public.conversations WHERE sala_id = _sala RETURNING 1
  )
  SELECT (SELECT COUNT(*) FROM del_c) INTO n;
  v_deleted := v_deleted || jsonb_build_object('conversas', n);

  WITH ns AS (
    SELECT id FROM public.notifications WHERE sala_id = _sala
  ), del_ns AS (
    DELETE FROM public.notification_states WHERE notification_key IN
      (SELECT id::text FROM ns) RETURNING 1
  ), del_n AS (
    DELETE FROM public.notifications WHERE sala_id = _sala RETURNING 1
  )
  SELECT (SELECT COUNT(*) FROM del_n) INTO n;
  v_deleted := v_deleted || jsonb_build_object('notificacoes', n);

  DELETE FROM public.user_sala_ativa WHERE sala_id = _sala;
  GET DIAGNOSTICS n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('user_sala_ativa', n);

  DELETE FROM public.user_salas WHERE sala_id = _sala;
  GET DIAGNOSTICS n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('user_salas', n);

  UPDATE public.profiles SET sala_id = NULL WHERE sala_id = _sala;
  GET DIAGNOSTICS n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('profiles_desvinculados', n);

  UPDATE public.system_logs SET sala_id = NULL WHERE sala_id = _sala;

  DELETE FROM public.salas WHERE id = _sala;

  IF EXISTS (SELECT 1 FROM public.produtos WHERE sala_id = _sala) OR
     EXISTS (SELECT 1 FROM public.estoque WHERE sala_id = _sala) OR
     EXISTS (SELECT 1 FROM public.movimentacoes WHERE sala_id = _sala) OR
     EXISTS (SELECT 1 FROM public.solicitacoes WHERE sala_id = _sala) OR
     EXISTS (SELECT 1 FROM public.emprestimos WHERE sala_origem_id = _sala OR sala_destino_id = _sala) OR
     EXISTS (SELECT 1 FROM public.dividas WHERE sala_credora_id = _sala OR sala_devedora_id = _sala) OR
     EXISTS (SELECT 1 FROM public.notifications WHERE sala_id = _sala) OR
     EXISTS (SELECT 1 FROM public.conversations WHERE sala_id = _sala) OR
     EXISTS (SELECT 1 FROM public.user_salas WHERE sala_id = _sala) OR
     EXISTS (SELECT 1 FROM public.user_sala_ativa WHERE sala_id = _sala) OR
     EXISTS (SELECT 1 FROM public.profiles WHERE sala_id = _sala) THEN
    RAISE EXCEPTION 'validação pós-exclusão falhou: ainda existem registros órfãos referenciando a sala';
  END IF;

  PERFORM public.log_event(
    CASE WHEN _force THEN 'sala.excluida_force' ELSE 'sala.excluida' END,
    'Sala excluída: '||v_nome, 'estrutura', NULL, 'sala', _sala,
    jsonb_build_object(
      'force', _force,
      'nome', v_nome,
      'usuarios_antes', v_usuarios,
      'movimentacoes_antes', v_mov,
      'emprestimos_total_antes', v_emp_total,
      'removidos', v_deleted
    )
  );

  RETURN jsonb_build_object('ok', true, 'nome', v_nome, 'removidos', v_deleted);
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_consumo_interno(
  _sala uuid, _produto uuid, _quantidade integer, _motivo motivo_consumo, _observacao text default null
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_sala uuid;
  v_saldo_atual integer;
  v_saldo integer;
  v_cmp numeric;
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  IF NOT public.master_scope_sala(v_user, _sala) THEN
    RAISE EXCEPTION 'sem permissão para lançar consumo nesta sala';
  END IF;
  IF _quantidade IS NULL OR _quantidade <= 0 THEN RAISE EXCEPTION 'quantidade inválida'; END IF;
  v_sala := _sala;
  IF v_sala IS NULL THEN RAISE EXCEPTION 'sala inválida'; END IF;

  SELECT quantidade, custo_medio INTO v_saldo_atual, v_cmp
    FROM public.estoque WHERE produto_id = _produto AND sala_id = v_sala FOR UPDATE;
  IF v_saldo_atual IS NULL THEN RAISE EXCEPTION 'produto não encontrado no estoque da sala'; END IF;
  IF v_saldo_atual < _quantidade THEN RAISE EXCEPTION 'estoque insuficiente'; END IF;

  PERFORM public.baixar_lotes_fefo(_produto, v_sala, _quantidade);
  SELECT quantidade INTO v_saldo FROM public.estoque WHERE produto_id = _produto AND sala_id = v_sala;

  INSERT INTO public.consumos_internos (sala_id, produto_id, usuario_id, quantidade, motivo, observacao)
  VALUES (v_sala, _produto, v_user, _quantidade, _motivo, _observacao) RETURNING id INTO v_id;

  INSERT INTO public.movimentacoes
    (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos, observacao,
     referencia_tipo, referencia_id, custo_unitario_aplicado, valor_financeiro)
  VALUES (_produto, v_sala, v_user, 'saida', -_quantidade, v_saldo,
          concat('Consumo interno: ', _motivo, coalesce(' — ' || _observacao, '')),
          'consumo_interno', v_id, coalesce(v_cmp,0), coalesce(v_cmp,0) * _quantidade);
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.toggle_produto_sala_ativo(
  _produto_id uuid, _sala_id uuid, _ativo boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _produto_nome text;
  _sala_nome text;
  _status_anterior boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.master_scope_sala(_uid, _sala_id) THEN
    RAISE EXCEPTION 'sem permissão sobre esta sala';
  END IF;

  SELECT ativo INTO _status_anterior
  FROM public.estoque WHERE produto_id = _produto_id AND sala_id = _sala_id;

  IF _ativo THEN
    UPDATE public.produtos SET ativo = true, updated_at = now()
     WHERE id = _produto_id AND ativo = false;
  END IF;

  INSERT INTO public.estoque (produto_id, sala_id, quantidade, ativo)
  VALUES (_produto_id, _sala_id, 0, _ativo)
  ON CONFLICT (produto_id, sala_id) DO UPDATE
    SET ativo = EXCLUDED.ativo, updated_at = now();

  SELECT nome INTO _produto_nome FROM public.produtos WHERE id = _produto_id;
  SELECT nome INTO _sala_nome    FROM public.salas    WHERE id = _sala_id;

  PERFORM public.log_event(
    CASE WHEN _ativo THEN 'produto_sala_ativado' ELSE 'produto_sala_desativado' END,
    CASE WHEN _ativo THEN 'Produto reativado na sala' ELSE 'Produto desativado na sala' END,
    'estoque', _sala_id, 'estoque', _produto_id,
    jsonb_build_object('produto_id', _produto_id, 'produto_nome', _produto_nome,
      'sala_id', _sala_id, 'sala_nome', _sala_nome,
      'status_anterior', COALESCE(_status_anterior, false), 'status_novo', _ativo));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_user_salas(_user uuid, _salas uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_active uuid;
  v_first uuid;
BEGIN
  IF NOT public.master_ve_usuario(auth.uid(), _user) THEN
    RAISE EXCEPTION 'sem permissão sobre este usuário';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(coalesce(_salas, ARRAY[]::uuid[])) sid
     WHERE NOT public.master_scope_sala(auth.uid(), sid)
  ) THEN
    RAISE EXCEPTION 'uma ou mais salas estão fora da sua região';
  END IF;

  DELETE FROM public.user_salas WHERE user_id = _user;
  IF coalesce(array_length(_salas, 1), 0) > 0 THEN
    INSERT INTO public.user_salas (user_id, sala_id)
    SELECT _user, unnest(_salas)
    ON CONFLICT DO NOTHING;
  END IF;

  SELECT sala_id INTO v_active FROM public.user_sala_ativa WHERE user_id = _user;
  IF coalesce(array_length(_salas, 1), 0) = 0 THEN
    DELETE FROM public.user_sala_ativa WHERE user_id = _user;
  ELSIF v_active IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_salas WHERE user_id = _user AND sala_id = v_active
  ) THEN
    SELECT sala_id INTO v_first FROM public.user_salas WHERE user_id = _user ORDER BY created_at LIMIT 1;
    INSERT INTO public.user_sala_ativa (user_id, sala_id, updated_at)
    VALUES (_user, v_first, now())
    ON CONFLICT (user_id) DO UPDATE SET sala_id = EXCLUDED.sala_id, updated_at = now();
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public._notify_masters(
  _category text, _event_type text, _title text, _body text,
  _link text, _entity_type text, _entity_id uuid, _sala_id uuid, _actor_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_ids uuid[];
BEGIN
  SELECT array_agg(DISTINCT ur.user_id) INTO v_ids
    FROM public.user_roles ur
   WHERE ur.role IN ('master'::public.app_role, 'super_master'::public.app_role)
     AND (
       public.is_super_master(ur.user_id)
       OR _sala_id IS NULL
       OR public.user_has_regiao_access(ur.user_id, public.sala_regiao(_sala_id))
     );
  PERFORM public._notify_users(COALESCE(v_ids, ARRAY[]::uuid[]),
    _category, _event_type, _title, _body, _link, _entity_type, _entity_id, _sala_id, _actor_id);
END;
$$;