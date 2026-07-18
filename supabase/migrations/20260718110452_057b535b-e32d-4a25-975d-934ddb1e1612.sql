CREATE OR REPLACE FUNCTION public.curva_abc(
  _from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL, _sala uuid DEFAULT NULL
)
RETURNS TABLE(produto_id uuid, produto_nome text, valor numeric, participacao_pct numeric, acumulado_pct numeric, classe text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH base AS (
    SELECT p.id AS produto_id, p.nome AS produto_nome,
           COALESCE(SUM(CASE WHEN m.valor_financeiro IS NOT NULL AND m.valor_financeiro > 0
                             THEN m.valor_financeiro
                             ELSE (-m.quantidade) * COALESCE(p.custo_unitario,0) END),0)::numeric AS val
      FROM public.movimentacoes m
      JOIN public.produtos p ON p.id = m.produto_id
     WHERE m.quantidade < 0
       AND m.tipo IN ('consumo_interno','saida','solicitacao')
       AND public.user_has_sala_access(auth.uid(), m.sala_id)
       AND (_from IS NULL OR m.created_at >= _from)
       AND (_to IS NULL OR m.created_at <= _to)
       AND (_sala IS NULL OR m.sala_id = _sala)
     GROUP BY p.id, p.nome, p.custo_unitario
     HAVING COALESCE(SUM(CASE WHEN m.valor_financeiro IS NOT NULL AND m.valor_financeiro > 0
                              THEN m.valor_financeiro
                              ELSE (-m.quantidade) * COALESCE(p.custo_unitario,0) END),0) > 0
  ), tot AS (SELECT COALESCE(SUM(val),0) AS total FROM base),
  ord AS (
    SELECT b.*,
           CASE WHEN tot.total>0 THEN ROUND(b.val/tot.total*100,2) ELSE 0 END AS pct,
           SUM(b.val) OVER (ORDER BY b.val DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS acc,
           tot.total AS total
      FROM base b CROSS JOIN tot
  )
  SELECT produto_id, produto_nome, val, pct,
         CASE WHEN total>0 THEN ROUND(acc/total*100,2) ELSE 0 END,
         CASE
           WHEN total > 0 AND acc/total*100 <= 80 THEN 'A'
           WHEN total > 0 AND acc/total*100 <= 95 THEN 'B'
           ELSE 'C'
         END
    FROM ord
   ORDER BY val DESC;
$$;