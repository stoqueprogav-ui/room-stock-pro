CREATE OR REPLACE FUNCTION public._tg_guard_user_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role text := current_setting('request.jwt.claim.role', true);
  v_claims text := current_setting('request.jwt.claims', true);
  v_is_service boolean := false;
BEGIN
  IF v_role = 'service_role' THEN v_is_service := true; END IF;
  IF NOT v_is_service AND v_claims IS NOT NULL AND v_claims <> '' THEN
    BEGIN
      IF (v_claims::jsonb ->> 'role') = 'service_role' THEN v_is_service := true; END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
  IF NOT v_is_service AND current_user IN ('service_role','postgres','supabase_admin') THEN
    v_is_service := true;
  END IF;
  IF NOT v_is_service AND session_replication_role() = 'replica' THEN
    v_is_service := true;
  END IF;

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
$function$;