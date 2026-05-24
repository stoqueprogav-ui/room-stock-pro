
-- 1) RPC para garantir que o usuário autenticado tenha um profile (auto-recuperação)
CREATE OR REPLACE FUNCTION public.ensure_my_profile()
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_email text;
  v_nome text;
  v_prof public.profiles;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;

  SELECT * INTO v_prof FROM public.profiles WHERE id = v_user;
  IF FOUND THEN RETURN v_prof; END IF;

  SELECT email, COALESCE(raw_user_meta_data->>'nome', split_part(email,'@',1))
    INTO v_email, v_nome
    FROM auth.users WHERE id = v_user;

  INSERT INTO public.profiles (id, nome, email, sala_id, must_change_password)
  VALUES (v_user, COALESCE(v_nome,'Usuário'), COALESCE(v_email,''), NULL, false)
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email
  RETURNING * INTO v_prof;

  -- Se for um usuário sem cargo, não atribui automaticamente; cargos são gerenciados pelo master.
  RETURN v_prof;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_my_profile() TO authenticated;

-- 2) Corrigir reset_sistema_total para reinserir o profile do master
-- (TRUNCATE ... CASCADE em salas/categorias trunca profiles também)
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
  v_count bigint := 0;
BEGIN
  IF v_user IS NULL OR NOT public.has_role(v_user, 'master') THEN
    RAISE EXCEPTION 'apenas master pode resetar o sistema';
  END IF;

  SELECT COALESCE(array_agg(user_id), ARRAY[]::uuid[]) INTO v_master_ids
  FROM public.user_roles WHERE role = 'master';

  IF NOT (v_user = ANY(v_master_ids)) THEN
    RAISE EXCEPTION 'master não encontrado para preservação';
  END IF;

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
  -- Isso também trunca public.profiles via CASCADE (FK profiles.sala_id -> salas)
  TRUNCATE TABLE public.categorias, public.salas CASCADE;

  v_step := 'remover_usuarios_nao_master';
  DELETE FROM public.user_roles WHERE role <> 'master';

  v_step := 'restaurar_master_profiles';
  INSERT INTO public.profiles (id, nome, email, sala_id, must_change_password, created_at, updated_at)
  SELECT id, nome, email, NULL, false, COALESCE(created_at, now()), now()
    FROM _master_snapshot
  ON CONFLICT (id) DO UPDATE SET sala_id = NULL, updated_at = now();

  v_step := 'restaurar_master_auth_users';
  -- Garante profile mesmo se snapshot estiver vazio (segurança extra)
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

REVOKE EXECUTE ON FUNCTION public.reset_sistema_total(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_sistema_total(uuid) TO service_role;
