
-- 1) Tabela de categorias
CREATE TABLE IF NOT EXISTS public.categorias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.categorias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "categorias_select_authenticated" ON public.categorias
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "categorias_master_all" ON public.categorias
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'master'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'master'::app_role));

CREATE TRIGGER trg_categorias_updated_at
  BEFORE UPDATE ON public.categorias
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Sementes padrão
INSERT INTO public.categorias (nome) VALUES
  ('Bar'), ('Kids'), ('Limpeza'), ('Administrativo'), ('Marketing')
ON CONFLICT (nome) DO NOTHING;

-- 2) Categoria em produtos
ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS categoria_id UUID REFERENCES public.categorias(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_produtos_categoria ON public.produtos(categoria_id);

-- 3) Campos de retirada em solicitacoes e emprestimos
ALTER TABLE public.solicitacoes
  ADD COLUMN IF NOT EXISTS retirado_por TEXT,
  ADD COLUMN IF NOT EXISTS retirado_em TIMESTAMPTZ;

ALTER TABLE public.emprestimos
  ADD COLUMN IF NOT EXISTS retirado_por TEXT,
  ADD COLUMN IF NOT EXISTS retirado_em TIMESTAMPTZ;

-- 4) Atualiza funções de arquivamento para exigir retirada
CREATE OR REPLACE FUNCTION public.arquivar_solicitacao(_solic uuid, _retirado_por text DEFAULT NULL, _retirado_em timestamptz DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_status public.solicitacao_status;
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN RAISE EXCEPTION 'apenas master'; END IF;
  SELECT status INTO v_status FROM public.solicitacoes WHERE id=_solic;
  IF v_status IS NULL THEN RAISE EXCEPTION 'requisição não encontrada'; END IF;
  IF v_status NOT IN ('aprovado','rejeitado') THEN RAISE EXCEPTION 'só é possível arquivar requisições já decididas'; END IF;

  -- Para aprovados, exigir dados de retirada
  IF v_status = 'aprovado' THEN
    IF _retirado_por IS NULL OR length(trim(_retirado_por)) = 0 THEN
      RAISE EXCEPTION 'informe quem retirou o pedido';
    END IF;
    IF _retirado_em IS NULL THEN
      RAISE EXCEPTION 'informe a data de retirada';
    END IF;
  END IF;

  UPDATE public.solicitacoes
     SET status='arquivado',
         retirado_por = COALESCE(_retirado_por, retirado_por),
         retirado_em  = COALESCE(_retirado_em, retirado_em)
   WHERE id=_solic;
END;
$function$;

CREATE OR REPLACE FUNCTION public.arquivar_emprestimo(_emp uuid, _retirado_por text DEFAULT NULL, _retirado_em timestamptz DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_status public.emprestimo_status;
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN RAISE EXCEPTION 'apenas master'; END IF;
  SELECT status INTO v_status FROM public.emprestimos WHERE id=_emp;
  IF v_status IS NULL THEN RAISE EXCEPTION 'empréstimo não encontrado'; END IF;
  IF v_status NOT IN ('aprovado','rejeitado') THEN RAISE EXCEPTION 'só é possível arquivar empréstimos já decididos'; END IF;

  IF v_status = 'aprovado' THEN
    IF _retirado_por IS NULL OR length(trim(_retirado_por)) = 0 THEN
      RAISE EXCEPTION 'informe quem retirou o pedido';
    END IF;
    IF _retirado_em IS NULL THEN
      RAISE EXCEPTION 'informe a data de retirada';
    END IF;
  END IF;

  UPDATE public.emprestimos
     SET status='arquivado',
         retirado_por = COALESCE(_retirado_por, retirado_por),
         retirado_em  = COALESCE(_retirado_em, retirado_em)
   WHERE id=_emp;
END;
$function$;
