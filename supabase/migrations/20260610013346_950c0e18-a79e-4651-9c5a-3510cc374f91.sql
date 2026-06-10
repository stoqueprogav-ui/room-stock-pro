
-- 1) Tabela user_salas (N:N)
CREATE TABLE IF NOT EXISTS public.user_salas (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sala_id uuid NOT NULL REFERENCES public.salas(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, sala_id)
);
CREATE INDEX IF NOT EXISTS user_salas_sala_idx ON public.user_salas(sala_id);

GRANT SELECT ON public.user_salas TO authenticated;
GRANT ALL ON public.user_salas TO service_role;

ALTER TABLE public.user_salas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_salas_select_self_or_master ON public.user_salas;
CREATE POLICY user_salas_select_self_or_master ON public.user_salas
  FOR SELECT USING (user_id = auth.uid() OR public.has_role(auth.uid(),'master'));

DROP POLICY IF EXISTS user_salas_master_all ON public.user_salas;
CREATE POLICY user_salas_master_all ON public.user_salas
  FOR ALL USING (public.has_role(auth.uid(),'master'))
  WITH CHECK (public.has_role(auth.uid(),'master'));

-- 2) Função de acesso (security definer para evitar recursão de RLS)
CREATE OR REPLACE FUNCTION public.user_has_sala_access(_user uuid, _sala uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    _user IS NOT NULL AND _sala IS NOT NULL AND (
      public.has_role(_user,'master')
      OR EXISTS(SELECT 1 FROM public.user_salas us WHERE us.user_id=_user AND us.sala_id=_sala)
    );
$$;

-- 3) Listar salas do usuário corrente
CREATE OR REPLACE FUNCTION public.listar_minhas_salas()
RETURNS TABLE(sala_id uuid, sala_nome text, ativa boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user uuid := auth.uid(); v_active uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  SELECT sala_id INTO v_active FROM public.profiles WHERE id = v_user;
  IF public.has_role(v_user,'master') THEN
    RETURN QUERY
      SELECT s.id, s.nome, (s.id = v_active) FROM public.salas s ORDER BY s.nome;
  ELSE
    RETURN QUERY
      SELECT s.id, s.nome, (s.id = v_active)
      FROM public.user_salas us
      JOIN public.salas s ON s.id = us.sala_id
      WHERE us.user_id = v_user
      ORDER BY s.nome;
  END IF;
END; $$;

-- 4) Trocar sala ativa
CREATE OR REPLACE FUNCTION public.set_minha_sala_ativa(_sala uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  IF _sala IS NULL THEN
    UPDATE public.profiles SET sala_id = NULL, updated_at = now() WHERE id = v_user;
    RETURN;
  END IF;
  IF NOT public.user_has_sala_access(v_user, _sala) THEN
    RAISE EXCEPTION 'sem acesso a esta sala';
  END IF;
  UPDATE public.profiles SET sala_id = _sala, updated_at = now() WHERE id = v_user;
END; $$;

-- 5) Master define salas autorizadas de um usuário
CREATE OR REPLACE FUNCTION public.admin_set_user_salas(_user uuid, _salas uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_caller uuid := auth.uid(); v_active uuid; v_first uuid;
BEGIN
  IF NOT public.has_role(v_caller,'master') THEN RAISE EXCEPTION 'apenas master'; END IF;
  IF _user IS NULL THEN RAISE EXCEPTION 'usuário inválido'; END IF;

  -- Substitui o conjunto
  DELETE FROM public.user_salas WHERE user_id = _user;
  IF _salas IS NOT NULL AND array_length(_salas,1) > 0 THEN
    INSERT INTO public.user_salas (user_id, sala_id)
    SELECT _user, s FROM unnest(_salas) AS s
    ON CONFLICT DO NOTHING;
  END IF;

  -- Ajusta sala ativa (profiles.sala_id) se inválida
  SELECT sala_id INTO v_active FROM public.profiles WHERE id = _user;
  IF v_active IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.user_salas WHERE user_id=_user AND sala_id=v_active
  ) THEN
    SELECT sala_id INTO v_first FROM public.user_salas WHERE user_id=_user ORDER BY created_at LIMIT 1;
    UPDATE public.profiles SET sala_id = v_first, updated_at = now() WHERE id = _user;
  ELSIF v_active IS NULL THEN
    SELECT sala_id INTO v_first FROM public.user_salas WHERE user_id=_user ORDER BY created_at LIMIT 1;
    IF v_first IS NOT NULL THEN
      UPDATE public.profiles SET sala_id = v_first, updated_at = now() WHERE id = _user;
    END IF;
  END IF;

  PERFORM public.log_event('usuario.salas_atualizadas','Salas autorizadas atualizadas','usuarios',NULL,'usuario',_user,
    jsonb_build_object('salas', _salas));
