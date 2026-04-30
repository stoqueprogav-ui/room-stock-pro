-- Habilitar realtime para tabelas de solicitações e empréstimos
ALTER TABLE public.solicitacoes REPLICA IDENTITY FULL;
ALTER TABLE public.emprestimos REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.solicitacoes;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.emprestimos;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;