CREATE OR REPLACE FUNCTION public.relatorio_consumo(_from timestamp with time zone DEFAULT NULL::timestamp with time zone, _to timestamp with time zone DEFAULT NULL::timestamp with time zone, _sala uuid DEFAULT NULL::uuid, _categoria uuid DEFAULT NULL::uuid, _produto uuid DEFAULT NULL::uuid)
 RETURNS TABLE(produto_id uuid, produto_nome text, categoria_id uuid, categoria_nome text, sala_id uuid, sala_nome text, quantidade bigint, custo_unitario numeric, valor numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    p.id, p.nome,
    c.id, c.nome,
    s.id, s.nome,
    COALESCE(SUM(-m.quantidade),0)::bigint AS quantidade,
    COALESCE(AVG(NULLIF(m.custo_unitario_aplicado,0)), p.custo_unitario, 0)::numeric AS custo_unitario,
    COALESCE(SUM(
      CASE WHEN m.valor_financeiro IS NOT NULL AND m.valor_financeiro > 0
           THEN m.valor_financeiro
           ELSE (-m.quantidade) * COALESCE(p.custo_unitario,0)
      END
    ),0)::numeric AS valor
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
  GROUP BY p.id, p.nome, c.id, c.nome, s.id, s.nome, p.custo_unitario;
$function$;