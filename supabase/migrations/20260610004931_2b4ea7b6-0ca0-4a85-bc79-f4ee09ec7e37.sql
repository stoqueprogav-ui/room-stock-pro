
-- ============================================================
-- FASE 1 — Migração 1: Estrutura financeira (CMP + Entradas)
-- ============================================================

-- 1) Tabela entradas_estoque (compras / entradas com NF)
CREATE TABLE IF NOT EXISTS public.entradas_estoque (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id UUID NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  sala_id UUID NOT NULL REFERENCES public.salas(id) ON DELETE CASCADE,
  quantidade INTEGER NOT NULL CHECK (quantidade > 0),
  valor_unitario NUMERIC(12,4) NOT NULL CHECK (valor_unitario >= 0),
  valor_total NUMERIC(14,2) GENERATED ALWAYS AS (ROUND(quantidade * valor_unitario, 2)) STORED,
  fornecedor TEXT,
  numero_nf TEXT,
  data_entrada TIMESTAMPTZ NOT NULL DEFAULT now(),
  observacao TEXT,
  usuario_responsavel UUID REFERENCES auth.users(id),
  usuario_responsavel_nome TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.entradas_estoque TO authenticated;
GRANT ALL ON public.entradas_estoque TO service_role;

ALTER TABLE public.entradas_estoque ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Master vê todas as entradas"
  ON public.entradas_estoque FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(),'master') OR public.get_user_sala(auth.uid()) = sala_id);

CREATE POLICY "Apenas master insere entradas"
  ON public.entradas_estoque FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'master'));

CREATE POLICY "Apenas master edita entradas"
  ON public.entradas_estoque FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(),'master'))
  WITH CHECK (public.has_role(auth.uid(),'master'));

CREATE POLICY "Apenas master remove entradas"
  ON public.entradas_estoque FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(),'master'));

CREATE INDEX IF NOT EXISTS idx_entradas_produto_sala_data
  ON public.entradas_estoque (produto_id, sala_id, data_entrada DESC);
CREATE INDEX IF NOT EXISTS idx_entradas_fornecedor
  ON public.entradas_estoque (fornecedor);

-- 2) Campos financeiros em estoque (CMP + valor total)
ALTER TABLE public.estoque
  ADD COLUMN IF NOT EXISTS custo_medio NUMERIC(12,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_total NUMERIC(14,2) NOT NULL DEFAULT 0;

-- 3) Campos financeiros congelados em movimentações
ALTER TABLE public.movimentacoes
  ADD COLUMN IF NOT EXISTS custo_unitario_aplicado NUMERIC(12,4),
  ADD COLUMN IF NOT EXISTS valor_financeiro NUMERIC(14,2);

CREATE INDEX IF NOT EXISTS idx_mov_sala_tipo_data
  ON public.movimentacoes (sala_id, tipo, created_at DESC);

-- 4) Campos financeiros em dívidas / empréstimos / devoluções
ALTER TABLE public.dividas
  ADD COLUMN IF NOT EXISTS valor_financeiro NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE public.emprestimo_itens
  ADD COLUMN IF NOT EXISTS valor_unitario_aplicado NUMERIC(12,4),
  ADD COLUMN IF NOT EXISTS valor_total NUMERIC(14,2);

ALTER TABLE public.devolucao_itens
  ADD COLUMN IF NOT EXISTS valor_unitario_aplicado NUMERIC(12,4),
  ADD COLUMN IF NOT EXISTS valor_total NUMERIC(14,2);

-- 5) Backfill inicial: usa custo_unitario legado em produtos como CMP inicial onde houver
UPDATE public.estoque e
   SET custo_medio = COALESCE(p.custo_unitario, 0),
       valor_total = ROUND(e.quantidade * COALESCE(p.custo_unitario, 0), 2)
  FROM public.produtos p
 WHERE p.id = e.produto_id
   AND e.custo_medio = 0;
