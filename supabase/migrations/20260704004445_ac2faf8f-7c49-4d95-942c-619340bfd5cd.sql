
-- =============================================================
-- 1) EXCLUSÃO CONTROLADA DE SALAS (com modo _force)
-- =============================================================
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

  -- ============ LIMPEZA CASCATA CONTROLADA (ordem reversa por FK) ============

  -- 1) Empréstimos + itens + devoluções (envolvem a sala como origem OU destino)
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

  -- 2) Dívidas envolvendo a sala
  DELETE FROM public.dividas WHERE sala_credora_id = _sala OR sala_devedora_id = _sala;
  GET DIAGNOSTICS n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('dividas', n);

  -- 3) Solicitações e itens
  WITH s AS (
    SELECT id FROM public.solicitacoes WHERE sala_id = _sala
  ), del_si AS (
    DELETE FROM public.solicitacao_itens WHERE solicitacao_id IN (SELECT id FROM s) RETURNING 1
  ), del_s AS (
    DELETE FROM public.solicitacoes WHERE sala_id = _sala RETURNING 1
  )
  SELECT (SELECT COUNT(*) FROM del_s) INTO n;
  v_deleted := v_deleted || jsonb_build_object('solicitacoes', n);

  -- 4) Consumo interno / entradas de estoque / movimentações / estoque
  DELETE FROM public.consumos_internos WHERE sala_id = _sala;
  GET DIAGNOSTICS n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('consumos_internos', n);

  DELETE FROM public.entradas_estoque WHERE sala_id = _sala;
  GET DIAGNOSTICS n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('entradas_estoque', n);

  DELETE FROM public.movimentacoes WHERE sala_id = _sala;
  GET DIAGNOSTICS n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('movimentacoes', n);

  DELETE FROM public.estoque WHERE sala_id = _sala;
  GET DIAGNOSTICS n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('estoque', n);

  -- 5) Produtos da sala + histórico de custos deles
  --    (após limpar movimentacoes/estoque/consumos/entradas que os referenciam)
  DELETE FROM public.produto_custo_historico
    WHERE produto_id IN (SELECT id FROM public.produtos WHERE sala_id = _sala);
  GET DIAGNOSTICS n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('produto_custo_historico', n);

  DELETE FROM public.produtos WHERE sala_id = _sala;
  GET DIAGNOSTICS n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('produtos', n);

  -- 6) Conversas e mensagens da sala
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

  -- 7) Notificações e estados vinculados à sala
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

  -- 8) Vínculos de usuários com a sala
  DELETE FROM public.user_sala_ativa WHERE sala_id = _sala;
  GET DIAGNOSTICS n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('user_sala_ativa', n);

  DELETE FROM public.user_salas WHERE sala_id = _sala;
  GET DIAGNOSTICS n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('user_salas', n);

  UPDATE public.profiles SET sala_id = NULL WHERE sala_id = _sala;
  GET DIAGNOSTICS n = ROW_COUNT; v_deleted := v_deleted || jsonb_build_object('profiles_desvinculados', n);

  -- 9) Zera referência de sala em logs (mantém histórico de auditoria)
  UPDATE public.system_logs SET sala_id = NULL WHERE sala_id = _sala;

  -- 10) Excluir a própria sala
  DELETE FROM public.salas WHERE id = _sala;

  -- 11) Validação final (não pode restar nenhum órfão apontando para a sala)
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

-- =============================================================
-- 2) RESET GERAL DO SISTEMA — expandido
-- =============================================================
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

  PERFORM public.log_event('sistema.reset.iniciado','Reset total do sistema iniciado','sistema',NULL,NULL,NULL,
    jsonb_build_object('masters_preservados', cardinality(v_master_ids)), v_user);

  v_step := 'snapshot_masters';
  CREATE TEMP TABLE _master_snapshot ON COMMIT DROP AS
    SELECT * FROM public.profiles WHERE id = ANY(v_master_ids);

  -- Notificações e mensagens (não têm dependentes externos, apaga primeiro)
  v_step := 'truncate_notificacoes';
  TRUNCATE TABLE public.notification_states, public.notifications CASCADE;

  v_step := 'truncate_chat';
  TRUNCATE TABLE public.messages, public.conversation_reads, public.conversation_participants, public.conversations CASCADE;

  v_step := 'truncate_devolucoes';
  TRUNCATE TABLE public.devolucao_itens, public.devolucoes CASCADE;

  v_step := 'truncate_emprestimos';
  TRUNCATE TABLE public.emprestimo_itens, public.emprestimos CASCADE;

  v_step := 'truncate_requisicoes';
  TRUNCATE TABLE public.solicitacao_itens, public.solicitacoes CASCADE;

  v_step := 'truncate_operacional';
  TRUNCATE TABLE
    public.consumos_internos,
    public.entradas_estoque,
    public.produto_custo_historico,
    public.dividas,
    public.movimentacoes
  CASCADE;

  v_step := 'truncate_estoques_produtos';
  TRUNCATE TABLE public.estoque, public.produtos, public.produtos_catalogo CASCADE;

  v_step := 'truncate_vinculos_sala';
  TRUNCATE TABLE public.user_sala_ativa, public.user_salas CASCADE;

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

  -- Validação final: nenhum dado operacional deve sobrar
  v_step := 'validacao_final';
  IF EXISTS (SELECT 1 FROM public.salas) OR
     EXISTS (SELECT 1 FROM public.produtos) OR
     EXISTS (SELECT 1 FROM public.produtos_catalogo) OR
     EXISTS (SELECT 1 FROM public.estoque) OR
     EXISTS (SELECT 1 FROM public.movimentacoes) OR
     EXISTS (SELECT 1 FROM public.solicitacoes) OR
     EXISTS (SELECT 1 FROM public.emprestimos) OR
     EXISTS (SELECT 1 FROM public.devolucoes) OR
     EXISTS (SELECT 1 FROM public.dividas) OR
     EXISTS (SELECT 1 FROM public.consumos_internos) OR
     EXISTS (SELECT 1 FROM public.entradas_estoque) OR
     EXISTS (SELECT 1 FROM public.produto_custo_historico) OR
     EXISTS (SELECT 1 FROM public.notifications) OR
     EXISTS (SELECT 1 FROM public.conversations) OR
     EXISTS (SELECT 1 FROM public.user_salas) OR
     EXISTS (SELECT 1 FROM public.user_sala_ativa) OR
     EXISTS (SELECT 1 FROM public.profiles WHERE id <> ALL(v_master_ids)) THEN
    RAISE EXCEPTION 'validação pós-reset falhou: ainda existem dados operacionais';
  END IF;

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
  RETURN jsonb_build_object('success', false, 'step', v_step, 'error', SQLERRM, 'sqlstate', SQLSTATE);
END;
$function$;
