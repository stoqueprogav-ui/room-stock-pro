
CREATE OR REPLACE FUNCTION public.toggle_produto_sala_ativo(_produto_id uuid, _sala_id uuid, _ativo boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _is_master boolean;
  _is_admin boolean;
  _produto_nome text;
  _sala_nome text;
  _status_anterior boolean;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT public.has_role(_uid, 'master'::app_role) INTO _is_master;
  SELECT public.has_role(_uid, 'admin'::app_role) INTO _is_admin;

  IF NOT (_is_master OR _is_admin) THEN
    RAISE EXCEPTION 'Sem permissão para alterar status de produto';
  END IF;

  -- status anterior desta sala (para auditoria)
  SELECT ativo INTO _status_anterior
  FROM public.estoque
  WHERE produto_id = _produto_id AND sala_id = _sala_id;

  -- Reativação: garante que o produto não fique escondido por flag global antigo,
  -- mas SEM afetar nenhuma outra sala (estoque de cada sala é independente).
  IF _ativo THEN
    UPDATE public.produtos
       SET ativo = true, updated_at = now()
     WHERE id = _produto_id AND ativo = false;
  END IF;

  -- Só o registro estoque(produto_id, sala_id) desta sala é alterado.
  INSERT INTO public.estoque (produto_id, sala_id, quantidade, ativo)
  VALUES (_produto_id, _sala_id, 0, _ativo)
  ON CONFLICT (produto_id, sala_id) DO UPDATE
    SET ativo = EXCLUDED.ativo,
        updated_at = now();

  SELECT nome INTO _produto_nome FROM public.produtos WHERE id = _produto_id;
  SELECT nome INTO _sala_nome    FROM public.salas    WHERE id = _sala_id;

  PERFORM public.log_event(
    CASE WHEN _ativo THEN 'produto_sala_ativado' ELSE 'produto_sala_desativado' END,
    CASE WHEN _ativo THEN 'Produto reativado na sala' ELSE 'Produto desativado na sala' END,
    'estoque',
    _sala_id,
    'estoque',
    _produto_id,
    jsonb_build_object(
      'produto_id', _produto_id,
      'produto_nome', _produto_nome,
      'sala_id', _sala_id,
      'sala_nome', _sala_nome,
      'status_anterior', COALESCE(_status_anterior, false),
      'status_novo', _ativo
    )
  );
END;
$$;
