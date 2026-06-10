
-- ============================================================
-- Restringe TODOS os dados financeiros ao perfil MASTER
-- ============================================================

-- ---------- 1) Guards nos RPCs financeiros ----------
CREATE OR REPLACE FUNCTION public.patrimonio_global() RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v numeric;
BEGIN
  IF NOT public.has_role(auth.uid(),'master') THEN RAISE EXCEPTION 'acesso restrito ao master'; END IF;
  SELECT COALESCE(SUM(valor_total),0)::numeric INTO v FROM public.estoque;
  RETURN v;
END$$;

CREATE OR REPLACE FUNCTION public.estatisticas_valorizacao()
RETURNS TABLE(produtos_valorizados bigint, produtos_sem_valor bigint, produtos_total bigint,
              percentual_valorizado numeric, itens_valorizados bigint, itens_sem_valor bigint, patrimonio_total numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
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
      COALESCE(SUM(CASE WHEN COALESCE(custo_medio,0) > 0 THEN quantidade ELSE 0 END),0)::bigint AS itens_val,
      COALESCE(SUM(CASE WHEN COALESCE(custo_medio,0) = 0 THEN quantidade ELSE 0 END),0)::bigint AS itens_sv,
      COALESCE(SUM(valor_total),0)::numeric AS patrim
      FROM public.estoque
  )
  SELECT
    (SELECT COUNT(*) FROM prod WHERE valorizado = true)::bigint,
    (SELECT COUNT(*) FROM prod WHERE COALESCE(valorizado,false) = false)::bigint,
    (SELECT COUNT(*) FROM prod)::bigint,
    CASE WHEN (SELECT COUNT(*) FROM prod) > 0
         THEN ROUND((SELECT COUNT(*) FROM prod WHERE valorizado = true)::numeric * 100 / (SELECT COUNT(*) FROM prod), 2)
         ELSE 0 END,
    est.itens_val, est.itens_sv, est.patrim
  FROM est;
END$$;

CREATE OR REPLACE FUNCTION public.valor_estoque_por_sala()
RETURNS TABLE(sala_id uuid, sala_nome text, total_itens bigint, itens_sem_valor bigint, valor_total numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'master') THEN RAISE EXCEPTION 'acesso restrito ao master'; END IF;
  RETURN QUERY
  SELECT s.id, s.nome,
         COALESCE(SUM(CASE WHEN COALESCE(e.custo_medio,0) > 0 THEN e.quantidade ELSE 0 END),0)::bigint,
         COALESCE(SUM(CASE WHEN COALESCE(e.custo_medio,0) = 0 THEN e.quantidade ELSE 0 END),0)::bigint,
         COALESCE(SUM(e.valor_total),0)::numeric
    FROM public.salas s
    LEFT JOIN public.estoque e ON e.sala_id = s.id
   GROUP BY s.id, s.nome
   ORDER BY 5 DESC;
END$$;

