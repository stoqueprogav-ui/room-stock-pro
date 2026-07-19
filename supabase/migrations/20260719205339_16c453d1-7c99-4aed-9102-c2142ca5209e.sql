-- Neste projeto o soft-delete de produtos usa a coluna `ativo` (ativo=false).
DROP INDEX IF EXISTS public.produtos_nome_sala_uniq;
CREATE UNIQUE INDEX produtos_nome_sala_uniq
  ON public.produtos (lower(nome), sala_id)
  WHERE sala_id IS NOT NULL AND ativo = true;

DROP INDEX IF EXISTS public.uniq_produtos_catalogo_sala;
CREATE UNIQUE INDEX uniq_produtos_catalogo_sala
  ON public.produtos (catalogo_id, sala_id)
  WHERE ativo = true;