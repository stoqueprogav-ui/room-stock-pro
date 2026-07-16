
CREATE TABLE IF NOT EXISTS public.regioes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.regioes TO authenticated;
GRANT ALL ON public.regioes TO service_role;
ALTER TABLE public.regioes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.salas ADD COLUMN IF NOT EXISTS regiao_id uuid REFERENCES public.regioes(id);

CREATE TABLE IF NOT EXISTS public.master_regioes (
  user_id uuid NOT NULL,
  regiao_id uuid NOT NULL REFERENCES public.regioes(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, regiao_id)
);
GRANT SELECT ON public.master_regioes TO authenticated;
GRANT ALL ON public.master_regioes TO service_role;
ALTER TABLE public.master_regioes ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_reg uuid;
  v_thiago uuid;
BEGIN
  SELECT id INTO v_reg FROM public.regioes WHERE nome = 'Gramado e Canela';
  IF v_reg IS NULL THEN
    INSERT INTO public.regioes (nome) VALUES ('Gramado e Canela') RETURNING id INTO v_reg;
  END IF;

  UPDATE public.salas SET regiao_id = v_reg WHERE regiao_id IS NULL;

  SELECT id INTO v_thiago FROM public.profiles
   WHERE lower(btrim(email)) = 'thiagosahy@gmail.com' LIMIT 1;

  IF v_thiago IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_thiago, 'super_master') ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.master_regioes (user_id, regiao_id)
  SELECT ur.user_id, v_reg FROM public.user_roles ur
   WHERE ur.role = 'master'
  ON CONFLICT DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION public.is_super_master(_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.has_role(_user, 'super_master'); $$;

CREATE OR REPLACE FUNCTION public.user_regioes(_user uuid)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT r.id FROM public.regioes r WHERE public.is_super_master(_user)
  UNION
  SELECT mr.regiao_id FROM public.master_regioes mr WHERE mr.user_id = _user
  UNION
  SELECT s.regiao_id FROM public.user_salas us
    JOIN public.salas s ON s.id = us.sala_id
   WHERE us.user_id = _user AND s.regiao_id IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.user_has_regiao_access(_user uuid, _regiao uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT _regiao IS NOT NULL AND _regiao IN (SELECT public.user_regioes(_user)); $$;

CREATE OR REPLACE FUNCTION public.sala_regiao(_sala uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT regiao_id FROM public.salas WHERE id = _sala; $$;

DROP POLICY IF EXISTS regioes_super_all ON public.regioes;
CREATE POLICY regioes_super_all ON public.regioes
  FOR ALL USING (public.is_super_master(auth.uid()))
  WITH CHECK (public.is_super_master(auth.uid()));

DROP POLICY IF EXISTS regioes_select_visiveis ON public.regioes;
CREATE POLICY regioes_select_visiveis ON public.regioes
  FOR SELECT USING (id IN (SELECT public.user_regioes(auth.uid())));

DROP POLICY IF EXISTS master_regioes_super_all ON public.master_regioes;
CREATE POLICY master_regioes_super_all ON public.master_regioes
  FOR ALL USING (public.is_super_master(auth.uid()))
  WITH CHECK (public.is_super_master(auth.uid()));

DROP POLICY IF EXISTS master_regioes_select_own ON public.master_regioes;
CREATE POLICY master_regioes_select_own ON public.master_regioes
  FOR SELECT USING (user_id = auth.uid());
