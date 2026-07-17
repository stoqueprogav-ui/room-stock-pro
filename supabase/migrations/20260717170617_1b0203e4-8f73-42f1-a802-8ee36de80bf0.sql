
-- 1) Trigger: apagar lotes ao excluir linha de estoque + limpar órfãos
CREATE OR REPLACE FUNCTION public.tg_lotes_on_estoque_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
BEGIN
  DELETE FROM public.lotes WHERE produto_id = OLD.produto_id AND sala_id = OLD.sala_id;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_lotes_on_estoque_delete ON public.estoque;
CREATE TRIGGER trg_lotes_on_estoque_delete
AFTER DELETE ON public.estoque
FOR EACH ROW EXECUTE FUNCTION public.tg_lotes_on_estoque_delete();

-- Limpa órfãos já existentes (sem linha em estoque correspondente)
DELETE FROM public.lotes l
WHERE NOT EXISTS (
  SELECT 1 FROM public.estoque e
  WHERE e.produto_id = l.produto_id AND e.sala_id = l.sala_id
);

-- 2a) sugerir_troca_validade por CATALOGO_ID
CREATE OR REPLACE FUNCTION public.sugerir_troca_validade(_sala_atende uuid, _produto uuid, _qtd integer)
RETURNS TABLE(sala_id uuid, sala_nome text, lote_id uuid, validade date, dias integer, quantidade integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public' AS $$
  WITH cat AS (SELECT catalogo_id FROM public.produtos WHERE id = _produto)
  SELECT s.id, s.nome, l.id, l.validade, (l.validade - current_date), l.quantidade
  FROM public.lotes l
  JOIN public.produtos p ON p.id = l.produto_id
  JOIN public.salas s ON s.id = l.sala_id
  WHERE p.catalogo_id IS NOT NULL
    AND p.catalogo_id = (SELECT catalogo_id FROM cat)
    AND l.quantidade > 0
    AND l.validade IS NOT NULL
    AND l.validade <= current_date + 15
    AND l.sala_id <> _sala_atende
    AND s.regiao_id = (SELECT regiao_id FROM public.salas WHERE id = _sala_atende)
    AND public.user_has_sala_access(auth.uid(), l.sala_id)
  ORDER BY l.validade ASC
  LIMIT 10;
$$;

-- 2b) trocar_lotes por CATALOGO_ID (produto_id difere entre salas)
CREATE OR REPLACE FUNCTION public.trocar_lotes(_lote_curto uuid, _sala_atende uuid, _qtd integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
DECLARE
  v_curto record;
  v_sala_origem uuid;
  v_prod_origem uuid;
  v_prod_atende uuid;
  v_catalogo uuid;
  v_val_origem_antes numeric;
  v_val_atende_antes numeric;
  r record; v_rest integer; v_tira integer;
BEGIN
  IF _qtd <= 0 THEN RAISE EXCEPTION 'quantidade inválida'; END IF;

  SELECT * INTO v_curto FROM public.lotes WHERE id = _lote_curto;
  IF v_curto IS NULL THEN RAISE EXCEPTION 'lote não encontrado'; END IF;

  v_sala_origem := v_curto.sala_id;
  v_prod_origem := v_curto.produto_id;

  IF v_sala_origem = _sala_atende THEN RAISE EXCEPTION 'salas iguais'; END IF;

  SELECT catalogo_id INTO v_catalogo FROM public.produtos WHERE id = v_prod_origem;
  IF v_catalogo IS NULL THEN RAISE EXCEPTION 'produto sem catálogo — não é possível trocar'; END IF;

  SELECT id INTO v_prod_atende FROM public.produtos
   WHERE sala_id = _sala_atende AND catalogo_id = v_catalogo LIMIT 1;
  IF v_prod_atende IS NULL THEN
    RAISE EXCEPTION 'sala que atende não tem esse item cadastrado';
  END IF;

  IF (SELECT regiao_id FROM public.salas WHERE id=v_sala_origem)
     IS DISTINCT FROM (SELECT regiao_id FROM public.salas WHERE id=_sala_atende) THEN
    RAISE EXCEPTION 'troca só entre salas da mesma região';
  END IF;

  IF NOT (public.master_scope_sala(auth.uid(), v_sala_origem) AND public.master_scope_sala(auth.uid(), _sala_atende))
     AND NOT (public.user_has_sala_access(auth.uid(), v_sala_origem) AND public.user_has_sala_access(auth.uid(), _sala_atende)) THEN
    RAISE EXCEPTION 'sem permissão nas duas salas';
  END IF;

  IF _qtd > v_curto.quantidade THEN RAISE EXCEPTION 'lote curto não tem essa quantidade'; END IF;

  IF _qtd > COALESCE((SELECT sum(quantidade) FROM public.lotes
                       WHERE produto_id=v_prod_atende AND sala_id=_sala_atende
                         AND (validade IS NULL OR validade > current_date + 15)),0) THEN
    RAISE EXCEPTION 'sala que atende não tem quantidade de validade longa suficiente para a troca';
  END IF;

  v_val_origem_antes := COALESCE((SELECT valor_total FROM public.estoque WHERE produto_id=v_prod_origem AND sala_id=v_sala_origem),0);
  v_val_atende_antes := COALESCE((SELECT valor_total FROM public.estoque WHERE produto_id=v_prod_atende AND sala_id=_sala_atende),0);

  -- 1) move _qtd do lote curto: origem -> atende (usando produto_id da sala atende)
  UPDATE public.lotes SET quantidade = quantidade - _qtd WHERE id = _lote_curto;
  INSERT INTO public.lotes (produto_id, sala_id, quantidade, validade, referencia_tipo, referencia_id)
  VALUES (v_prod_atende, _sala_atende, _qtd, v_curto.validade, 'troca', _lote_curto);

  -- 2) move _qtd de lotes LONGOS: atende -> origem (usando produto_id da sala origem)
  v_rest := _qtd;
  FOR r IN SELECT id, quantidade, validade FROM public.lotes
            WHERE produto_id=v_prod_atende AND sala_id=_sala_atende AND quantidade>0
              AND (validade IS NULL OR validade > current_date + 15)
              AND NOT (referencia_tipo='troca' AND referencia_id=_lote_curto)
            ORDER BY validade DESC NULLS FIRST, entrada_em DESC
  LOOP
    EXIT WHEN v_rest<=0;
    v_tira := least(r.quantidade, v_rest);
    UPDATE public.lotes SET quantidade = quantidade - v_tira WHERE id = r.id;
    INSERT INTO public.lotes (produto_id, sala_id, quantidade, validade, referencia_tipo, referencia_id)
    VALUES (v_prod_origem, v_sala_origem, v_tira, r.validade, 'troca', r.id);
    v_rest := v_rest - v_tira;
  END LOOP;

  -- Neutralidade financeira: manter valor_total anterior e recalcular custo_medio
  UPDATE public.estoque SET valor_total = v_val_origem_antes,
    custo_medio = CASE WHEN quantidade>0 THEN round(v_val_origem_antes/quantidade,4) ELSE custo_medio END
   WHERE produto_id=v_prod_origem AND sala_id=v_sala_origem;
  UPDATE public.estoque SET valor_total = v_val_atende_antes,
    custo_medio = CASE WHEN quantidade>0 THEN round(v_val_atende_antes/quantidade,4) ELSE custo_medio END
   WHERE produto_id=v_prod_atende AND sala_id=_sala_atende;

  PERFORM public.log_event('lote.troca','Troca de lotes (rodízio de validade)','estoque', v_sala_origem, 'lote', _lote_curto,
    jsonb_build_object('sala_atende', _sala_atende, 'catalogo', v_catalogo, 'quantidade', _qtd, 'validade_curta', v_curto.validade));
END $$;
