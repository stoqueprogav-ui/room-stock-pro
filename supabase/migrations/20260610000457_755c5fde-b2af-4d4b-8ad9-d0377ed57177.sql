CREATE OR REPLACE FUNCTION public.excluir_produto_sala(_produto uuid, _sala uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_nome text;
  v_existe boolean;
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN
    RAISE EXCEPTION 'apenas master pode excluir produtos';
  END IF;
  SELECT nome INTO v_nome FROM public.produtos WHERE id = _produto;
  IF v_nome IS NULL THEN RAISE EXCEPTION 'produto não encontrado'; END IF;

  SELECT EXISTS(SELECT 1 FROM public.estoque WHERE produto_id = _produto AND sala_id = _sala)
    INTO v_existe;
  IF NOT v_existe THEN
    RETURN jsonb_build_object('ok', false, 'mensagem', 'Produto não está nesta sala.');
  END IF;

  DELETE FROM public.estoque WHERE produto_id = _produto AND sala_id = _sala;

  PERFORM public.log_event(
    'produto.removido_da_sala',
    'Produto removido do estoque da sala: '||COALESCE(v_nome,'?'),
    'catalogo', _sala, 'produto', _produto,
    jsonb_build_object('sala_id', _sala)
  );

  RETURN jsonb_build_object('ok', true, 'mensagem', 'Produto removido apenas desta sala. Histórico preservado.');
END;
$function$;

GRANT EXECUTE ON FUNCTION public.excluir_produto_sala(uuid, uuid) TO authenticated;