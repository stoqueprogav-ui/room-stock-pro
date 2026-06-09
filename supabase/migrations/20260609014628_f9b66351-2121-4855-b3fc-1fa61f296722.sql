
ALTER TABLE public.produtos DROP CONSTRAINT IF EXISTS produtos_nome_key;
DROP INDEX IF EXISTS public.produtos_nome_key;

-- Um único produto global por nome (case-insensitive)
CREATE UNIQUE INDEX produtos_nome_global_uniq
  ON public.produtos (lower(nome))
  WHERE sala_id IS NULL;

-- Um único produto por nome dentro de cada sala (case-insensitive)
CREATE UNIQUE INDEX produtos_nome_sala_uniq
  ON public.produtos (lower(nome), sala_id)
  WHERE sala_id IS NOT NULL;
