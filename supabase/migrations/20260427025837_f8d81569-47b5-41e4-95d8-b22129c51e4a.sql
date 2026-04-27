ALTER TABLE public.produtos
ADD COLUMN IF NOT EXISTS estoque_critico integer NOT NULL DEFAULT 0;