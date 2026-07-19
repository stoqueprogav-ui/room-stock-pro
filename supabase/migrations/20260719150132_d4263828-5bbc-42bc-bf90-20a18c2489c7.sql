CREATE OR REPLACE FUNCTION public.corrigir_custo_produto(
  _produto uuid, _sala uuid, _novo_custo numeric, _motivo text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_cmp_antigo numeric;
  v_qtd integer;
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN
    RAISE EXCEPTION 'apenas master pode corrigir custo';
  END IF;
  IF NOT public.user_has_sala_access(v_user, _sala) THEN
    RAISE EXCEPTION 'sala não autorizada';
  END IF;
  IF _novo_custo IS NULL OR _novo_custo < 0 THEN
    RAISE EXCEPTION 'custo inválido';
  END IF;

  SELECT COALESCE(custo_medio,0), COALESCE(quantidade,0)
    INTO v_cmp_antigo, v_qtd
    FROM public.estoque
   WHERE produto_id = _produto AND sala_id = _sala
   FOR UPDATE;

  UPDATE public.produtos
     SET custo_unitario = _novo_custo
   WHERE id = _produto AND sala_id = _sala;

  UPDATE public.estoque
     SET custo_medio = _novo_custo,
         quantidade_valorizada = GREATEST(quantidade, 0),
         valor_total = ROUND(GREATEST(quantidade,0) * _novo_custo, 2)
   WHERE produto_id = _produto AND sala_id = _sala;

  PERFORM public.log_event(
    'estoque.custo_corrigido','Custo do produto corrigido','estoque',
    _sala, 'produto', _produto,
    jsonb_build_object('custo_anterior', v_cmp_antigo, 'custo_novo', _novo_custo,
                       'quantidade', v_qtd, 'motivo', _motivo));
END;
$$;