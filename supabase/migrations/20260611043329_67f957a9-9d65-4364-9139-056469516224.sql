
-- 1. Add quantidade_valorizada column
ALTER TABLE public.estoque
  ADD COLUMN IF NOT EXISTS quantidade_valorizada integer NOT NULL DEFAULT 0;

-- 2. Backfill
UPDATE public.estoque
   SET quantidade_valorizada = CASE WHEN COALESCE(custo_medio,0) > 0 THEN GREATEST(quantidade,0) ELSE 0 END,
       valor_total = CASE WHEN COALESCE(custo_medio,0) > 0 THEN ROUND(GREATEST(quantidade,0) * custo_medio, 2) ELSE 0 END;

-- 3. Helper to recompute valor_total based on quantidade_valorizada
CREATE OR REPLACE FUNCTION public._recalc_estoque_valor(_produto uuid, _sala uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.estoque
     SET quantidade_valorizada = LEAST(GREATEST(quantidade_valorizada,0), GREATEST(quantidade,0)),
         valor_total = ROUND(LEAST(GREATEST(quantidade_valorizada,0), GREATEST(quantidade,0)) * COALESCE(custo_medio,0), 2)
   WHERE produto_id = _produto AND sala_id = _sala;
$$;

-- 4. Fix registrar_entrada_estoque: ignore legacy zero-cost stock in CMP
CREATE OR REPLACE FUNCTION public.registrar_entrada_estoque(
  _produto uuid, _sala uuid, _quantidade integer, _valor_unitario numeric,
  _fornecedor text DEFAULT NULL, _numero_nf text DEFAULT NULL,
  _data_entrada timestamptz DEFAULT NULL, _observacao text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_nome text;
  v_qtd_atual integer;
  v_cmp_atual numeric;
  v_qtd_val_atual integer;
  v_qtd_nova integer;
  v_qtd_val_nova integer;
  v_cmp_novo numeric;
  v_entrada_id uuid;
  v_valor_total_novo numeric;
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN
    RAISE EXCEPTION 'apenas master pode registrar entradas';
  END IF;
  IF _quantidade IS NULL OR _quantidade <= 0 THEN RAISE EXCEPTION 'quantidade inválida'; END IF;
  IF _valor_unitario IS NULL OR _valor_unitario < 0 THEN RAISE EXCEPTION 'valor unitário inválido'; END IF;

  SELECT nome INTO v_nome FROM public.profiles WHERE id = v_user;

  INSERT INTO public.estoque (produto_id, sala_id, quantidade, custo_medio, valor_total, quantidade_valorizada)
  VALUES (_produto, _sala, 0, 0, 0, 0)
  ON CONFLICT (produto_id, sala_id) DO NOTHING;

  SELECT quantidade, custo_medio, quantidade_valorizada
    INTO v_qtd_atual, v_cmp_atual, v_qtd_val_atual
    FROM public.estoque WHERE produto_id = _produto AND sala_id = _sala
    FOR UPDATE;

  v_qtd_nova := v_qtd_atual + _quantidade;
  v_qtd_val_nova := COALESCE(v_qtd_val_atual,0) + _quantidade;

  -- CMP ponderada apenas com unidades valorizadas. Se não havia valor antes, usa o novo.
  IF COALESCE(v_qtd_val_atual,0) <= 0 OR COALESCE(v_cmp_atual,0) <= 0 THEN
    v_cmp_novo := _valor_unitario;
  ELSE
    v_cmp_novo := ROUND(
      ((v_qtd_val_atual::numeric * v_cmp_atual) + (_quantidade::numeric * _valor_unitario))
      / v_qtd_val_nova::numeric, 4);
  END IF;

  v_valor_total_novo := ROUND(v_qtd_val_nova * v_cmp_novo, 2);

  UPDATE public.estoque
     SET quantidade = v_qtd_nova,
         quantidade_valorizada = v_qtd_val_nova,
         custo_medio = v_cmp_novo,
         valor_total = v_valor_total_novo
   WHERE produto_id = _produto AND sala_id = _sala;

  INSERT INTO public.entradas_estoque
    (produto_id, sala_id, quantidade, valor_unitario, fornecedor, numero_nf,
     data_entrada, observacao, usuario_responsavel, usuario_responsavel_nome)
  VALUES (_produto, _sala, _quantidade, _valor_unitario, NULLIF(trim(_fornecedor),''),
          NULLIF(trim(_numero_nf),''), COALESCE(_data_entrada, now()),
          NULLIF(trim(_observacao),''), v_user, v_nome)
  RETURNING id INTO v_entrada_id;

  INSERT INTO public.movimentacoes
    (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos,
     referencia_tipo, referencia_id, observacao,
     custo_unitario_aplicado, valor_financeiro)
  VALUES (_produto, _sala, v_user, 'entrada', _quantidade, v_qtd_nova,
          'entrada_estoque', v_entrada_id,
          COALESCE('Compra'||CASE WHEN _fornecedor IS NOT NULL THEN ' — '||_fornecedor ELSE '' END
                   ||CASE WHEN _numero_nf IS NOT NULL THEN ' (NF '||_numero_nf||')' ELSE '' END, 'Compra'),
          _valor_unitario,
          ROUND(_quantidade * _valor_unitario, 2));

  PERFORM public.log_event(
    'estoque.entrada','Entrada de estoque registrada','estoque', _sala, 'entrada_estoque', v_entrada_id,
    jsonb_build_object('produto_id', _produto, 'quantidade', _quantidade,
                       'valor_unitario', _valor_unitario, 'cmp_novo', v_cmp_novo,
                       'fornecedor', _fornecedor, 'numero_nf', _numero_nf));
  RETURN v_entrada_id;
END;
$$;

-- 5. Helper to decrement valorizada portion on saídas
CREATE OR REPLACE FUNCTION public._baixar_valorizada(_produto uuid, _sala uuid, _quantidade integer)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.estoque
     SET quantidade_valorizada = GREATEST(quantidade_valorizada - LEAST(_quantidade, quantidade_valorizada), 0)
   WHERE produto_id = _produto AND sala_id = _sala AND COALESCE(custo_medio,0) > 0;
$$;

-- 6. Backfill existing valor_total
UPDATE public.estoque
   SET valor_total = ROUND(LEAST(GREATEST(quantidade_valorizada,0), GREATEST(quantidade,0)) * COALESCE(custo_medio,0), 2);

-- 7. Update estatisticas_valorizacao to use quantidade_valorizada
CREATE OR REPLACE FUNCTION public.estatisticas_valorizacao()
RETURNS TABLE(produtos_valorizados bigint, produtos_sem_valor bigint, produtos_total bigint,
              percentual_valorizado numeric, itens_valorizados bigint, itens_sem_valor bigint, patrimonio_total numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'master') THEN RAISE EXCEPTION 'acesso restrito ao master'; END IF;
  RETURN QUERY
  WITH prod AS (
    SELECT p.id, BOOL_OR(COALESCE(e.custo_medio,0) > 0) AS valorizado
      FROM public.produtos p
      LEFT JOIN public.estoque e ON e.produto_id = p.id
     WHERE COALESCE(p.ativo, true) = true
     GROUP BY p.id
  ), est AS (
    SELECT
      COALESCE(SUM(quantidade_valorizada),0)::bigint AS itens_val,
      COALESCE(SUM(GREATEST(quantidade - quantidade_valorizada, 0)),0)::bigint AS itens_sv,
      COALESCE(SUM(valor_total),0)::numeric AS patrim
      FROM public.estoque
  ), tot AS (
    SELECT COUNT(*)::bigint AS total,
           COUNT(*) FILTER (WHERE valorizado)::bigint AS val
    FROM prod
  )
  SELECT
    (SELECT val FROM tot),
    (SELECT total - val FROM tot),
    (SELECT total FROM tot),
    CASE WHEN (SELECT total FROM tot) = 0 THEN 0
         ELSE ROUND(((SELECT val FROM tot)::numeric * 100) / (SELECT total FROM tot)::numeric, 1)
    END,
    (SELECT itens_val FROM est),
    (SELECT itens_sv FROM est),
    (SELECT patrim FROM est);
END;
$$;

-- 8. valor_estoque_por_sala uses quantidade_valorizada
CREATE OR REPLACE FUNCTION public.valor_estoque_por_sala()
RETURNS TABLE(sala_id uuid, sala_nome text, total_itens bigint, itens_sem_valor bigint, valor_total numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'master') THEN RAISE EXCEPTION 'acesso restrito ao master'; END IF;
  RETURN QUERY
  SELECT s.id, s.nome,
         COALESCE(SUM(e.quantidade_valorizada),0)::bigint,
         COALESCE(SUM(GREATEST(e.quantidade - e.quantidade_valorizada, 0)),0)::bigint,
         COALESCE(SUM(e.valor_total),0)::numeric
    FROM public.salas s
    LEFT JOIN public.estoque e ON e.sala_id = s.id
   GROUP BY s.id, s.nome
   ORDER BY 5 DESC;
END;
$$;
