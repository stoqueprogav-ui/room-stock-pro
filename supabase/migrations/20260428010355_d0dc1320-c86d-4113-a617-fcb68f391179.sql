
-- Recriar FKs de "decidido_por" apontando para public.profiles em vez de auth.users,
-- para permitir embed PostgREST do nome do aprovador.
ALTER TABLE public.emprestimos DROP CONSTRAINT IF EXISTS emprestimos_decidido_por_fkey;
ALTER TABLE public.emprestimos
  ADD CONSTRAINT emprestimos_decidido_por_fkey
  FOREIGN KEY (decidido_por) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.solicitacoes DROP CONSTRAINT IF EXISTS solicitacoes_decidido_por_fkey;
ALTER TABLE public.solicitacoes
  ADD CONSTRAINT solicitacoes_decidido_por_fkey
  FOREIGN KEY (decidido_por) REFERENCES public.profiles(id) ON DELETE SET NULL;
