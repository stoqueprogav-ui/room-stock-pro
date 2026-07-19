DROP FUNCTION IF EXISTS public.corrigir_custo_produto(uuid, uuid, numeric, text);

CREATE OR REPLACE FUNCTION public.corrigir_valor_entrada(
  _entrada uuid, _novo_valor numeric, _motivo text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_produto uuid; v_sala uuid; v_qtd integer; v_valor_antigo numeric;
  v_cmp_atual numeric; v_cmp_novo numeric; v_qtd_estoque integer;
  v_soma_lotes numeric; v_soma_valor numeric;
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN
    RAISE EXCEPTION 'apenas master pode corrigir valores de entrada';
  END IF;
  IF _novo_valor IS NULL OR _novo_valor < 0 THEN
    RAISE EXCEPTION 'valor inválido';
  END IF;

  SELECT produto_id, sala_id, quantidade, valor_unitario
    INTO v_produto, v_sala, v_qtd, v_valor_antigo
    FROM public.entradas_estoque WHERE id = _entrada FOR UPDATE;
  IF v_produto IS NULL THEN RAISE EXCEPTION 'entrada não encontrada'; END IF;
  IF NOT public.user_has_sala_access(v_user, v_sala) THEN
    RAISE EXCEPTION 'sala não autorizada';
  END IF;

  UPDATE public.entradas_estoque
     SET valor_unitario = _novo_valor,
         valor_total    = ROUND(quantidade * _novo_valor, 2)
   WHERE id = _entrada;

  UPDATE public.movimentacoes
     SET custo_unitario_aplicado = _novo_valor,
         valor_financeiro        = ROUND(quantidade * _novo_valor, 2)
   WHERE referencia_tipo = 'entrada_estoque' AND referencia_id = _entrada
     AND tipo = 'entrada';

  SELECT COALESCE(custo_medio,0), COALESCE(quantidade,0)
    INTO v_cmp_atual, v_qtd_estoque
    FROM public.estoque
   WHERE produto_id = v_produto AND sala_id = v_sala
   FOR UPDATE;

  SELECT COALESCE(SUM(l.quantidade),0),
         COALESCE(SUM(l.quantidade *
           COALESCE(ee.valor_unitario, v_cmp_atual)),0)
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
    'estoque.valor_entrada_corrigido','Valor de entrada corrigido','estoque',
    v_sala, 'entrada_estoque', _entrada,
    jsonb_build_object('produto_id', v_produto,
                       'valor_anterior', v_valor_antigo, 'valor_novo', _novo_valor,
                       'quantidade_entrada', v_qtd,
                       'cmp_recalculado', v_cmp_novo, 'motivo', _motivo));
END;
$$;