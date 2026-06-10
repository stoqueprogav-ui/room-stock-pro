
-- 1) Custo unitário em produtos
ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS custo_unitario NUMERIC(12,2) NOT NULL DEFAULT 0;

-- 2) Histórico de custo
CREATE TABLE IF NOT EXISTS public.produto_custo_historico (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id UUID NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  valor_anterior NUMERIC(12,2),
  valor_novo NUMERIC(12,2) NOT NULL,
  alterado_por UUID,
  alterado_por_nome TEXT,
  alterado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.produto_custo_historico TO authenticated;
GRANT ALL ON public.produto_custo_historico TO service_role;

ALTER TABLE public.produto_custo_historico ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read custo historico"
  ON public.produto_custo_historico FOR SELECT
  TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_pch_produto ON public.produto_custo_historico(produto_id, alterado_em DESC);

-- 3) Trigger para registrar mudanças de custo
CREATE OR REPLACE FUNCTION public.log_custo_produto()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_nome text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.custo_unitario IS NOT NULL AND NEW.custo_unitario > 0 THEN
      IF v_user IS NOT NULL THEN
        SELECT nome INTO v_nome FROM public.profiles WHERE id = v_user;
      END IF;
      INSERT INTO public.produto_custo_historico
        (produto_id, valor_anterior, valor_novo, alterado_por, alterado_por_nome)
        VALUES (NEW.id, NULL, NEW.custo_unitario, v_user, v_nome);
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.custo_unitario,0) <> COALESCE(NEW.custo_unitario,0) THEN
    IF v_user IS NOT NULL THEN
      SELECT nome INTO v_nome FROM public.profiles WHERE id = v_user;
    END IF;
    INSERT INTO public.produto_custo_historico
      (produto_id, valor_anterior, valor_novo, alterado_por, alterado_por_nome)
      VALUES (NEW.id, OLD.custo_unitario, NEW.custo_unitario, v_user, v_nome);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_custo_produto ON public.produtos;
CREATE TRIGGER trg_log_custo_produto
  AFTER INSERT OR UPDATE OF custo_unitario ON public.produtos
  FOR EACH ROW EXECUTE FUNCTION public.log_custo_produto();

-- 4) Valor financeiro do estoque por sala
CREATE OR REPLACE FUNCTION public.valor_estoque_por_sala()
RETURNS TABLE(sala_id uuid, sala_nome text, total_itens bigint, valor_total numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT s.id, s.nome,
         COALESCE(SUM(e.quantidade),0)::bigint,
         COALESCE(SUM(e.quantidade * COALESCE(p.custo_unitario,0)),0)::numeric
    FROM public.salas s
    LEFT JOIN public.estoque e ON e.sala_id = s.id
    LEFT JOIN public.produtos p ON p.id = e.produto_id
   GROUP BY s.id, s.nome
   ORDER BY 4 DESC;
$$;

-- 5) Consumo (saídas de estoque) agregado com filtros
-- Considera movimentações negativas (consumo, requisições aprovadas, empréstimo saída)
CREATE OR REPLACE FUNCTION public.relatorio_consumo(
  _from timestamptz DEFAULT NULL,
  _to timestamptz DEFAULT NULL,
  _sala uuid DEFAULT NULL,
  _categoria uuid DEFAULT NULL,
  _produto uuid DEFAULT NULL
) RETURNS TABLE(
  produto_id uuid,
  produto_nome text,
  categoria_id uuid,
  categoria_nome text,
  sala_id uuid,
  sala_nome text,
  quantidade bigint,
  custo_unitario numeric,
  valor numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    p.id, p.nome,
    c.id, c.nome,
    s.id, s.nome,
    COALESCE(SUM(-m.quantidade),0)::bigint AS quantidade,
    COALESCE(p.custo_unitario,0)::numeric,
    COALESCE(SUM(-m.quantidade) * COALESCE(p.custo_unitario,0),0)::numeric AS valor
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
$$;

-- 6) Resumo de empréstimos por sala
CREATE OR REPLACE FUNCTION public.relatorio_emprestimos_salas()
RETURNS TABLE(
  sala_id uuid,
  sala_nome text,
  emprestados_unidades bigint,
  recebidos_unidades bigint,
  emprestados_qtd bigint,
  recebidos_qtd bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH itens AS (
    SELECT e.sala_origem_id, e.sala_destino_id, e.status, ei.quantidade
    FROM public.emprestimos e
    JOIN public.emprestimo_itens ei ON ei.emprestimo_id = e.id
    WHERE e.status IN ('aprovado','arquivado')
  )
  SELECT
    s.id, s.nome,
    COALESCE((SELECT SUM(quantidade) FROM itens WHERE sala_origem_id=s.id),0)::bigint,
    COALESCE((SELECT SUM(quantidade) FROM itens WHERE sala_destino_id=s.id),0)::bigint,
    (SELECT COUNT(*) FROM public.emprestimos WHERE sala_origem_id=s.id AND status IN ('aprovado','arquivado'))::bigint,
    (SELECT COUNT(*) FROM public.emprestimos WHERE sala_destino_id=s.id AND status IN ('aprovado','arquivado'))::bigint
  FROM public.salas s
  ORDER BY 3 DESC;
$$;
