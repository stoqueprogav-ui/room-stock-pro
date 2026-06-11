
CREATE OR REPLACE FUNCTION public.registrar_consumo_interno(_sala uuid, _produto uuid, _quantidade integer, _motivo motivo_consumo, _observacao text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_sala uuid;
  v_saldo integer;
  v_cmp numeric;
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  IF _quantidade IS NULL OR _quantidade <= 0 THEN RAISE EXCEPTION 'quantidade inválida'; END IF;

  IF public.has_role(v_user,'master') THEN
    v_sala := _sala;
  ELSE
    v_sala := public.get_user_sala(v_user);
    IF v_sala IS NULL THEN RAISE EXCEPTION 'selecione uma sala antes de registrar consumo'; END IF;
    IF _sala IS NOT NULL AND _sala <> v_sala THEN RAISE EXCEPTION 'sala não autorizada'; END IF;
  END IF;

  IF v_sala IS NULL THEN RAISE EXCEPTION 'sala inválida'; END IF;
  IF NOT public.user_has_sala_access(v_user, v_sala) THEN RAISE EXCEPTION 'sala não autorizada'; END IF;

  SELECT custo_medio INTO v_cmp FROM public.estoque
    WHERE produto_id = _produto AND sala_id = v_sala;

  UPDATE public.estoque SET quantidade = quantidade - _quantidade
   WHERE produto_id = _produto AND sala_id = v_sala
   RETURNING quantidade INTO v_saldo;
  IF v_saldo IS NULL THEN RAISE EXCEPTION 'produto não encontrado no estoque da sala'; END IF;
  IF v_saldo < 0 THEN RAISE EXCEPTION 'estoque insuficiente'; END IF;
  PERFORM public._recalc_estoque_valor(_produto, v_sala);

  INSERT INTO public.consumos_internos (sala_id, produto_id, usuario_id, quantidade, motivo, observacao)
  VALUES (v_sala, _produto, v_user, _quantidade, _motivo, _observacao)
  RETURNING id INTO v_id;

  INSERT INTO public.movimentacoes (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos, observacao, referencia_tipo, referencia_id, custo_unitario_aplicado, valor_financeiro)
  VALUES (_produto, v_sala, v_user, 'saida', -_quantidade, v_saldo, concat('Consumo interno: ', _motivo, coalesce(' — ' || _observacao, '')), 'consumo_interno', v_id, coalesce(v_cmp,0), coalesce(v_cmp,0) * _quantidade);

  RETURN v_id;
END;
$$;
