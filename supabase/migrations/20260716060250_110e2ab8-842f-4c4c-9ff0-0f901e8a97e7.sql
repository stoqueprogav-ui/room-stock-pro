CREATE OR REPLACE FUNCTION public.user_has_sala_access(_user uuid, _sala uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT _user IS NOT NULL AND _sala IS NOT NULL AND (
    public.is_super_master(_user)
    OR (public.has_role(_user,'master')
        AND public.user_has_regiao_access(_user, public.sala_regiao(_sala)))
    OR EXISTS (SELECT 1 FROM public.user_salas us
                WHERE us.user_id = _user AND us.sala_id = _sala)
  );
$$;

CREATE OR REPLACE FUNCTION public.master_scope_sala(_user uuid, _sala uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.is_super_master(_user)
      OR (public.has_role(_user,'master')
          AND public.user_has_regiao_access(_user, public.sala_regiao(_sala)));
$$;

DROP POLICY IF EXISTS salas_select_authenticated ON public.salas;
CREATE POLICY salas_select_authenticated ON public.salas
  FOR SELECT TO authenticated
  USING (regiao_id IN (SELECT public.user_regioes(auth.uid())));

DROP POLICY IF EXISTS salas_master_all ON public.salas;
CREATE POLICY salas_master_all ON public.salas
  FOR ALL TO authenticated
  USING (public.is_super_master(auth.uid())
         OR (public.has_role(auth.uid(),'master') AND public.user_has_regiao_access(auth.uid(), regiao_id)))
  WITH CHECK (public.is_super_master(auth.uid())
         OR (public.has_role(auth.uid(),'master') AND public.user_has_regiao_access(auth.uid(), regiao_id)));

DROP POLICY IF EXISTS produtos_select_authenticated ON public.produtos;
CREATE POLICY produtos_select_authenticated ON public.produtos
  FOR SELECT TO authenticated
  USING (public.user_has_sala_access(auth.uid(), sala_id));

DROP POLICY IF EXISTS produtos_master_all ON public.produtos;
CREATE POLICY produtos_master_all ON public.produtos
  FOR ALL TO authenticated
  USING (public.master_scope_sala(auth.uid(), sala_id))
  WITH CHECK (public.master_scope_sala(auth.uid(), sala_id));

DROP POLICY IF EXISTS estoque_select_master_or_sala ON public.estoque;
DROP POLICY IF EXISTS estoque_master_write ON public.estoque;
CREATE POLICY estoque_master_write ON public.estoque
  FOR ALL TO authenticated
  USING (public.master_scope_sala(auth.uid(), sala_id))
  WITH CHECK (public.master_scope_sala(auth.uid(), sala_id));

DROP POLICY IF EXISTS mov_select_master_or_sala ON public.movimentacoes;

DROP POLICY IF EXISTS solic_select_master_or_sala ON public.solicitacoes;
DROP POLICY IF EXISTS solic_master_update ON public.solicitacoes;
CREATE POLICY solic_master_update ON public.solicitacoes
  FOR UPDATE TO authenticated
  USING (public.master_scope_sala(auth.uid(), sala_id))
  WITH CHECK (public.master_scope_sala(auth.uid(), sala_id));

DROP POLICY IF EXISTS solic_master_delete ON public.solicitacoes;
CREATE POLICY solic_master_delete ON public.solicitacoes
  FOR DELETE TO authenticated
  USING (public.master_scope_sala(auth.uid(), sala_id));

DROP POLICY IF EXISTS emp_select_master_or_envolvido ON public.emprestimos;
DROP POLICY IF EXISTS emp_select_envolvidos ON public.emprestimos;
DROP POLICY IF EXISTS emp_master_delete ON public.emprestimos;
CREATE POLICY emp_master_delete ON public.emprestimos
  FOR DELETE TO authenticated
  USING (public.master_scope_sala(auth.uid(), sala_origem_id));

DROP POLICY IF EXISTS emp_update_master_or_admin_origem ON public.emprestimos;
CREATE POLICY emp_update_master_or_admin_origem ON public.emprestimos
  FOR UPDATE TO authenticated
  USING (public.master_scope_sala(auth.uid(), sala_origem_id)
         OR (public.has_role(auth.uid(),'admin') AND sala_origem_id = public.get_user_sala(auth.uid())))
  WITH CHECK (public.master_scope_sala(auth.uid(), sala_origem_id)
         OR (public.has_role(auth.uid(),'admin') AND sala_origem_id = public.get_user_sala(auth.uid())));

DROP POLICY IF EXISTS emp_itens_select ON public.emprestimo_itens;
DROP POLICY IF EXISTS emp_itens_select_envolvidos ON public.emprestimo_itens;
DROP POLICY IF EXISTS dividas_select_envolvidos ON public.dividas;
DROP POLICY IF EXISTS dividas_master_all ON public.dividas;
CREATE POLICY dividas_master_all ON public.dividas
  FOR ALL TO authenticated
  USING (public.master_scope_sala(auth.uid(), sala_credora_id)
         OR public.master_scope_sala(auth.uid(), sala_devedora_id))
  WITH CHECK (public.master_scope_sala(auth.uid(), sala_credora_id)
         OR public.master_scope_sala(auth.uid(), sala_devedora_id));

DROP POLICY IF EXISTS devolucoes_select_envolvidos ON public.devolucoes;
DROP POLICY IF EXISTS devolucao_itens_select_envolvidos ON public.devolucao_itens;

DROP POLICY IF EXISTS consumos_select_master_or_sala ON public.consumos_internos;
DROP POLICY IF EXISTS consumos_insert_master ON public.consumos_internos;
CREATE POLICY consumos_insert_master ON public.consumos_internos
  FOR INSERT TO authenticated
  WITH CHECK (public.master_scope_sala(auth.uid(), sala_id));

DROP POLICY IF EXISTS "Master vê todas as entradas" ON public.entradas_estoque;
DROP POLICY IF EXISTS "Apenas master edita entradas" ON public.entradas_estoque;
CREATE POLICY "Apenas master edita entradas" ON public.entradas_estoque
  FOR UPDATE TO authenticated
  USING (public.master_scope_sala(auth.uid(), sala_id))
  WITH CHECK (public.master_scope_sala(auth.uid(), sala_id));

DROP POLICY IF EXISTS "Apenas master insere entradas" ON public.entradas_estoque;
CREATE POLICY "Apenas master insere entradas" ON public.entradas_estoque
  FOR INSERT TO authenticated
  WITH CHECK (public.master_scope_sala(auth.uid(), sala_id));

DROP POLICY IF EXISTS "Apenas master remove entradas" ON public.entradas_estoque;
CREATE POLICY "Apenas master remove entradas" ON public.entradas_estoque
  FOR DELETE TO authenticated
  USING (public.master_scope_sala(auth.uid(), sala_id));

DROP POLICY IF EXISTS avpat_master_all ON public.avaliacoes_patrimoniais;
CREATE POLICY avpat_master_all ON public.avaliacoes_patrimoniais
  FOR ALL TO authenticated
  USING (public.master_scope_sala(auth.uid(), sala_id))
  WITH CHECK (public.master_scope_sala(auth.uid(), sala_id));

CREATE OR REPLACE FUNCTION public._tg_emp_mesma_regiao()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF public.sala_regiao(NEW.sala_origem_id) IS DISTINCT FROM public.sala_regiao(NEW.sala_destino_id) THEN
    RAISE EXCEPTION 'empréstimo permitido apenas entre salas da mesma região';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_emp_mesma_regiao ON public.emprestimos;
CREATE TRIGGER trg_emp_mesma_regiao
  BEFORE INSERT OR UPDATE OF sala_origem_id, sala_destino_id ON public.emprestimos
  FOR EACH ROW EXECUTE FUNCTION public._tg_emp_mesma_regiao();