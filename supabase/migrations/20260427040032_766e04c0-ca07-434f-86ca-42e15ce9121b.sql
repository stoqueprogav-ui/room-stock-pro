ALTER TABLE public.movimentacoes DROP CONSTRAINT IF EXISTS movimentacoes_usuario_id_fkey;
ALTER TABLE public.movimentacoes
  ADD CONSTRAINT movimentacoes_usuario_id_fkey
  FOREIGN KEY (usuario_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
