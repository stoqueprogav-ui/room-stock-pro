
-- 1) Empréstimos: restringir SELECT às salas envolvidas ou master
DROP POLICY IF EXISTS emp_select_all_authenticated ON public.emprestimos;
CREATE POLICY emp_select_envolvidos ON public.emprestimos
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'master')
    OR sala_origem_id = public.get_user_sala(auth.uid())
    OR sala_destino_id = public.get_user_sala(auth.uid())
  );

DROP POLICY IF EXISTS emp_itens_select_all ON public.emprestimo_itens;
CREATE POLICY emp_itens_select_envolvidos ON public.emprestimo_itens
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.emprestimos e
      WHERE e.id = emprestimo_itens.emprestimo_id
        AND (
          public.has_role(auth.uid(), 'master')
          OR e.sala_origem_id = public.get_user_sala(auth.uid())
          OR e.sala_destino_id = public.get_user_sala(auth.uid())
        )
    )
  );

-- 2) Devoluções: restringir SELECT às salas envolvidas
DROP POLICY IF EXISTS devolucoes_select_all ON public.devolucoes;
CREATE POLICY devolucoes_select_envolvidos ON public.devolucoes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.emprestimos e
      WHERE e.id = devolucoes.emprestimo_id
        AND (
          public.has_role(auth.uid(), 'master')
          OR e.sala_origem_id = public.get_user_sala(auth.uid())
          OR e.sala_destino_id = public.get_user_sala(auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS devolucao_itens_select_all ON public.devolucao_itens;
CREATE POLICY devolucao_itens_select_envolvidos ON public.devolucao_itens
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.devolucoes d
      JOIN public.emprestimos e ON e.id = d.emprestimo_id
      WHERE d.id = devolucao_itens.devolucao_id
        AND (
          public.has_role(auth.uid(), 'master')
          OR e.sala_origem_id = public.get_user_sala(auth.uid())
          OR e.sala_destino_id = public.get_user_sala(auth.uid())
        )
    )
  );

-- 3) Storage: políticas de DELETE/UPDATE para chat-anexos (apenas dono ou master)
DROP POLICY IF EXISTS "chat_anexos_delete_owner_or_master" ON storage.objects;
CREATE POLICY "chat_anexos_delete_owner_or_master" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'chat-anexos'
    AND (owner = auth.uid() OR public.has_role(auth.uid(), 'master'))
  );

DROP POLICY IF EXISTS "chat_anexos_update_owner_or_master" ON storage.objects;
CREATE POLICY "chat_anexos_update_owner_or_master" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'chat-anexos'
    AND (owner = auth.uid() OR public.has_role(auth.uid(), 'master'))
  )
  WITH CHECK (
    bucket_id = 'chat-anexos'
    AND (owner = auth.uid() OR public.has_role(auth.uid(), 'master'))
  );

-- 4) Prevenir escalonamento de privilégios em user_roles
CREATE OR REPLACE FUNCTION public.prevent_master_self_grant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Só bloqueia quando a operação foi feita por um usuário autenticado (não pelo service_role)
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.role = 'master'::public.app_role THEN
    IF NEW.user_id = auth.uid() THEN
      RAISE EXCEPTION 'Não é permitido conceder o papel master a si mesmo';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_master_self_grant ON public.user_roles;
CREATE TRIGGER trg_prevent_master_self_grant
  BEFORE INSERT OR UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_master_self_grant();

-- 5) conversation_participants: restringir INSERT
DROP POLICY IF EXISTS parts_insert ON public.conversation_participants;
CREATE POLICY parts_insert_restricted ON public.conversation_participants
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'master')
    OR EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_participants.conversation_id
        AND c.created_by = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.conversation_participants p
      WHERE p.conversation_id = conversation_participants.conversation_id
        AND p.user_id = auth.uid()
    )
  );
