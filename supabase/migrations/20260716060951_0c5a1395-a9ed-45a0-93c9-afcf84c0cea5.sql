-- Regiões — Fase 2, Lote 2: gestão de usuários + tabelas globais

CREATE OR REPLACE FUNCTION public.usuarios_compartilham_regiao(_a uuid, _b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_regioes(_a) x
    WHERE x IN (SELECT public.user_regioes(_b))
  );
$$;

CREATE OR REPLACE FUNCTION public.master_ve_usuario(_master uuid, _target uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_master(_master)
      OR (public.has_role(_master,'master')
          AND public.usuarios_compartilham_regiao(_master, _target));
$$;

-- PROFILES
DROP POLICY IF EXISTS profiles_select_authenticated ON public.profiles;
DROP POLICY IF EXISTS profiles_select_self_or_master ON public.profiles;
CREATE POLICY profiles_select_self_or_master ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR public.is_super_master(auth.uid())
    OR public.usuarios_compartilham_regiao(auth.uid(), id)
  );

DROP POLICY IF EXISTS profiles_master_all ON public.profiles;
CREATE POLICY profiles_master_all ON public.profiles
  FOR ALL TO authenticated
  USING (public.master_ve_usuario(auth.uid(), id))
  WITH CHECK (public.master_ve_usuario(auth.uid(), id));

-- USER_ROLES
DROP POLICY IF EXISTS roles_select_self_or_master ON public.user_roles;
CREATE POLICY roles_select_self_or_master ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.master_ve_usuario(auth.uid(), user_id));

DROP POLICY IF EXISTS roles_master_all ON public.user_roles;
CREATE POLICY roles_master_all ON public.user_roles
  FOR ALL TO authenticated
  USING (public.master_ve_usuario(auth.uid(), user_id))
  WITH CHECK (public.master_ve_usuario(auth.uid(), user_id));

-- USER_SALAS
DROP POLICY IF EXISTS user_salas_select_self_or_master ON public.user_salas;
CREATE POLICY user_salas_select_self_or_master ON public.user_salas
  FOR SELECT
  USING (user_id = auth.uid() OR public.master_scope_sala(auth.uid(), sala_id));

DROP POLICY IF EXISTS user_salas_master_all ON public.user_salas;
CREATE POLICY user_salas_master_all ON public.user_salas
  FOR ALL
  USING (public.master_scope_sala(auth.uid(), sala_id))
  WITH CHECK (public.master_scope_sala(auth.uid(), sala_id));

-- USER_SALA_ATIVA
DROP POLICY IF EXISTS user_sala_ativa_select_self_or_master ON public.user_sala_ativa;
CREATE POLICY user_sala_ativa_select_self_or_master ON public.user_sala_ativa
  FOR SELECT
  USING (user_id = auth.uid() OR public.master_ve_usuario(auth.uid(), user_id));

-- TABELAS GLOBAIS
DROP POLICY IF EXISTS catalogo_write_master ON public.produtos_catalogo;
CREATE POLICY catalogo_write_master ON public.produtos_catalogo
  FOR ALL TO authenticated
  USING (public.is_super_master(auth.uid()))
  WITH CHECK (public.is_super_master(auth.uid()));

DROP POLICY IF EXISTS app_settings_master_write ON public.app_settings;
CREATE POLICY app_settings_master_write ON public.app_settings
  FOR ALL TO authenticated
  USING (public.is_super_master(auth.uid()))
  WITH CHECK (public.is_super_master(auth.uid()));

DROP POLICY IF EXISTS system_logs_select_master ON public.system_logs;
CREATE POLICY system_logs_select_master ON public.system_logs
  FOR SELECT TO authenticated
  USING (
    public.is_super_master(auth.uid())
    OR (sala_id IS NOT NULL AND public.master_scope_sala(auth.uid(), sala_id))
  );

-- GUARD de cargos
CREATE OR REPLACE FUNCTION public._tg_guard_user_roles()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_is_service boolean := current_setting('request.jwt.claim.role', true) = 'service_role';
BEGIN
  IF v_is_service THEN
    RETURN NEW;
  END IF;

  IF NEW.role IN ('super_master','master')
     AND NOT public.is_super_master(auth.uid()) THEN
    RAISE EXCEPTION 'cargo % só pode ser concedido pelo Super Master', NEW.role;
  END IF;

  IF NEW.role = 'admin'
     AND NOT public.has_role(auth.uid(),'master') THEN
    RAISE EXCEPTION 'cargo admin só pode ser concedido por um Master';
  END IF;

  RETURN NEW;
END;
$$;

-- set_user_role
CREATE OR REPLACE FUNCTION public.set_user_role(_user uuid, _role public.app_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF _user IS NULL OR _role IS NULL THEN RAISE EXCEPTION 'parâmetros inválidos'; END IF;

  IF NOT public.master_ve_usuario(auth.uid(), _user) THEN
    RAISE EXCEPTION 'sem permissão para alterar o cargo deste usuário';
  END IF;

  IF _role IN ('master','super_master') AND NOT public.is_super_master(auth.uid()) THEN
    RAISE EXCEPTION 'apenas o Super Master concede os cargos master/super_master';
  END IF;

  DELETE FROM public.user_roles WHERE user_id = _user;
  INSERT INTO public.user_roles (user_id, role) VALUES (_user, _role);
END;
$$;