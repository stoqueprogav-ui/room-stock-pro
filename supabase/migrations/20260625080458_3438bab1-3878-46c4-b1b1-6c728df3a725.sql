
ALTER VIEW public.v_entradas_estoque_master SET (security_invoker = on);
ALTER VIEW public.v_devolucao_itens_master SET (security_invoker = on);
ALTER VIEW public.v_estoque_master SET (security_invoker = on);
ALTER VIEW public.v_emprestimo_itens_master SET (security_invoker = on);
ALTER VIEW public.v_produtos_master SET (security_invoker = on);
ALTER VIEW public.v_movimentacoes_master SET (security_invoker = on);
ALTER VIEW public.v_dividas_master SET (security_invoker = on);
ALTER VIEW public.v_produto_custo_historico_master SET (security_invoker = on);

DROP POLICY IF EXISTS conv_insert_auth ON public.conversations;
CREATE POLICY conv_insert_auth ON public.conversations
FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND (
    public.has_role(auth.uid(), 'master'::app_role)
    OR sala_id IS NULL
    OR sala_id = public.get_user_sala(auth.uid())
  )
);

CREATE POLICY user_sala_ativa_insert_self_or_master ON public.user_sala_ativa
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'master'::app_role));

CREATE POLICY user_sala_ativa_update_self_or_master ON public.user_sala_ativa
FOR UPDATE TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'master'::app_role))
WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'master'::app_role));

CREATE POLICY user_sala_ativa_delete_self_or_master ON public.user_sala_ativa
FOR DELETE TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'master'::app_role));
