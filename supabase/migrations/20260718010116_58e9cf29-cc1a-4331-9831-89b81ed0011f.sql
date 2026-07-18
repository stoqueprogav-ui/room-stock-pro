CREATE OR REPLACE FUNCTION public._recalc_estoque_valor(_produto uuid, _sala uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_ref numeric;
BEGIN
  SELECT COALESCE(custo_unitario, 0) INTO v_ref FROM public.produtos WHERE id = _produto;
  UPDATE public.estoque e
     SET custo_medio = CASE WHEN COALESCE(e.custo_medio,0) > 0 THEN e.custo_medio ELSE v_ref END,
         quantidade_valorizada = GREATEST(e.quantidade, 0),
         valor_total = ROUND(
           GREATEST(e.quantidade,0)
           * CASE WHEN COALESCE(e.custo_medio,0) > 0 THEN e.custo_medio ELSE v_ref END, 2)
   WHERE e.produto_id = _produto AND e.sala_id = _sala;
END $$;

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
    RAISE EXCEPTION 'apenas master pode remover produtos da sala';
  END IF;
  SELECT nome INTO v_nome FROM public.produtos WHERE id = _produto;
  IF v_nome IS NULL THEN RAISE EXCEPTION 'produto não encontrado'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.estoque WHERE produto_id = _produto AND sala_id = _sala)
    INTO v_existe;
  IF NOT v_existe THEN
    RETURN jsonb_build_object('ok', false, 'mensagem', 'Produto não está nesta sala.');
  END IF;
  UPDATE public.estoque
     SET ativo = false, updated_at = now()
   WHERE produto_id = _produto AND sala_id = _sala;
  PERFORM public.log_event(
    'produto.inativado_na_sala',
    'Produto inativado no estoque da sala: '||COALESCE(v_nome,'?'),
    'estoque', _sala, 'produto', _produto,
    jsonb_build_object('sala_id', _sala)
  );
  RETURN jsonb_build_object('ok', true,
    'mensagem', 'Produto inativado nesta sala. Pode ser reativado; estoque e histórico preservados.');
END;
$function$;

INSERT INTO public.estoque
  (produto_id, sala_id, quantidade, custo_medio, valor_total, quantidade_valorizada, ativo)
SELECT p.id, p.sala_id,
       COALESCE((SELECT SUM(l.quantidade) FROM public.lotes l
                  WHERE l.produto_id = p.id AND l.sala_id = p.sala_id), 0),
       COALESCE(p.custo_unitario, 0), 0, 0, false
FROM public.produtos p
WHERE p.sala_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.estoque e
     WHERE e.produto_id = p.id AND e.sala_id = p.sala_id)
ON CONFLICT (produto_id, sala_id) DO NOTHING;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT produto_id, sala_id FROM public.estoque LOOP
    PERFORM public._recalc_estoque_valor(r.produto_id, r.sala_id);
  END LOOP;
END $$;