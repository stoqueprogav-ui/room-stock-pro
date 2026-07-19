-- =====================================================================
--  REGRA NOVA — Composição do Valor do Estoque
-- =====================================================================

CREATE OR REPLACE FUNCTION public.patrimonio_totais(_sala uuid DEFAULT NULL)
RETURNS TABLE(
  valor_confirmado numeric,
  valor_estimado numeric,
  valor_patrimonial numeric,
  valor_compras numeric,
  valor_total_estoque numeric,
  quantidade_avaliada bigint,
  quantidade_estoque bigint,
  produtos_confirmados bigint,
  produtos_estimados bigint,
  produtos_sem_avaliacao bigint,
  cobertura_pct numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'master') THEN RAISE EXCEPTION 'acesso restrito ao master'; END IF;

  RETURN QUERY
  WITH ap AS (
    SELECT a.produto_id, a.sala_id,
           SUM(CASE WHEN a.tipo='confirmado' THEN a.quantidade_restante * a.valor_unitario ELSE 0 END)::numeric AS val_conf_ap,
           SUM(CASE WHEN a.tipo='estimado'   THEN a.quantidade_restante * a.valor_unitario ELSE 0 END)::numeric AS val_est_ap,
           SUM(a.quantidade_restante)::bigint AS qtd_ap
      FROM public.avaliacoes_patrimoniais a
     WHERE (_sala IS NULL OR a.sala_id = _sala)
       AND public.user_has_sala_access(auth.uid(), a.sala_id)
     GROUP BY a.produto_id, a.sala_id
  ),
  est AS (
    SELECT e.produto_id, e.sala_id, e.quantidade,
           COALESCE(e.custo_medio,0) AS cmp,
           COALESCE(p.custo_unitario,0) AS custo_ref
      FROM public.estoque e
      JOIN public.produtos p ON p.id = e.produto_id
     WHERE (_sala IS NULL OR e.sala_id = _sala)
       AND public.user_has_sala_access(auth.uid(), e.sala_id)
  ),
  merged AS (
    SELECT
      COALESCE(e.produto_id, ap.produto_id) AS produto_id,
      COALESCE(e.sala_id, ap.sala_id) AS sala_id,
      COALESCE(e.quantidade,0) AS qtd_est,
      COALESCE(e.cmp,0) AS cmp,
      COALESCE(e.custo_ref,0) AS custo_ref,
      COALESCE(ap.val_conf_ap,0) AS val_conf_ap,
      COALESCE(ap.val_est_ap,0) AS val_est_ap,
      COALESCE(ap.qtd_ap,0) AS qtd_ap,
      GREATEST(COALESCE(e.quantidade,0) - COALESCE(ap.qtd_ap,0), 0) AS qtd_na
    FROM est e FULL OUTER JOIN ap ON ap.produto_id = e.produto_id AND ap.sala_id = e.sala_id
  ),
  linhas AS (
    SELECT *,
      (CASE WHEN cmp > 0 THEN qtd_na * cmp ELSE 0 END)::numeric AS val_na_conf,
      (CASE WHEN cmp <= 0 AND custo_ref > 0 THEN qtd_na * custo_ref ELSE 0 END)::numeric AS val_na_est
    FROM merged
  ),
  tot AS (
    SELECT *,
      (val_conf_ap + val_na_conf)::numeric AS v_conf_total,
      (val_est_ap  + val_na_est )::numeric AS v_est_total
    FROM linhas
  ),
  agg AS (
    SELECT
      SUM(v_conf_total)::numeric AS v_conf,
      SUM(v_est_total)::numeric AS v_est,
      SUM(val_conf_ap + val_est_ap)::numeric AS v_aval,
      SUM(val_na_conf)::numeric AS v_comp,
      SUM(qtd_ap)::bigint AS q_ap,
      SUM(qtd_est)::bigint AS q_est,
      COUNT(*) FILTER (WHERE v_conf_total > 0)::bigint AS p_conf,
      COUNT(*) FILTER (WHERE v_est_total > 0 AND v_conf_total = 0)::bigint AS p_est,
      COUNT(*) FILTER (WHERE qtd_est > 0 AND v_conf_total = 0 AND v_est_total = 0)::bigint AS p_sem,
      COUNT(*) FILTER (WHERE qtd_est > 0)::bigint AS p_com_estoque
    FROM tot
  )
  SELECT
    v_conf, v_est,
    v_aval,
    v_comp,
    v_conf + v_est,
    q_ap, q_est,
    p_conf, p_est, p_sem,
    CASE WHEN p_com_estoque > 0
      THEN ROUND(((p_conf + p_est)::numeric / p_com_estoque::numeric) * 100, 1)
      ELSE 0 END
  FROM agg;
END;
$$;

CREATE OR REPLACE FUNCTION public.produtos_sem_avaliacao(_sala uuid DEFAULT NULL)
RETURNS TABLE(
  produto_id uuid,
  produto_nome text,
  categoria_nome text,
  sala_id uuid,
  sala_nome text,
  quantidade integer,
  custo_unitario_ref numeric,
  valor_total_atual numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'master') THEN RAISE EXCEPTION 'acesso restrito ao master'; END IF;
  RETURN QUERY
  SELECT p.id, p.nome, c.nome, s.id, s.nome,
         e.quantidade, COALESCE(p.custo_unitario,0),
         COALESCE(e.valor_total,0)
    FROM public.estoque e
    JOIN public.produtos p ON p.id = e.produto_id
    JOIN public.salas s ON s.id = e.sala_id
    LEFT JOIN public.categorias c ON c.id = p.categoria_id
   WHERE e.quantidade > 0
     AND COALESCE(p.ativo,true) = true
     AND (_sala IS NULL OR e.sala_id = _sala)
     AND public.user_has_sala_access(auth.uid(), e.sala_id)
     AND COALESCE(e.custo_medio,0) = 0
     AND COALESCE(p.custo_unitario,0) = 0
     AND NOT EXISTS (
       SELECT 1 FROM public.avaliacoes_patrimoniais ap
        WHERE ap.produto_id = p.id AND ap.sala_id = e.sala_id AND ap.quantidade_restante > 0
     )
   ORDER BY s.nome, p.nome;
END;
$$;