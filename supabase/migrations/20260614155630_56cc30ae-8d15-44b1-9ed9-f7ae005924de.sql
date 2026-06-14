CREATE OR REPLACE FUNCTION public.toggle_produto_sala_ativo(_produto_id uuid, _sala_id uuid, _ativo boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _is_master boolean;
  _is_admin boolean;
  _produto_nome text;
  _sala_nome text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT public.has_role(_uid, 'master'::app_role) INTO _is_master;
  SELECT public.has_role(_uid, 'admin'::app_role) INTO _is_admin;

  IF NOT (_is_master OR _is_admin) THEN
    RAISE EXCEPTION 'Sem permissão para alterar status de produto';
  END IF;

  INSERT INTO public.estoque (produto_id, sala_id, quantidade, ativo)
  VALUES (_produto_id, _sala_id, 0, _ativo)
  ON CONFLICT (produto_id, sala_id) DO UPDATE
    SET ativo = EXCLUDED.ativo,
        updated_at = now();

  SELECT nome INTO _produto_nome FROM public.produtos WHERE id = _produto_id;
  SELECT nome INTO _sala_nome FROM public.salas WHERE id = _sala_id;

  PERFORM public.log_event(
    CASE WHEN _ativo THEN 'produto_sala_ativado' ELSE 'produto_sala_desativado' END,
    CASE WHEN _ativo THEN 'Produto reativado na sala' ELSE 'Produto desativado na sala' END,
    'estoque',
    _sala_id,
    'estoque',
    _produto_id,
    jsonb_build_object(
      'produto_nome', _produto_nome,
      'sala_id', _sala_id,
      'sala_nome', _sala_nome,
      'ativo', _ativo
    )
  );
END;
$function$;