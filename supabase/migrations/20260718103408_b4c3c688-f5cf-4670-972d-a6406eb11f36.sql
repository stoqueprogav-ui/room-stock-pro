
CREATE OR REPLACE FUNCTION public.registrar_saida_estoque(_produto uuid, _sala uuid, _quantidade integer, _motivo text DEFAULT NULL::text, _observacao text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_saldo_atual integer;
  v_saldo integer;
  v_cmp numeric;
  v_reservada integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  IF NOT public.has_role(v_user, 'master') THEN RAISE EXCEPTION 'apenas master pode registrar saída de estoque'; END IF;
  IF NOT public.user_has_sala_access(v_user, _sala) THEN RAISE EXCEPTION 'sala não autorizada'; END IF;
  IF _quantidade IS NULL OR _quantidade <= 0 THEN RAISE EXCEPTION 'quantidade inválida'; END IF;

  SELECT quantidade, custo_medio, COALESCE(quantidade_reservada,0) INTO v_saldo_atual, v_cmp, v_reservada
    FROM public.estoque WHERE produto_id = _produto AND sala_id = _sala FOR UPDATE;
  IF v_saldo_atual IS NULL THEN RAISE EXCEPTION 'produto não encontrado no estoque da sala'; END IF;
  IF (v_saldo_atual - v_reservada) < _quantidade THEN RAISE EXCEPTION 'estoque insuficiente (há unidades reservadas para empréstimo pendente)'; END IF;

  PERFORM public.baixar_lotes_fefo(_produto, _sala, _quantidade);

  SELECT quantidade INTO v_saldo FROM public.estoque WHERE produto_id = _produto AND sala_id = _sala;

  INSERT INTO public.movimentacoes
    (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos, observacao,
     custo_unitario_aplicado, valor_financeiro)
  VALUES (_produto, _sala, v_user, 'saida', -_quantidade, v_saldo,
          concat('Saída', COALESCE(' · ' || _motivo, ''), COALESCE(' — ' || _observacao, '')),
          COALESCE(v_cmp,0), COALESCE(v_cmp,0) * _quantidade);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ajustar_estoque(_produto uuid, _sala uuid, _quantidade integer, _observacao text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_atual INTEGER;
  v_cmp NUMERIC;
  v_diff INTEGER;
  v_custo_ref NUMERIC;
  v_final INTEGER;
  v_reservada INTEGER;
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN RAISE EXCEPTION 'apenas master'; END IF;
  IF NOT public.user_has_sala_access(v_user, _sala) THEN RAISE EXCEPTION 'sala não autorizada'; END IF;

  SELECT COALESCE(custo_unitario, 0) INTO v_custo_ref FROM public.produtos WHERE id = _produto;

  SELECT quantidade, custo_medio, COALESCE(quantidade_reservada,0) INTO v_atual, v_cmp, v_reservada
    FROM public.estoque
    WHERE produto_id=_produto AND sala_id=_sala FOR UPDATE;

  IF v_atual IS NULL THEN
    INSERT INTO public.estoque (produto_id, sala_id, quantidade, custo_medio)
    VALUES (_produto, _sala, 0, COALESCE(v_custo_ref, 0));
    v_atual := 0;
    v_cmp := COALESCE(v_custo_ref, 0);
    v_reservada := 0;
  ELSIF COALESCE(v_cmp,0) = 0 AND COALESCE(v_custo_ref,0) > 0 THEN
    UPDATE public.estoque SET custo_medio = v_custo_ref
      WHERE produto_id=_produto AND sala_id=_sala;
    v_cmp := v_custo_ref;
  END IF;

  IF _quantidade < v_reservada THEN
    RAISE EXCEPTION 'não é possível ajustar abaixo da quantidade reservada (% un. reservadas para empréstimo pendente)', v_reservada;
  END IF;

  v_diff := _quantidade - v_atual;

  IF v_diff > 0 THEN
    INSERT INTO public.lotes (produto_id, sala_id, quantidade, validade, referencia_tipo)
    VALUES (_produto, _sala, v_diff, null, 'ajuste');
  ELSIF v_diff < 0 THEN
    PERFORM public.baixar_lotes_fefo(_produto, _sala, -v_diff);
  END IF;

  SELECT quantidade INTO v_final FROM public.estoque WHERE produto_id=_produto AND sala_id=_sala;

  PERFORM public._recalc_estoque_valor(_produto, _sala);
  INSERT INTO public.movimentacoes
    (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos, observacao,
     custo_unitario_aplicado, valor_financeiro)
  VALUES (_produto, _sala, v_user, 'ajuste', v_diff, v_final, _observacao,
          COALESCE(v_cmp,0), ROUND(ABS(v_diff) * COALESCE(v_cmp,0), 2));
  PERFORM public.log_event('estoque.ajustado','Ajuste manual de estoque','estoque', _sala, 'produto', _produto,
    jsonb_build_object('diferenca', v_diff, 'saldo_final', v_final, 'observacao', _observacao));
  RETURN v_final;
END;
$function$;

CREATE OR REPLACE FUNCTION public.decidir_solicitacao(_solic uuid, _aprovar boolean, _motivo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_sala UUID;
  v_status public.solicitacao_status;
  v_baixado BOOLEAN;
  v_item RECORD;
  v_saldo_atual INTEGER;
  v_saldo INTEGER;
  v_cmp NUMERIC;
  v_reservada INTEGER;
  v_total INT := 0;
  v_total_valor NUMERIC := 0;
  v_motivo text := NULLIF(btrim(COALESCE(_motivo,'')), '');
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN RAISE EXCEPTION 'apenas master'; END IF;
  SELECT status, sala_id, estoque_baixado INTO v_status, v_sala, v_baixado
  FROM public.solicitacoes WHERE id = _solic;
  IF v_status IS NULL THEN RAISE EXCEPTION 'requisição não encontrada'; END IF;
  IF NOT public.user_has_sala_access(v_user, v_sala) THEN RAISE EXCEPTION 'requisição de outra região'; END IF;
  IF v_status <> 'pendente' THEN RAISE EXCEPTION 'requisição já decidida'; END IF;

  IF _aprovar THEN
    IF NOT v_baixado THEN
      FOR v_item IN SELECT produto_id, quantidade FROM public.solicitacao_itens WHERE solicitacao_id=_solic LOOP
        SELECT quantidade, custo_medio, COALESCE(quantidade_reservada,0) INTO v_saldo_atual, v_cmp, v_reservada FROM public.estoque
          WHERE produto_id = v_item.produto_id AND sala_id = v_sala FOR UPDATE;
        IF v_saldo_atual IS NULL THEN RAISE EXCEPTION 'produto não existe no estoque da sala'; END IF;
        IF (v_saldo_atual - v_reservada) < v_item.quantidade THEN RAISE EXCEPTION 'estoque insuficiente para aprovar (há unidades reservadas para empréstimo pendente)'; END IF;
        PERFORM public.baixar_lotes_fefo(v_item.produto_id, v_sala, v_item.quantidade);
        SELECT quantidade INTO v_saldo FROM public.estoque WHERE produto_id = v_item.produto_id AND sala_id = v_sala;
        INSERT INTO public.movimentacoes
          (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos,
           referencia_tipo, referencia_id, custo_unitario_aplicado, valor_financeiro)
        VALUES (v_item.produto_id, v_sala, v_user, 'solicitacao', -v_item.quantidade, v_saldo,
                'solicitacao', _solic, COALESCE(v_cmp,0),
                ROUND(v_item.quantidade * COALESCE(v_cmp,0), 2));
        v_total := v_total + v_item.quantidade;
        v_total_valor := v_total_valor + ROUND(v_item.quantidade * COALESCE(v_cmp,0), 2);
      END LOOP;
    END IF;
    UPDATE public.solicitacoes
       SET status='aprovado', decidido_por=v_user, decidido_em=now(),
           estoque_baixado=true, motivo_decisao=v_motivo
     WHERE id=_solic;
    PERFORM public.log_event('requisicao.aprovada', 'Requisição aprovada', 'requisicoes', v_sala, 'solicitacao', _solic,
      jsonb_build_object('total_unidades', v_total, 'valor_financeiro', v_total_valor, 'motivo', v_motivo));
  ELSE
    IF v_baixado THEN
      FOR v_item IN SELECT produto_id, quantidade FROM public.solicitacao_itens WHERE solicitacao_id=_solic LOOP
        SELECT custo_medio INTO v_cmp FROM public.estoque
          WHERE produto_id = v_item.produto_id AND sala_id = v_sala;
        INSERT INTO public.estoque (produto_id, sala_id, quantidade, custo_medio)
        VALUES (v_item.produto_id, v_sala, 0, COALESCE(v_cmp,0))
        ON CONFLICT (produto_id, sala_id) DO NOTHING;
        INSERT INTO public.lotes (produto_id, sala_id, quantidade, validade, referencia_tipo, referencia_id)
        VALUES (v_item.produto_id, v_sala, v_item.quantidade, null, 'estorno_solicitacao', _solic);
        SELECT quantidade INTO v_saldo FROM public.estoque WHERE produto_id = v_item.produto_id AND sala_id = v_sala;
        INSERT INTO public.movimentacoes
          (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos,
           referencia_tipo, referencia_id, observacao,
           custo_unitario_aplicado, valor_financeiro)
        VALUES (v_item.produto_id, v_sala, v_user, 'estorno', v_item.quantidade, v_saldo,
                'solicitacao', _solic, 'estorno por rejeição',
                COALESCE(v_cmp,0), ROUND(v_item.quantidade * COALESCE(v_cmp,0), 2));
      END LOOP;
    END IF;
    UPDATE public.solicitacoes
       SET status='rejeitado', decidido_por=v_user, decidido_em=now(),
           estoque_baixado=false, motivo_decisao=v_motivo
     WHERE id=_solic;
    PERFORM public.log_event('requisicao.rejeitada', 'Requisição rejeitada', 'requisicoes', v_sala, 'solicitacao', _solic,
      jsonb_build_object('motivo', v_motivo));
  END IF;
END;
$function$;
