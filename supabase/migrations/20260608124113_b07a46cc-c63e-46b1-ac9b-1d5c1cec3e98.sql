
-- Adicionar valor ao enum movimentacao_tipo
ALTER TYPE public.movimentacao_tipo ADD VALUE IF NOT EXISTS 'consumo_interno';

-- Enum de motivo
DO $$ BEGIN
  CREATE TYPE public.motivo_consumo AS ENUM (
    'consumo_interno','evento','uso_administrativo','uso_operacional',
    'perda','avaria','descarte','outro'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Tabela de consumos internos
CREATE TABLE IF NOT EXISTS public.consumos_internos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sala_id UUID NOT NULL REFERENCES public.salas(id) ON DELETE CASCADE,
  produto_id UUID NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  quantidade INTEGER NOT NULL CHECK (quantidade > 0),
  motivo public.motivo_consumo NOT NULL,
  observacao TEXT,
  usuario_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consumos_sala_data ON public.consumos_internos(sala_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consumos_produto_data ON public.consumos_internos(produto_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consumos_motivo ON public.consumos_internos(motivo);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.consumos_internos TO authenticated;
GRANT ALL ON public.consumos_internos TO service_role;

ALTER TABLE public.consumos_internos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "consumos_select_master_or_sala" ON public.consumos_internos
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'master') OR sala_id = public.get_user_sala(auth.uid()));

CREATE POLICY "consumos_insert_master" ON public.consumos_internos
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'master'));

-- Tabelas de inventário
CREATE TABLE IF NOT EXISTS public.inventarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo TEXT NOT NULL UNIQUE,
  sala_id UUID REFERENCES public.salas(id) ON DELETE SET NULL,
  categoria_id UUID REFERENCES public.categorias(id) ON DELETE SET NULL,
  produto_id UUID REFERENCES public.produtos(id) ON DELETE SET NULL,
  data_referencia TIMESTAMPTZ NOT NULL DEFAULT now(),
  total_itens INTEGER NOT NULL DEFAULT 0,
  total_unidades INTEGER NOT NULL DEFAULT 0,
  criado_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  observacao TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inventario_itens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventario_id UUID NOT NULL REFERENCES public.inventarios(id) ON DELETE CASCADE,
  produto_id UUID NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  sala_id UUID NOT NULL REFERENCES public.salas(id) ON DELETE CASCADE,
  produto_nome TEXT NOT NULL,
  categoria_nome TEXT,
  sala_nome TEXT NOT NULL,
  unidade TEXT,
  quantidade INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_inv_itens_inv ON public.inventario_itens(inventario_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventarios TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventario_itens TO authenticated;
GRANT ALL ON public.inventarios TO service_role;
GRANT ALL ON public.inventario_itens TO service_role;

ALTER TABLE public.inventarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventario_itens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inv_select_master" ON public.inventarios FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'master'));
CREATE POLICY "inv_insert_master" ON public.inventarios FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'master'));
CREATE POLICY "inv_delete_master" ON public.inventarios FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'master'));

CREATE POLICY "inv_itens_select_master" ON public.inventario_itens FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'master'));
CREATE POLICY "inv_itens_insert_master" ON public.inventario_itens FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'master'));
