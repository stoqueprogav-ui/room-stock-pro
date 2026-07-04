-- Fix: produtos.custo_unitario (custo inicial) precisa refletir em estoque.custo_medio
-- enquanto não houver Entrada de Estoque real (compra). Depois disso, o CMP é
-- recalculado normalmente pela ponderação das entradas.

-- 1) Seed do estoque para novo produto usa custo_unitario como CMP inicial.
CREATE OR REPLACE FUNCTION public.seed_estoque_for_new_produto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.sala_id IS NULL THEN
    RAISE EXCEPTION 'produto deve estar vinculado a uma sala';
  END IF;
  INSERT INTO public.estoque (produto_id, sala_id, quantidade, custo_medio, valor_total, quantidade_valorizada)
  VALUES (NEW.id, NEW.sala_id, 0, COALESCE(NEW.custo_unitario, 0), 0, 0)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$function$;

-- 2) ajustar_estoque: ao criar a linha do estoque na primeira vez, aplica o custo_unitario
--    do produto como CMP e registra na movimentação.
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
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN RAISE EXCEPTION 'apenas master'; END IF;

  SELECT COALESCE(custo_unitario, 0) INTO v_custo_ref FROM public.produtos WHERE id = _produto;

  SELECT quantidade, custo_medio INTO v_atual, v_cmp FROM public.estoque
    WHERE produto_id=_produto AND sala_id=_sala;

  IF v_atual IS NULL THEN
    INSERT INTO public.estoque (produto_id, sala_id, quantidade, custo_medio)
    VALUES (_produto, _sala, _quantidade, COALESCE(v_custo_ref, 0));
    v_diff := _quantidade; v_atual := _quantidade; v_cmp := COALESCE(v_custo_ref, 0);
  ELSE
    v_diff := _quantidade - v_atual;
    -- Se a linha existia mas ainda não tinha CMP e há valor de referência no produto,
    -- adota o custo_unitario como CMP inicial.
    IF COALESCE(v_cmp,0) = 0 AND COALESCE(v_custo_ref,0) > 0 THEN
      UPDATE public.estoque SET quantidade=_quantidade, custo_medio = v_custo_ref
        WHERE produto_id=_produto AND sala_id=_sala;
      v_cmp := v_custo_ref;
    ELSE
      UPDATE public.estoque SET quantidade=_quantidade
        WHERE produto_id=_produto AND sala_id=_sala;
    END IF;
    v_atual := _quantidade;
  END IF;

  PERFORM public._recalc_estoque_valor(_produto, _sala);
  INSERT INTO public.movimentacoes
    (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos, observacao,
     custo_unitario_aplicado, valor_financeiro)
  VALUES (_produto, _sala, v_user, 'ajuste', v_diff, v_atual, _observacao,
          COALESCE(v_cmp,0), ROUND(ABS(v_diff) * COALESCE(v_cmp,0), 2));
  PERFORM public.log_event('estoque.ajustado','Ajuste manual de estoque','estoque', _sala, 'produto', _produto,
    jsonb_build_object('diferenca', v_diff, 'saldo_final', v_atual, 'observacao', _observacao));
  RETURN v_atual;
END;
$function$;

-- 3) Ao editar custo_unitario do produto, propaga para as linhas de estoque
--    daquela sala que ainda não tinham CMP definido (nunca entrou compra).
CREATE OR REPLACE FUNCTION public._tg_propagar_custo_referencia()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND COALESCE(NEW.custo_unitario,0) IS DISTINCT FROM COALESCE(OLD.custo_unitario,0)
     AND COALESCE(NEW.custo_unitario,0) > 0 THEN
    UPDATE public.estoque
       SET custo_medio = NEW.custo_unitario
     WHERE produto_id = NEW.id
       AND COALESCE(custo_medio, 0) = 0;
    PERFORM public._recalc_estoque_valor(NEW.id, NEW.sala_id);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_propagar_custo_referencia ON public.produtos;
CREATE TRIGGER trg_propagar_custo_referencia
AFTER UPDATE OF custo_unitario ON public.produtos
FOR EACH ROW EXECUTE FUNCTION public._tg_propagar_custo_referencia();

-- 4) Backfill: para todos os estoques com custo_medio = 0 cujo produto tem custo_unitario > 0,
--    adota o valor de referência do produto agora.
UPDATE public.estoque e
   SET custo_medio = p.custo_unitario
  FROM public.produtos p
 WHERE e.produto_id = p.id
   AND COALESCE(e.custo_medio, 0) = 0
   AND COALESCE(p.custo_unitario, 0) > 0;

-- Recalcula valor_total das linhas afetadas
UPDATE public.estoque
   SET valor_total = ROUND(GREATEST(quantidade,0) * COALESCE(custo_medio,0), 2),
       quantidade_valorizada = CASE WHEN COALESCE(custo_medio,0) > 0 THEN GREATEST(quantidade,0) ELSE 0 END
 WHERE COALESCE(custo_medio,0) > 0;