CREATE OR REPLACE FUNCTION public.curva_abc(_from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL, _sala uuid DEFAULT NULL)
RETURNS TABLE(produto_id uuid, produto_nome text, valor numeric, participacao_pct numeric, acumulado_pct numeric, classe text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'master') THEN RAISE EXCEPTION 'acesso restrito ao master'; END IF;
  RETURN QUERY
  WITH base AS (
    SELECT p.id AS produto_id, p.nome AS produto_nome,
           COALESCE(SUM(m.valor_financeiro),0)::numeric AS val
      FROM public.movimentacoes m
      JOIN public.produtos p ON p.id = m.produto_id
     WHERE m.quantidade < 0
       AND m.tipo IN ('consumo_interno','solicitacao','emprestimo_saida','ajuste')
       AND COALESCE(m.valor_financeiro,0) > 0
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
  SELECT o.produto_id, o.produto_nome, o.val, o.pct,
         CASE WHEN o.total>0 THEN ROUND(o.acc/o.total*100,2) ELSE 0 END,
         CASE WHEN o.total > 0 AND o.acc/o.total*100 <= 80 THEN 'A'
              WHEN o.total > 0 AND o.acc/o.total*100 <= 95 THEN 'B'
              ELSE 'C' END
    FROM ord o ORDER BY o.val DESC;
END$$;

CREATE OR REPLACE FUNCTION public.relatorio_consumo_financeiro(_from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL, _sala uuid DEFAULT NULL, _categoria uuid DEFAULT NULL, _produto uuid DEFAULT NULL)
RETURNS TABLE(produto_id uuid, produto_nome text, categoria_id uuid, categoria_nome text, sala_id uuid, sala_nome text, quantidade bigint, valor numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'master') THEN RAISE EXCEPTION 'acesso restrito ao master'; END IF;
  RETURN QUERY
  SELECT p.id, p.nome, c.id, c.nome, s.id, s.nome,
         COALESCE(SUM(-m.quantidade),0)::bigint,
         COALESCE(SUM(m.valor_financeiro),0)::numeric
    FROM public.movimentacoes m
    JOIN public.produtos p ON p.id = m.produto_id
    LEFT JOIN public.categorias c ON c.id = p.categoria_id
    JOIN public.salas s ON s.id = m.sala_id
   WHERE m.quantidade < 0
     AND m.tipo IN ('consumo_interno','solicitacao','emprestimo_saida','ajuste')
     AND COALESCE(m.valor_financeiro,0) > 0
     AND (_from IS NULL OR m.created_at >= _from)
     AND (_to IS NULL OR m.created_at <= _to)
     AND (_sala IS NULL OR m.sala_id = _sala)
     AND (_categoria IS NULL OR p.categoria_id = _categoria)
     AND (_produto IS NULL OR p.id = _produto)
   GROUP BY p.id, p.nome, c.id, c.nome, s.id, s.nome;
END$$;

CREATE OR REPLACE FUNCTION public.relatorio_categorias_financeiro(_from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL, _sala uuid DEFAULT NULL)
RETURNS TABLE(categoria_id uuid, categoria_nome text, quantidade bigint, valor numeric, participacao_pct numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'master') THEN RAISE EXCEPTION 'acesso restrito ao master'; END IF;
  RETURN QUERY
  WITH base AS (
    SELECT c.id AS categoria_id, COALESCE(c.nome,'Sem categoria') AS categoria_nome,
           COALESCE(SUM(-m.quantidade),0)::bigint AS qtd,
           COALESCE(SUM(m.valor_financeiro),0)::numeric AS val
      FROM public.movimentacoes m
      JOIN public.produtos p ON p.id = m.produto_id
      LEFT JOIN public.categorias c ON c.id = p.categoria_id
     WHERE m.quantidade < 0
       AND m.tipo IN ('consumo_interno','solicitacao','emprestimo_saida','ajuste')
       AND COALESCE(m.valor_financeiro,0) > 0
       AND (_from IS NULL OR m.created_at >= _from)
       AND (_to IS NULL OR m.created_at <= _to)
       AND (_sala IS NULL OR m.sala_id = _sala)
     GROUP BY c.id, c.nome
  ), tot AS (SELECT COALESCE(SUM(val),0) AS total FROM base)
  SELECT b.categoria_id, b.categoria_nome, b.qtd, b.val,
         CASE WHEN tot.total>0 THEN ROUND(b.val/tot.total*100,2) ELSE 0 END
    FROM base b CROSS JOIN tot ORDER BY b.val DESC;
END$$;

CREATE OR REPLACE FUNCTION public.relatorio_top_produtos_financeiro(_from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL, _sala uuid DEFAULT NULL, _limit integer DEFAULT 20)
RETURNS TABLE(produto_id uuid, produto_nome text, quantidade bigint, valor numeric, participacao_pct numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'master') THEN RAISE EXCEPTION 'acesso restrito ao master'; END IF;
  RETURN QUERY
  WITH base AS (
    SELECT p.id AS produto_id, p.nome AS produto_nome,
           COALESCE(SUM(-m.quantidade),0)::bigint AS qtd,
           COALESCE(SUM(m.valor_financeiro),0)::numeric AS val
      FROM public.movimentacoes m
      JOIN public.produtos p ON p.id = m.produto_id
     WHERE m.quantidade < 0
       AND m.tipo IN ('consumo_interno','solicitacao','emprestimo_saida','ajuste')
       AND COALESCE(m.valor_financeiro,0) > 0
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
END$$;

CREATE OR REPLACE FUNCTION public.relatorio_custo_por_sala(_from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL)
RETURNS TABLE(sala_id uuid, sala_nome text, quantidade bigint, valor numeric, participacao_pct numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'master') THEN RAISE EXCEPTION 'acesso restrito ao master'; END IF;
  RETURN QUERY
  WITH base AS (
    SELECT s.id AS sala_id, s.nome AS sala_nome,
           COALESCE(SUM(-m.quantidade),0)::bigint AS qtd,
           COALESCE(SUM(m.valor_financeiro),0)::numeric AS val
      FROM public.salas s
      LEFT JOIN public.movimentacoes m
        ON m.sala_id = s.id AND m.quantidade < 0
       AND m.tipo IN ('consumo_interno','solicitacao','emprestimo_saida','ajuste')
       AND COALESCE(m.valor_financeiro,0) > 0
       AND (_from IS NULL OR m.created_at >= _from)
       AND (_to IS NULL OR m.created_at <= _to)
     GROUP BY s.id, s.nome
  ), tot AS (SELECT COALESCE(SUM(val),0) AS total FROM base)
  SELECT b.sala_id, b.sala_nome, b.qtd, b.val,
         CASE WHEN tot.total > 0 THEN ROUND(b.val/tot.total*100,2) ELSE 0 END
    FROM base b CROSS JOIN tot ORDER BY b.val DESC;
END$$;

CREATE OR REPLACE FUNCTION public.relatorio_consumo(_from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL, _sala uuid DEFAULT NULL, _categoria uuid DEFAULT NULL, _produto uuid DEFAULT NULL)
RETURNS TABLE(produto_id uuid, produto_nome text, categoria_id uuid, categoria_nome text, sala_id uuid, sala_nome text, quantidade bigint, custo_unitario numeric, valor numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'master') THEN RAISE EXCEPTION 'acesso restrito ao master'; END IF;
  RETURN QUERY
  SELECT
    p.id, p.nome, c.id, c.nome, s.id, s.nome,
    COALESCE(SUM(-m.quantidade),0)::bigint,
    COALESCE(AVG(NULLIF(m.custo_unitario_aplicado,0)), p.custo_unitario, 0)::numeric,
    COALESCE(SUM(
      CASE WHEN m.valor_financeiro IS NOT NULL AND m.valor_financeiro > 0
           THEN m.valor_financeiro
           ELSE (-m.quantidade) * COALESCE(p.custo_unitario,0)
      END
    ),0)::numeric
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
END$$;

CREATE OR REPLACE FUNCTION public.relatorio_consumo_operacional(_from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL, _sala uuid DEFAULT NULL, _categoria uuid DEFAULT NULL, _produto uuid DEFAULT NULL)
RETURNS TABLE(produto_id uuid, produto_nome text, categoria_id uuid, categoria_nome text, sala_id uuid, sala_nome text, quantidade bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT p.id, p.nome, c.id, c.nome, s.id, s.nome,
         COALESCE(SUM(-m.quantidade),0)::bigint
    FROM public.movimentacoes m
    JOIN public.produtos p ON p.id = m.produto_id
    LEFT JOIN public.categorias c ON c.id = p.categoria_id
    JOIN public.salas s ON s.id = m.sala_id
   WHERE m.quantidade < 0
     AND m.tipo IN ('consumo_interno','solicitacao','emprestimo_saida','ajuste')
     AND public.user_has_sala_access(auth.uid(), m.sala_id)
     AND (_from IS NULL OR m.created_at >= _from)
     AND (_to IS NULL OR m.created_at <= _to)
     AND (_sala IS NULL OR m.sala_id = _sala)
     AND (_categoria IS NULL OR p.categoria_id = _categoria)
     AND (_produto IS NULL OR p.id = _produto)
   GROUP BY p.id, p.nome, c.id, c.nome, s.id, s.nome;
$$;

GRANT EXECUTE ON FUNCTION public.relatorio_consumo_operacional(timestamptz,timestamptz,uuid,uuid,uuid) TO authenticated;

-- ---------- 2) RLS: dados financeiros dedicados apenas master ----------
DROP POLICY IF EXISTS "auth read custo historico" ON public.produto_custo_historico;
CREATE POLICY "master_only_select_custo_historico" ON public.produto_custo_historico
  FOR SELECT USING (public.has_role(auth.uid(),'master'));

DROP POLICY IF EXISTS "entradas_select_authorized" ON public.entradas_estoque;
CREATE POLICY "master_only_select_entradas" ON public.entradas_estoque
  FOR SELECT USING (public.has_role(auth.uid(),'master'));

-- ---------- 3) Column-level REVOKE ----------
REVOKE SELECT ON public.estoque FROM authenticated;
GRANT SELECT (id, produto_id, sala_id, quantidade, updated_at) ON public.estoque TO authenticated;

REVOKE SELECT ON public.produtos FROM authenticated;
GRANT SELECT (id, nome, descricao, unidade, estoque_minimo, categoria_id, ativo, sala_id, created_at, updated_at) ON public.produtos TO authenticated;

REVOKE SELECT ON public.movimentacoes FROM authenticated;
GRANT SELECT (id, produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos, observacao, referencia_tipo, referencia_id, created_at) ON public.movimentacoes TO authenticated;

REVOKE SELECT ON public.dividas FROM authenticated;
GRANT SELECT (id, sala_devedora_id, sala_credora_id, produto_id, saldo, updated_at) ON public.dividas TO authenticated;

REVOKE SELECT ON public.emprestimo_itens FROM authenticated;
GRANT SELECT (id, emprestimo_id, produto_id, quantidade, quantidade_devolvida) ON public.emprestimo_itens TO authenticated;

REVOKE SELECT ON public.devolucao_itens FROM authenticated;
GRANT SELECT (id, devolucao_id, emprestimo_item_id, produto_id, quantidade) ON public.devolucao_itens TO authenticated;

-- ---------- 4) Views master-only (definer) com TODOS os campos ----------
CREATE OR REPLACE VIEW public.v_estoque_master WITH (security_invoker=off) AS
  SELECT e.* FROM public.estoque e WHERE public.has_role(auth.uid(),'master');

