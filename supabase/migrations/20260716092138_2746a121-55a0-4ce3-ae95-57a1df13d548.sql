CREATE OR REPLACE FUNCTION public.consumo_por_regiao(
  _from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL)
RETURNS TABLE(regiao_id uuid, regiao_nome text, quantidade bigint, valor numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    r.id, r.nome,
    COALESCE(SUM(-m.quantidade),0)::bigint,
    COALESCE(SUM(
      CASE WHEN m.valor_financeiro IS NOT NULL AND m.valor_financeiro > 0
           THEN m.valor_financeiro
           ELSE (-m.quantidade) * COALESCE(p.custo_unitario,0)
      END
    ),0)::numeric
  FROM public.movimentacoes m
  JOIN public.produtos p ON p.id = m.produto_id
  JOIN public.salas s ON s.id = m.sala_id
  JOIN public.regioes r ON r.id = s.regiao_id
  WHERE m.quantidade < 0
    AND m.tipo IN ('consumo_interno','saida','solicitacao')
    AND public.user_has_regiao_access(auth.uid(), s.regiao_id)
    AND (_from IS NULL OR m.created_at >= _from)
    AND (_to   IS NULL OR m.created_at <= _to)
  GROUP BY r.id, r.nome
  ORDER BY r.nome;
$$;

CREATE OR REPLACE FUNCTION public.valor_estoque_por_regiao()
RETURNS TABLE(regiao_id uuid, regiao_nome text, itens bigint, valor_total numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    r.id, r.nome,
    COALESCE(SUM(e.quantidade),0)::bigint,
    COALESCE(SUM(e.valor_total),0)::numeric
  FROM public.estoque e
  JOIN public.salas s ON s.id = e.sala_id
  JOIN public.regioes r ON r.id = s.regiao_id
  WHERE public.user_has_regiao_access(auth.uid(), s.regiao_id)
  GROUP BY r.id, r.nome
  ORDER BY r.nome;
$$;