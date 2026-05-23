DROP FUNCTION IF EXISTS public.reset_sistema_total();

REVOKE ALL ON FUNCTION public.reset_sistema_total(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_sistema_total(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.reset_sistema_total(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reset_sistema_total(uuid) TO service_role;