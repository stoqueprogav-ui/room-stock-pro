CREATE OR REPLACE FUNCTION public.admin_set_master_regioes(_user uuid, _regioes uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_master(auth.uid()) THEN
    RAISE EXCEPTION 'apenas o Super Master pode vincular regiões a um master';
  END IF;
  IF _user IS NULL THEN RAISE EXCEPTION 'usuário inválido'; END IF;

  DELETE FROM public.master_regioes WHERE user_id = _user;

  IF _regioes IS NOT NULL AND array_length(_regioes, 1) IS NOT NULL THEN
    INSERT INTO public.master_regioes (user_id, regiao_id)
    SELECT _user, r FROM unnest(_regioes) AS r
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$;