END; $$;

-- 6) Backfill: cada usuário com sala atual recebe vínculo em user_salas
INSERT INTO public.user_salas (user_id, sala_id)
SELECT id, sala_id FROM public.profiles WHERE sala_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 7) Atualizar políticas de SELECT para usar user_has_sala_access
DROP POLICY IF EXISTS estoque_select_master_or_sala ON public.estoque;
CREATE POLICY estoque_select_authorized ON public.estoque
  FOR SELECT USING (public.user_has_sala_access(auth.uid(), sala_id));

DROP POLICY IF EXISTS mov_select_master_or_sala ON public.movimentacoes;
CREATE POLICY mov_select_authorized ON public.movimentacoes
  FOR SELECT USING (public.user_has_sala_access(auth.uid(), sala_id));

DROP POLICY IF EXISTS solic_select_master_or_sala ON public.solicitacoes;
CREATE POLICY solic_select_authorized ON public.solicitacoes
  FOR SELECT USING (public.user_has_sala_access(auth.uid(), sala_id));

DROP POLICY IF EXISTS consumos_select_master_or_sala ON public.consumos_internos;
CREATE POLICY consumos_select_authorized ON public.consumos_internos
  FOR SELECT USING (public.user_has_sala_access(auth.uid(), sala_id));

DROP POLICY IF EXISTS dividas_select_envolvidos ON public.dividas;
CREATE POLICY dividas_select_authorized ON public.dividas
  FOR SELECT USING (
    public.user_has_sala_access(auth.uid(), sala_devedora_id)
    OR public.user_has_sala_access(auth.uid(), sala_credora_id)
  );

DROP POLICY IF EXISTS emp_select_envolvidos ON public.emprestimos;
CREATE POLICY emp_select_authorized ON public.emprestimos
  FOR SELECT USING (
    public.user_has_sala_access(auth.uid(), sala_origem_id)
    OR public.user_has_sala_access(auth.uid(), sala_destino_id)
  );

DROP POLICY IF EXISTS emp_itens_select_envolvidos ON public.emprestimo_itens;
CREATE POLICY emp_itens_select_authorized ON public.emprestimo_itens
  FOR SELECT USING (EXISTS(
    SELECT 1 FROM public.emprestimos e
    WHERE e.id = emprestimo_itens.emprestimo_id
      AND (public.user_has_sala_access(auth.uid(), e.sala_origem_id)
           OR public.user_has_sala_access(auth.uid(), e.sala_destino_id))
  ));

-- solicitacao_itens: select segue solicitação
DROP POLICY IF EXISTS solic_itens_select ON public.solicitacao_itens;
CREATE POLICY solic_itens_select ON public.solicitacao_itens
  FOR SELECT USING (EXISTS(
    SELECT 1 FROM public.solicitacoes s
    WHERE s.id = solicitacao_itens.solicitacao_id
      AND public.user_has_sala_access(auth.uid(), s.sala_id)
  ));

-- entradas_estoque
DROP POLICY IF EXISTS "Master vê todas as entradas" ON public.entradas_estoque;
CREATE POLICY entradas_select_authorized ON public.entradas_estoque
  FOR SELECT USING (public.user_has_sala_access(auth.uid(), sala_id));

-- 8) Trigger: quando user_salas é apagada, se a sala ativa do usuário deixa de ser válida, ajusta
CREATE OR REPLACE FUNCTION public._user_salas_after_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_active uuid; v_new uuid;
BEGIN
  SELECT sala_id INTO v_active FROM public.profiles WHERE id = OLD.user_id;
  IF v_active = OLD.sala_id THEN
    SELECT sala_id INTO v_new FROM public.user_salas WHERE user_id = OLD.user_id ORDER BY created_at LIMIT 1;
    UPDATE public.profiles SET sala_id = v_new, updated_at = now() WHERE id = OLD.user_id;
  END IF;
  RETURN OLD;
END; $$;

DROP TRIGGER IF EXISTS trg_user_salas_after_delete ON public.user_salas;
CREATE TRIGGER trg_user_salas_after_delete
  AFTER DELETE ON public.user_salas
  FOR EACH ROW EXECUTE FUNCTION public._user_salas_after_delete();
