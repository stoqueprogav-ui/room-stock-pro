CREATE OR REPLACE FUNCTION public.resumo_regioes(
  _from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL)
RETURNS TABLE(
  regiao_id uuid, regiao_nome text, salas bigint,
  consumo_qtd bigint, consumo_valor numeric, valor_estoque numeric,
  requisicoes bigint, emprestimos bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    r.id, r.nome,
    (SELECT count(*) FROM public.salas s WHERE s.regiao_id = r.id),
    COALESCE((
      SELECT SUM(-m.quantidade) FROM public.movimentacoes m
      JOIN public.salas s ON s.id = m.sala_id
      WHERE s.regiao_id = r.id AND m.quantidade < 0
        AND m.tipo IN ('consumo_interno','saida','solicitacao')
        AND (_from IS NULL OR m.created_at >= _from) AND (_to IS NULL OR m.created_at <= _to)
    ),0)::bigint,
    COALESCE((
      SELECT SUM(CASE WHEN m.valor_financeiro > 0 THEN m.valor_financeiro
                      ELSE (-m.quantidade) * COALESCE(p.custo_unitario,0) END)
      FROM public.movimentacoes m
      JOIN public.salas s ON s.id = m.sala_id
      JOIN public.produtos p ON p.id = m.produto_id
      WHERE s.regiao_id = r.id AND m.quantidade < 0
        AND m.tipo IN ('consumo_interno','saida','solicitacao')
        AND (_from IS NULL OR m.created_at >= _from) AND (_to IS NULL OR m.created_at <= _to)
    ),0)::numeric,
    COALESCE((
      SELECT SUM(e.valor_total) FROM public.estoque e
      JOIN public.salas s ON s.id = e.sala_id WHERE s.regiao_id = r.id
    ),0)::numeric,
    (SELECT count(*) FROM public.solicitacoes so
       JOIN public.salas s ON s.id = so.sala_id
      WHERE s.regiao_id = r.id
        AND (_from IS NULL OR so.created_at >= _from) AND (_to IS NULL OR so.created_at <= _to)),
    (SELECT count(*) FROM public.emprestimos em
       JOIN public.salas s ON s.id = em.sala_origem_id
      WHERE s.regiao_id = r.id
        AND (_from IS NULL OR em.created_at >= _from) AND (_to IS NULL OR em.created_at <= _to))
  FROM public.regioes r
  WHERE public.user_has_regiao_access(auth.uid(), r.id)
  ORDER BY r.nome;
$$;

DROP FUNCTION IF EXISTS public.relatorio_consumo(timestamptz, timestamptz, uuid, uuid, uuid);
CREATE OR REPLACE FUNCTION public.relatorio_consumo(
  _from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL,
  _sala uuid DEFAULT NULL, _categoria uuid DEFAULT NULL, _produto uuid DEFAULT NULL,
  _regiao uuid DEFAULT NULL)
RETURNS TABLE(produto_id uuid, produto_nome text, categoria_id uuid, categoria_nome text,
              sala_id uuid, sala_nome text, quantidade bigint, custo_unitario numeric, valor numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    p.id, p.nome, c.id, c.nome, s.id, s.nome,
    COALESCE(SUM(-m.quantidade),0)::bigint,
    COALESCE(AVG(NULLIF(m.custo_unitario_aplicado,0)), p.custo_unitario, 0)::numeric,
    COALESCE(SUM(CASE WHEN m.valor_financeiro IS NOT NULL AND m.valor_financeiro > 0
                      THEN m.valor_financeiro
                      ELSE (-m.quantidade) * COALESCE(p.custo_unitario,0) END),0)::numeric
  FROM public.movimentacoes m
  JOIN public.produtos p ON p.id = m.produto_id
  LEFT JOIN public.categorias c ON c.id = p.categoria_id
  JOIN public.salas s ON s.id = m.sala_id
  WHERE m.quantidade < 0
    AND m.tipo IN ('consumo_interno','saida','solicitacao')
    AND public.user_has_sala_access(auth.uid(), m.sala_id)
    AND (_from IS NULL OR m.created_at >= _from)
    AND (_to   IS NULL OR m.created_at <= _to)
    AND (_sala IS NULL OR m.sala_id = _sala)
    AND (_categoria IS NULL OR p.categoria_id = _categoria)
    AND (_produto IS NULL OR p.id = _produto)
    AND (_regiao IS NULL OR s.regiao_id = _regiao)
  GROUP BY p.id, p.nome, c.id, c.nome, s.id, s.nome, p.custo_unitario;
$$;

DROP FUNCTION IF EXISTS public.consumo_mensal(timestamptz, timestamptz, uuid, uuid, uuid);
CREATE OR REPLACE FUNCTION public.consumo_mensal(
  _from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL,
  _sala uuid DEFAULT NULL, _categoria uuid DEFAULT NULL, _produto uuid DEFAULT NULL,
  _regiao uuid DEFAULT NULL)
RETURNS TABLE(mes date, quantidade bigint, valor numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    date_trunc('month', m.created_at)::date,
    COALESCE(SUM(-m.quantidade),0)::bigint,
    COALESCE(SUM(CASE WHEN m.valor_financeiro IS NOT NULL AND m.valor_financeiro > 0
                      THEN m.valor_financeiro
                      ELSE (-m.quantidade) * COALESCE(p.custo_unitario,0) END),0)::numeric
  FROM public.movimentacoes m
  JOIN public.produtos p ON p.id = m.produto_id
  JOIN public.salas s ON s.id = m.sala_id
  WHERE m.quantidade < 0
    AND m.tipo IN ('consumo_interno','saida','solicitacao')
    AND public.user_has_sala_access(auth.uid(), m.sala_id)
    AND (_from IS NULL OR m.created_at >= _from)
    AND (_to   IS NULL OR m.created_at <= _to)
    AND (_sala IS NULL OR m.sala_id = _sala)
    AND (_categoria IS NULL OR p.categoria_id = _categoria)
    AND (_produto IS NULL OR p.id = _produto)
    AND (_regiao IS NULL OR s.regiao_id = _regiao)
  GROUP BY 1
  ORDER BY 1;
$$;

CREATE OR REPLACE FUNCTION public.inventario_seguro(
  _regiao uuid DEFAULT NULL, _data timestamptz DEFAULT NULL)
RETURNS TABLE(
  regiao_id uuid, regiao_nome text, sala_id uuid, sala_nome text,
  produto_id uuid, produto_nome text, categoria_nome text,
  quantidade numeric, custo_unitario numeric, valor_total numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT r.id, r.nome, s.id, s.nome, p.id, p.nome, c.nome,
         e.quantidade::numeric, e.custo_medio, e.valor_total
  FROM public.estoque e
  JOIN public.salas s ON s.id = e.sala_id
  JOIN public.regioes r ON r.id = s.regiao_id
  JOIN public.produtos p ON p.id = e.produto_id
  LEFT JOIN public.categorias c ON c.id = p.categoria_id
  WHERE _data IS NULL
    AND e.quantidade > 0
    AND (_regiao IS NULL OR r.id = _regiao)
    AND public.user_has_regiao_access(auth.uid(), r.id)
  UNION ALL
  SELECT r.id, r.nome, s.id, s.nome, p.id, p.nome, c.nome,
         x.saldo::numeric, x.cmp, ROUND(x.saldo * x.cmp, 2)
  FROM (
    SELECT DISTINCT ON (m.produto_id, m.sala_id)
           m.produto_id, m.sala_id,
           m.saldo_apos AS saldo,
           COALESCE(NULLIF(m.custo_unitario_aplicado,0),
                    (SELECT e2.custo_medio FROM public.estoque e2
                      WHERE e2.produto_id = m.produto_id AND e2.sala_id = m.sala_id)) AS cmp
    FROM public.movimentacoes m
    WHERE _data IS NOT NULL AND m.created_at <= _data
    ORDER BY m.produto_id, m.sala_id, m.created_at DESC, m.id DESC
  ) x
  JOIN public.salas s ON s.id = x.sala_id
  JOIN public.regioes r ON r.id = s.regiao_id
  JOIN public.produtos p ON p.id = x.produto_id
  LEFT JOIN public.categorias c ON c.id = p.categoria_id
  WHERE _data IS NOT NULL
    AND x.saldo > 0
    AND (_regiao IS NULL OR r.id = _regiao)
    AND public.user_has_regiao_access(auth.uid(), r.id)
  ORDER BY 2, 4, 6;
$$;