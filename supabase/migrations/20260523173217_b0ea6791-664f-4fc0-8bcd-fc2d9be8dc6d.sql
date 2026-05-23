CREATE OR REPLACE FUNCTION public.reset_sistema_total(_caller uuid DEFAULT NULL)
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
  v_count bigint := 0;
BEGIN
  IF v_user IS NULL OR NOT public.has_role(v_user, 'master') THEN
    RAISE EXCEPTION 'apenas master pode resetar o sistema';
  END IF;

  SELECT COALESCE(array_agg(user_id), ARRAY[]::uuid[]) INTO v_master_ids
  FROM public.user_roles
  WHERE role = 'master';

  IF NOT (v_user = ANY(v_master_ids)) THEN
    RAISE EXCEPTION 'master não encontrado para preservação';
  END IF;

  -- A chamada RPC inteira roda em uma transação do banco. Qualquer exceção faz rollback automático.
  v_step := 'contagem_chat';
  SELECT COUNT(*) INTO v_count FROM public.messages;
  v_deleted := v_deleted || jsonb_build_object('mensagens', v_count);
  SELECT COUNT(*) INTO v_count FROM public.conversations;
  v_deleted := v_deleted || jsonb_build_object('conversas', v_count);
  SELECT COUNT(*) INTO v_count FROM public.conversation_reads;
  v_deleted := v_deleted || jsonb_build_object('leituras_conversas', v_count);
  SELECT COUNT(*) INTO v_count FROM public.conversation_participants;
  v_deleted := v_deleted || jsonb_build_object('participantes_conversas', v_count);

  v_step := 'contagem_devolucoes';
  SELECT COUNT(*) INTO v_count FROM public.devolucao_itens;
  v_deleted := v_deleted || jsonb_build_object('devolucao_itens', v_count);
  SELECT COUNT(*) INTO v_count FROM public.devolucoes;
  v_deleted := v_deleted || jsonb_build_object('devolucoes', v_count);

  v_step := 'contagem_emprestimos';
  SELECT COUNT(*) INTO v_count FROM public.emprestimo_itens;
  v_deleted := v_deleted || jsonb_build_object('emprestimo_itens', v_count);
  SELECT COUNT(*) INTO v_count FROM public.emprestimos;
  v_deleted := v_deleted || jsonb_build_object('emprestimos', v_count);

  v_step := 'contagem_requisicoes';
  SELECT COUNT(*) INTO v_count FROM public.solicitacao_itens;
  v_deleted := v_deleted || jsonb_build_object('requisicao_itens', v_count);
  SELECT COUNT(*) INTO v_count FROM public.solicitacoes;
  v_deleted := v_deleted || jsonb_build_object('requisicoes', v_count);

  v_step := 'contagem_operacional';
  SELECT COUNT(*) INTO v_count FROM public.dividas;
  v_deleted := v_deleted || jsonb_build_object('dividas', v_count);
  SELECT COUNT(*) INTO v_count FROM public.movimentacoes;
  v_deleted := v_deleted || jsonb_build_object('movimentacoes', v_count);
  SELECT COUNT(*) INTO v_count FROM public.estoque;
  v_deleted := v_deleted || jsonb_build_object('estoques', v_count);
  SELECT COUNT(*) INTO v_count FROM public.produtos;
  v_deleted := v_deleted || jsonb_build_object('produtos', v_count);
  SELECT COUNT(*) INTO v_count FROM public.categorias;
  v_deleted := v_deleted || jsonb_build_object('categorias', v_count);
  SELECT COUNT(*) INTO v_count FROM public.salas;
  v_deleted := v_deleted || jsonb_build_object('salas', v_count);

  v_step := 'contagem_usuarios';
  SELECT COUNT(*) INTO v_count FROM public.profiles WHERE NOT (id = ANY(v_master_ids));
  v_deleted := v_deleted || jsonb_build_object('usuarios', v_count);
  SELECT COUNT(*) INTO v_count FROM public.user_roles WHERE role <> 'master';
  v_deleted := v_deleted || jsonb_build_object('cargos_usuarios', v_count);

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

  v_step := 'limpar_usuarios_nao_master';
  UPDATE public.profiles SET sala_id = NULL WHERE id = ANY(v_master_ids);
  DELETE FROM public.profiles WHERE NOT (id = ANY(v_master_ids));
  DELETE FROM public.user_roles WHERE role <> 'master';

  v_step := 'finalizado';
  RETURN jsonb_build_object(
    'success', true,
    'step', v_step,
    'deleted', v_deleted,
    'master_ids', v_master_ids,
    'kept_masters', cardinality(v_master_ids)
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'step', v_step,
    'error', SQLERRM,
    'sqlstate', SQLSTATE,
    'deleted', v_deleted
  );
END;
$function$;