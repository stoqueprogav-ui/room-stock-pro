CREATE OR REPLACE FUNCTION public.relatorio_consumo_financeiro(
  _from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL,
  _sala uuid DEFAULT NULL, _categoria uuid DEFAULT NULL, _produto uuid DEFAULT NULL
)
RETURNS TABLE(produto_id uuid, produto_nome text, categoria_id uuid, categoria_nome text, sala_id uuid, sala_nome text, quantidade bigint, valor numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT p.id, p.nome, c.id, c.nome, s.id, s.nome,
         COALESCE(SUM(-m.quantidade),0)::bigint,
         COALESCE(SUM(m.valor_financeiro),0)::numeric
    FROM public.movimentacoes m
    JOIN public.produtos p ON p.id = m.produto_id
    LEFT JOIN public.categorias c ON c.id = p.categoria_id
    JOIN public.salas s ON s.id = m.sala_id
   WHERE m.quantidade < 0
     AND m.tipo IN ('consumo_interno','saida','solicitacao')
     AND COALESCE(m.valor_financeiro,0) > 0
     AND public.user_has_sala_access(auth.uid(), m.sala_id)
     AND (_from IS NULL OR m.created_at >= _from)
     AND (_to IS NULL OR m.created_at <= _to)
     AND (_sala IS NULL OR m.sala_id = _sala)
     AND (_categoria IS NULL OR p.categoria_id = _categoria)
     AND (_produto IS NULL OR p.id = _produto)
   GROUP BY p.id, p.nome, c.id, c.nome, s.id, s.nome;
$$;

CREATE OR REPLACE FUNCTION public.relatorio_top_produtos_financeiro(
  _from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL,
  _sala uuid DEFAULT NULL, _limit int DEFAULT 20
)
RETURNS TABLE(produto_id uuid, produto_nome text, quantidade bigint, valor numeric, participacao_pct numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH base AS (
    SELECT p.id AS produto_id, p.nome AS produto_nome,
           COALESCE(SUM(-m.quantidade),0)::bigint AS qtd,
           COALESCE(SUM(m.valor_financeiro),0)::numeric AS val
      FROM public.movimentacoes m
      JOIN public.produtos p ON p.id = m.produto_id
     WHERE m.quantidade < 0
       AND m.tipo IN ('consumo_interno','saida','solicitacao')
       AND COALESCE(m.valor_financeiro,0) > 0
       AND public.user_has_sala_access(auth.uid(), m.sala_id)
       AND (_from IS NULL OR m.created_at >= _from)
       AND (_to IS NULL OR m.created_at <= _to)
       AND (_sala IS NULL OR m.sala_id = _sala)
     GROUP BY p.id, p.nome
  ), tot AS (SELECT COALESCE(SUM(val),0) AS total FROM base)
  SELECT b.produto_id, b.produto_nome, b.qtd, b.val,
         CASE WHEN tot.total > 0 THEN ROUND(b.val/tot.total*100,2) ELSE 0 END
    FROM base b CROSS JOIN tot
   ORDER BY b.val DESC
   LIMIT GREATEST(COALESCE(_limit,20),1);
$$;

CREATE OR REPLACE FUNCTION public.relatorio_categorias_financeiro(
  _from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL, _sala uuid DEFAULT NULL
)
RETURNS TABLE(categoria_id uuid, categoria_nome text, quantidade bigint, valor numeric, participacao_pct numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH base AS (
    SELECT c.id AS categoria_id, COALESCE(c.nome,'Sem categoria') AS categoria_nome,
           COALESCE(SUM(-m.quantidade),0)::bigint AS qtd,
           COALESCE(SUM(m.valor_financeiro),0)::numeric AS val
      FROM public.movimentacoes m
      JOIN public.produtos p ON p.id = m.produto_id
      LEFT JOIN public.categorias c ON c.id = p.categoria_id
     WHERE m.quantidade < 0
       AND m.tipo IN ('consumo_interno','saida','solicitacao')
       AND COALESCE(m.valor_financeiro,0) > 0
       AND public.user_has_sala_access(auth.uid(), m.sala_id)
       AND (_from IS NULL OR m.created_at >= _from)
       AND (_to IS NULL OR m.created_at <= _to)
       AND (_sala IS NULL OR m.sala_id = _sala)
     GROUP BY c.id, c.nome
  ), tot AS (SELECT COALESCE(SUM(val),0) AS total FROM base)
  SELECT b.categoria_id, b.categoria_nome, b.qtd, b.val,
         CASE WHEN tot.total > 0 THEN ROUND(b.val/tot.total*100,2) ELSE 0 END
    FROM base b CROSS JOIN tot ORDER BY b.val DESC;
$$;

CREATE OR REPLACE FUNCTION public.curva_abc(
  _from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL, _sala uuid DEFAULT NULL
)
RETURNS TABLE(produto_id uuid, produto_nome text, valor numeric, participacao_pct numeric, acumulado_pct numeric, classe text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH base AS (
    SELECT p.id AS produto_id, p.nome AS produto_nome,
           COALESCE(SUM(m.valor_financeiro),0)::numeric AS val
      FROM public.movimentacoes m
      JOIN public.produtos p ON p.id = m.produto_id
     WHERE m.quantidade < 0
       AND m.tipo IN ('consumo_interno','saida','solicitacao')
       AND COALESCE(m.valor_financeiro,0) > 0
       AND public.user_has_sala_access(auth.uid(), m.sala_id)
       AND (_from IS NULL OR m.created_at >= _from)
       AND (_to IS NULL OR m.created_at <= _to)
       AND (_sala IS NULL OR m.sala_id = _sala)
     GROUP BY p.id, p.nome
     HAVING COALESCE(SUM(m.valor_financeiro),0) > 0
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

CREATE OR REPLACE FUNCTION public.evolucao_mensal_financeira(_meses int DEFAULT 12)
RETURNS TABLE(mes date, valor_compras numeric, valor_consumido numeric, quantidade_consumida bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH meses AS (
    SELECT (date_trunc('month', now())::date - (g || ' months')::interval)::date AS mes
      FROM generate_series(0, GREATEST(_meses,1)-1) g
  ),
  compras AS (
    SELECT date_trunc('month', data_entrada)::date AS mes,
           COALESCE(SUM(valor_total),0)::numeric AS val
      FROM public.entradas_estoque
     WHERE COALESCE(valor_total,0) > 0
       AND public.user_has_sala_access(auth.uid(), sala_id)
     GROUP BY 1
  ),
  consumo AS (
    SELECT date_trunc('month', created_at)::date AS mes,
           COALESCE(SUM(valor_financeiro),0)::numeric AS val,
           COALESCE(SUM(-quantidade),0)::bigint AS qtd
      FROM public.movimentacoes
     WHERE quantidade < 0
       AND tipo IN ('consumo_interno','saida','solicitacao')
       AND COALESCE(valor_financeiro,0) > 0
       AND public.user_has_sala_access(auth.uid(), sala_id)
     GROUP BY 1
  )
  SELECT m.mes,
         COALESCE(c.val,0), COALESCE(k.val,0), COALESCE(k.qtd,0)
    FROM meses m
    LEFT JOIN compras c ON c.mes = m.mes
    LEFT JOIN consumo k ON k.mes = m.mes
   ORDER BY m.mes;
$$;