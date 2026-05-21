CREATE OR REPLACE FUNCTION public.reset_sistema_total()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_master_ids uuid[];
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN
    RAISE EXCEPTION 'apenas master pode resetar o sistema';
  END IF;

  SELECT array_agg(user_id) INTO v_master_ids
  FROM public.user_roles WHERE role = 'master';

  DELETE FROM public.messages;
  DELETE FROM public.conversation_reads;
  DELETE FROM public.conversation_participants;
  DELETE FROM public.conversations;
  DELETE FROM public.devolucao_itens;
  DELETE FROM public.devolucoes;
  DELETE FROM public.emprestimo_itens;
  DELETE FROM public.emprestimos;
  DELETE FROM public.solicitacao_itens;
  DELETE FROM public.solicitacoes;
  DELETE FROM public.dividas;
  DELETE FROM public.movimentacoes;
  DELETE FROM public.estoque;
  DELETE FROM public.produtos;
  DELETE FROM public.categorias;
  UPDATE public.profiles SET sala_id = NULL WHERE id = ANY(v_master_ids);
  DELETE FROM public.profiles WHERE id <> ALL(v_master_ids);
  DELETE FROM public.user_roles WHERE role <> 'master';
  DELETE FROM public.salas;

  RETURN jsonb_build_object('ok', true, 'master_ids', v_master_ids);
END;
$$;