CREATE OR REPLACE VIEW public.v_produtos_master WITH (security_invoker=off) AS
  SELECT p.* FROM public.produtos p WHERE public.has_role(auth.uid(),'master');

CREATE OR REPLACE VIEW public.v_movimentacoes_master WITH (security_invoker=off) AS
  SELECT m.* FROM public.movimentacoes m WHERE public.has_role(auth.uid(),'master');

CREATE OR REPLACE VIEW public.v_dividas_master WITH (security_invoker=off) AS
  SELECT d.* FROM public.dividas d WHERE public.has_role(auth.uid(),'master');

CREATE OR REPLACE VIEW public.v_emprestimo_itens_master WITH (security_invoker=off) AS
  SELECT i.* FROM public.emprestimo_itens i WHERE public.has_role(auth.uid(),'master');

CREATE OR REPLACE VIEW public.v_devolucao_itens_master WITH (security_invoker=off) AS
  SELECT i.* FROM public.devolucao_itens i WHERE public.has_role(auth.uid(),'master');

CREATE OR REPLACE VIEW public.v_entradas_estoque_master WITH (security_invoker=off) AS
  SELECT e.* FROM public.entradas_estoque e WHERE public.has_role(auth.uid(),'master');

CREATE OR REPLACE VIEW public.v_produto_custo_historico_master WITH (security_invoker=off) AS
  SELECT h.* FROM public.produto_custo_historico h WHERE public.has_role(auth.uid(),'master');

GRANT SELECT ON public.v_estoque_master,
                public.v_produtos_master,
                public.v_movimentacoes_master,
                public.v_dividas_master,
                public.v_emprestimo_itens_master,
                public.v_devolucao_itens_master,
                public.v_entradas_estoque_master,
                public.v_produto_custo_historico_master
  TO authenticated;
