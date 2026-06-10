
-- ============================================================
-- FASE 1 — Migração 3: RPCs financeiras
-- ============================================================

-- Atualiza valor_estoque_por_sala para usar o novo custo_medio
CREATE OR REPLACE FUNCTION public.valor_estoque_por_sala()
RETURNS TABLE(sala_id uuid, sala_nome text, total_itens bigint, valor_total numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT s.id, s.nome,
         COALESCE(SUM(e.quantidade),0)::bigint,
         COALESCE(SUM(e.valor_total),0)::numeric
    FROM public.salas s
    LEFT JOIN public.estoque e ON e.sala_id = s.id
   GROUP BY s.id, s.nome
   ORDER BY 4 DESC;
$$;

CREATE OR REPLACE FUNCTION public.patrimonio_global()
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT COALESCE(SUM(valor_total),0)::numeric FROM public.estoque; $$;

-- Consumo financeiro detalhado (usa valor_financeiro congelado nas movimentações)
CREATE OR REPLACE FUNCTION public.relatorio_consumo_financeiro(
  _from timestamptz DEFAULT NULL,
  _to timestamptz DEFAULT NULL,
  _sala uuid DEFAULT NULL,
  _categoria uuid DEFAULT NULL,
  _produto uuid DEFAULT NULL
) RETURNS TABLE(
  produto_id uuid, produto_nome text,
  categoria_id uuid, categoria_nome text,
  sala_id uuid, sala_nome text,
  quantidade bigint, valor numeric
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    p.id, p.nome, c.id, c.nome, s.id, s.nome,
    COALESCE(SUM(-m.quantidade),0)::bigint,
    COALESCE(SUM(m.valor_financeiro),0)::numeric
  FROM public.movimentacoes m
  JOIN public.produtos p ON p.id = m.produto_id
  LEFT JOIN public.categorias c ON c.id = p.categoria_id
  JOIN public.salas s ON s.id = m.sala_id
  WHERE m.quantidade < 0
    AND m.tipo IN ('consumo_interno','solicitacao','emprestimo_saida','ajuste')
    AND (_from IS NULL OR m.created_at >= _from)
    AND (_to IS NULL OR m.created_at <= _to)
    AND (_sala IS NULL OR m.sala_id = _sala)
    AND (_categoria IS NULL OR p.categoria_id = _categoria)
    AND (_produto IS NULL OR p.id = _produto)
  GROUP BY p.id, p.nome, c.id, c.nome, s.id, s.nome;
$$;

-- Custo por sala com participação
CREATE OR REPLACE FUNCTION public.relatorio_custo_por_sala(
  _from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL
) RETURNS TABLE(sala_id uuid, sala_nome text, quantidade bigint, valor numeric, participacao_pct numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH base AS (
    SELECT s.id AS sala_id, s.nome AS sala_nome,
           COALESCE(SUM(-m.quantidade),0)::bigint AS qtd,
           COALESCE(SUM(m.valor_financeiro),0)::numeric AS val
      FROM public.salas s
      LEFT JOIN public.movimentacoes m
        ON m.sala_id = s.id AND m.quantidade < 0
       AND m.tipo IN ('consumo_interno','solicitacao','emprestimo_saida','ajuste')
       AND (_from IS NULL OR m.created_at >= _from)
       AND (_to IS NULL OR m.created_at <= _to)
     GROUP BY s.id, s.nome
  ), tot AS (SELECT COALESCE(SUM(val),0) AS total FROM base)
  SELECT b.sala_id, b.sala_nome, b.qtd, b.val,
         CASE WHEN tot.total > 0 THEN ROUND(b.val/tot.total*100,2) ELSE 0 END
    FROM base b CROSS JOIN tot ORDER BY b.val DESC;
$$;

-- Categorias com valor consumido
CREATE OR REPLACE FUNCTION public.relatorio_categorias_financeiro(
  _from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL, _sala uuid DEFAULT NULL
) RETURNS TABLE(categoria_id uuid, categoria_nome text, quantidade bigint, valor numeric, participacao_pct numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH base AS (
    SELECT c.id AS categoria_id, COALESCE(c.nome,'Sem categoria') AS categoria_nome,
           COALESCE(SUM(-m.quantidade),0)::bigint AS qtd,
           COALESCE(SUM(m.valor_financeiro),0)::numeric AS val
      FROM public.movimentacoes m
      JOIN public.produtos p ON p.id = m.produto_id
      LEFT JOIN public.categorias c ON c.id = p.categoria_id
     WHERE m.quantidade < 0
       AND m.tipo IN ('consumo_interno','solicitacao','emprestimo_saida','ajuste')
       AND (_from IS NULL OR m.created_at >= _from)
       AND (_to IS NULL OR m.created_at <= _to)
       AND (_sala IS NULL OR m.sala_id = _sala)
     GROUP BY c.id, c.nome
  ), tot AS (SELECT COALESCE(SUM(val),0) AS total FROM base)
  SELECT b.categoria_id, b.categoria_nome, b.qtd, b.val,
         CASE WHEN tot.total > 0 THEN ROUND(b.val/tot.total*100,2) ELSE 0 END
    FROM base b CROSS JOIN tot ORDER BY b.val DESC;
$$;

-- Top produtos por valor
CREATE OR REPLACE FUNCTION public.relatorio_top_produtos_financeiro(
  _from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL,
  _sala uuid DEFAULT NULL, _limit integer DEFAULT 20
) RETURNS TABLE(produto_id uuid, produto_nome text, quantidade bigint, valor numeric, participacao_pct numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH base AS (
    SELECT p.id AS produto_id, p.nome AS produto_nome,
           COALESCE(SUM(-m.quantidade),0)::bigint AS qtd,
           COALESCE(SUM(m.valor_financeiro),0)::numeric AS val
      FROM public.movimentacoes m
      JOIN public.produtos p ON p.id = m.produto_id
     WHERE m.quantidade < 0
       AND m.tipo IN ('consumo_interno','solicitacao','emprestimo_saida','ajuste')
       AND (_from IS NULL OR m.created_at >= _from)
       AND (_to IS NULL OR m.created_at <= _to)
       AND (_sala IS NULL OR m.sala_id = _sala)
     GROUP BY p.id, p.nome
  ), tot AS (SELECT COALESCE(SUM(val),0) AS total FROM base)
  SELECT b.produto_id, b.produto_nome, b.qtd, b.val,
         CASE WHEN tot.total > 0 THEN ROUND(b.val/tot.total*100,2) ELSE 0 END
    FROM base b CROSS JOIN tot ORDER BY b.val DESC LIMIT LEAST(GREATEST(_limit,1),100);
$$;

-- Curva ABC
CREATE OR REPLACE FUNCTION public.curva_abc(
  _from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL, _sala uuid DEFAULT NULL
) RETURNS TABLE(produto_id uuid, produto_nome text, valor numeric, participacao_pct numeric, acumulado_pct numeric, classe text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH base AS (
    SELECT p.id AS produto_id, p.nome AS produto_nome,
           COALESCE(SUM(m.valor_financeiro),0)::numeric AS val
      FROM public.movimentacoes m
      JOIN public.produtos p ON p.id = m.produto_id
     WHERE m.quantidade < 0
       AND m.tipo IN ('consumo_interno','solicitacao','emprestimo_saida','ajuste')
       AND (_from IS NULL OR m.created_at >= _from)
       AND (_to IS NULL OR m.created_at <= _to)
       AND (_sala IS NULL OR m.sala_id = _sala)
     GROUP BY p.id, p.nome
     HAVING COALESCE(SUM(m.valor_financeiro),0) > 0
  ), tot AS (SELECT COALESCE(SUM(val),0) AS total FROM base),
  ordered AS (
    SELECT b.*, SUM(b.val) OVER (ORDER BY b.val DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS acum
      FROM base b
  )
  SELECT o.produto_id, o.produto_nome, o.val,
         CASE WHEN tot.total>0 THEN ROUND(o.val/tot.total*100,2) ELSE 0 END,
         CASE WHEN tot.total>0 THEN ROUND(o.acum/tot.total*100,2) ELSE 0 END,
         CASE
           WHEN tot.total>0 AND o.acum/tot.total <= 0.80 THEN 'A'
           WHEN tot.total>0 AND o.acum/tot.total <= 0.95 THEN 'B'
           ELSE 'C'
         END
    FROM ordered o CROSS JOIN tot ORDER BY o.val DESC;
$$;

-- Comparativo entre salas
CREATE OR REPLACE FUNCTION public.comparativo_salas_financeiro(
  _from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL
) RETURNS TABLE(sala_id uuid, sala_nome text, quantidade_consumida bigint, valor_consumido numeric, valor_em_estoque numeric, participacao_pct numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH cons AS (
    SELECT s.id AS sala_id, s.nome AS sala_nome,
           COALESCE(SUM(-m.quantidade),0)::bigint AS qtd,
           COALESCE(SUM(m.valor_financeiro),0)::numeric AS val
      FROM public.salas s
      LEFT JOIN public.movimentacoes m ON m.sala_id = s.id AND m.quantidade < 0
       AND m.tipo IN ('consumo_interno','solicitacao','emprestimo_saida','ajuste')
       AND (_from IS NULL OR m.created_at >= _from)
       AND (_to IS NULL OR m.created_at <= _to)
     GROUP BY s.id, s.nome
  ), est AS (
    SELECT sala_id, COALESCE(SUM(valor_total),0) AS valor_est
      FROM public.estoque GROUP BY sala_id
  ), tot AS (SELECT COALESCE(SUM(val),0) AS total FROM cons)
  SELECT c.sala_id, c.sala_nome, c.qtd, c.val, COALESCE(e.valor_est,0),
         CASE WHEN tot.total>0 THEN ROUND(c.val/tot.total*100,2) ELSE 0 END
    FROM cons c LEFT JOIN est e ON e.sala_id = c.sala_id CROSS JOIN tot
   ORDER BY c.val DESC;
$$;

-- Evolução mensal: compras vs consumo
CREATE OR REPLACE FUNCTION public.evolucao_mensal_financeira(_meses integer DEFAULT 12)
RETURNS TABLE(mes date, valor_compras numeric, valor_consumido numeric, quantidade_consumida bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH meses AS (
    SELECT generate_series(
      date_trunc('month', now()) - ((_meses-1) || ' months')::interval,
      date_trunc('month', now()),
      '1 month'::interval
    )::date AS mes
  ),
  compras AS (
    SELECT date_trunc('month', data_entrada)::date AS mes,
           SUM(valor_total) AS valor
      FROM public.entradas_estoque
     WHERE data_entrada >= date_trunc('month', now()) - ((_meses-1)||' months')::interval
     GROUP BY 1
  ),
  cons AS (
    SELECT date_trunc('month', created_at)::date AS mes,
           SUM(valor_financeiro) AS valor,
           SUM(-quantidade) AS qtd
      FROM public.movimentacoes
     WHERE quantidade < 0
       AND tipo IN ('consumo_interno','solicitacao','emprestimo_saida','ajuste')
       AND created_at >= date_trunc('month', now()) - ((_meses-1)||' months')::interval
     GROUP BY 1
  )
  SELECT m.mes,
         COALESCE(c.valor,0)::numeric,
         COALESCE(co.valor,0)::numeric,
         COALESCE(co.qtd,0)::bigint
    FROM meses m
    LEFT JOIN compras c ON c.mes = m.mes
    LEFT JOIN cons co ON co.mes = m.mes
   ORDER BY m.mes;
$$;
