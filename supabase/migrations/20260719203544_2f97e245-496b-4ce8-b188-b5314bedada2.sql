CREATE OR REPLACE FUNCTION public.corrigir_valor_lote(_lote uuid, _novo_valor numeric, _motivo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_produto uuid; v_sala uuid; v_ref_tipo text; v_ref_id uuid; v_qtd_lote integer;
  v_valor_antigo numeric;
  v_cmp_atual numeric; v_cmp_novo numeric;
  v_soma_lotes numeric; v_soma_valor numeric;
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN
    RAISE EXCEPTION 'apenas master pode corrigir valores';
  END IF;
  IF _novo_valor IS NULL OR _novo_valor < 0 THEN
    RAISE EXCEPTION 'valor inválido';
  END IF;

  SELECT produto_id, sala_id, referencia_tipo, referencia_id, quantidade, valor_unitario
    INTO v_produto, v_sala, v_ref_tipo, v_ref_id, v_qtd_lote, v_valor_antigo
    FROM public.lotes WHERE id = _lote FOR UPDATE;
  IF v_produto IS NULL THEN RAISE EXCEPTION 'lote não encontrado'; END IF;
  IF NOT public.user_has_sala_access(v_user, v_sala) THEN
    RAISE EXCEPTION 'sala não autorizada';
  END IF;

  UPDATE public.lotes SET valor_unitario = _novo_valor WHERE id = _lote;

  IF v_ref_tipo = 'entrada' AND v_ref_id IS NOT NULL THEN
    SELECT COALESCE(valor_unitario, v_valor_antigo) INTO v_valor_antigo
      FROM public.entradas_estoque WHERE id = v_ref_id;

    -- valor_total é coluna GERADA; não pode ser atualizada
    UPDATE public.entradas_estoque
       SET valor_unitario = _novo_valor
     WHERE id = v_ref_id;

    UPDATE public.movimentacoes
       SET custo_unitario_aplicado = _novo_valor,
           valor_financeiro        = ROUND(quantidade * _novo_valor, 2)
     WHERE referencia_tipo = 'entrada_estoque' AND referencia_id = v_ref_id
       AND tipo = 'entrada';
  END IF;

  SELECT COALESCE(custo_medio,0)
    INTO v_cmp_atual
    FROM public.estoque
   WHERE produto_id = v_produto AND sala_id = v_sala
   FOR UPDATE;

  SELECT COALESCE(SUM(l.quantidade),0),
         COALESCE(SUM(l.quantidade *
           COALESCE(l.valor_unitario, ee.valor_unitario, v_cmp_atual)),0)
    INTO v_soma_lotes, v_soma_valor
    FROM public.lotes l
    LEFT JOIN public.entradas_estoque ee
      ON l.referencia_tipo = 'entrada' AND ee.id = l.referencia_id
   WHERE l.produto_id = v_produto AND l.sala_id = v_sala
     AND l.quantidade > 0;

  IF v_soma_lotes > 0 THEN
    v_cmp_novo := ROUND(v_soma_valor / v_soma_lotes, 4);
    UPDATE public.estoque
       SET custo_medio = v_cmp_novo,
           quantidade_valorizada = GREATEST(quantidade, 0),
           valor_total = ROUND(GREATEST(quantidade,0) * v_cmp_novo, 2)
     WHERE produto_id = v_produto AND sala_id = v_sala;
  END IF;

  PERFORM public.log_event(
    'estoque.valor_lote_corrigido','Valor do lote corrigido','estoque',
    v_sala, 'lote', _lote,
    jsonb_build_object('produto_id', v_produto, 'tipo_lote', v_ref_tipo,
                       'valor_anterior', v_valor_antigo, 'valor_novo', _novo_valor,
                       'quantidade_lote', v_qtd_lote,
                       'cmp_recalculado', v_cmp_novo, 'motivo', _motivo));
END;
$function$;