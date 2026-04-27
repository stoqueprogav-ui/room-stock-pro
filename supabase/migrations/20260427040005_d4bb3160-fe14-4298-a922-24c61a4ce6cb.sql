-- Reapontar FKs de auth.users para public.profiles para que PostgREST resolva os embeddings.
ALTER TABLE public.emprestimos DROP CONSTRAINT IF EXISTS emprestimos_solicitante_id_fkey;
ALTER TABLE public.emprestimos
  ADD CONSTRAINT emprestimos_solicitante_id_fkey
  FOREIGN KEY (solicitante_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.solicitacoes DROP CONSTRAINT IF EXISTS solicitacoes_usuario_id_fkey;
ALTER TABLE public.solicitacoes
  ADD CONSTRAINT solicitacoes_usuario_id_fkey
  FOREIGN KEY (usuario_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
