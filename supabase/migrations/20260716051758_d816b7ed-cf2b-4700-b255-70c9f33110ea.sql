CREATE OR REPLACE FUNCTION public.consumo_mensal(
  _from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL,
  _sala uuid DEFAULT NULL, _categoria uuid DEFAULT NULL, _produto uuid DEFAULT NULL)
RETURNS TABLE(mes date, quantidade bigint, valor numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    date_trunc('month', m.created_at)::date AS mes,
    COALESCE(SUM(-m.quantidade),0)::bigint AS quantidade,
    COALESCE(SUM(
      CASE WHEN m.valor_financeiro IS NOT NULL AND m.valor_financeiro > 0
           THEN m.valor_financeiro
           ELSE (-m.quantidade) * COALESCE(p.custo_unitario,0)
      END
    ),0)::numeric AS valor
  FROM public.movimentacoes m
  JOIN public.produtos p ON p.id = m.produto_id
  WHERE m.quantidade < 0
    AND m.tipo IN ('consumo_interno','saida','solicitacao')
    AND public.user_has_sala_access(auth.uid(), m.sala_id)
    AND (_from IS NULL OR m.created_at >= _from)
    AND (_to   IS NULL OR m.created_at <= _to)
    AND (_sala IS NULL OR m.sala_id = _sala)
    AND (_categoria IS NULL OR p.categoria_id = _categoria)
    AND (_produto IS NULL OR p.id = _produto)
  GROUP BY 1
  ORDER BY 1;
$$;