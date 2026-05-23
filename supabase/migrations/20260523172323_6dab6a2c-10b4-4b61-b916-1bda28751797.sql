
-- 1. FKs com ON DELETE CASCADE (recriar conforme necessário)
-- devolucao_itens -> devolucoes, emprestimo_itens, produtos
ALTER TABLE public.devolucao_itens
  DROP CONSTRAINT IF EXISTS devolucao_itens_devolucao_id_fkey,
  DROP CONSTRAINT IF EXISTS devolucao_itens_emprestimo_item_id_fkey,
  DROP CONSTRAINT IF EXISTS devolucao_itens_produto_id_fkey;
ALTER TABLE public.devolucao_itens
  ADD CONSTRAINT devolucao_itens_devolucao_id_fkey FOREIGN KEY (devolucao_id) REFERENCES public.devolucoes(id) ON DELETE CASCADE,
  ADD CONSTRAINT devolucao_itens_emprestimo_item_id_fkey FOREIGN KEY (emprestimo_item_id) REFERENCES public.emprestimo_itens(id) ON DELETE CASCADE,
  ADD CONSTRAINT devolucao_itens_produto_id_fkey FOREIGN KEY (produto_id) REFERENCES public.produtos(id) ON DELETE CASCADE;

-- devolucoes -> emprestimos
ALTER TABLE public.devolucoes
  DROP CONSTRAINT IF EXISTS devolucoes_emprestimo_id_fkey;
ALTER TABLE public.devolucoes
  ADD CONSTRAINT devolucoes_emprestimo_id_fkey FOREIGN KEY (emprestimo_id) REFERENCES public.emprestimos(id) ON DELETE CASCADE;

-- emprestimo_itens -> emprestimos, produtos
ALTER TABLE public.emprestimo_itens
  DROP CONSTRAINT IF EXISTS emprestimo_itens_emprestimo_id_fkey,
  DROP CONSTRAINT IF EXISTS emprestimo_itens_produto_id_fkey;
ALTER TABLE public.emprestimo_itens
  ADD CONSTRAINT emprestimo_itens_emprestimo_id_fkey FOREIGN KEY (emprestimo_id) REFERENCES public.emprestimos(id) ON DELETE CASCADE,
  ADD CONSTRAINT emprestimo_itens_produto_id_fkey FOREIGN KEY (produto_id) REFERENCES public.produtos(id) ON DELETE CASCADE;

-- emprestimos -> salas (cascata em ambos os lados)
ALTER TABLE public.emprestimos
  DROP CONSTRAINT IF EXISTS emprestimos_sala_origem_id_fkey,
  DROP CONSTRAINT IF EXISTS emprestimos_sala_destino_id_fkey;
ALTER TABLE public.emprestimos
  ADD CONSTRAINT emprestimos_sala_origem_id_fkey FOREIGN KEY (sala_origem_id) REFERENCES public.salas(id) ON DELETE CASCADE,
  ADD CONSTRAINT emprestimos_sala_destino_id_fkey FOREIGN KEY (sala_destino_id) REFERENCES public.salas(id) ON DELETE CASCADE;

-- solicitacao_itens -> solicitacoes, produtos
ALTER TABLE public.solicitacao_itens
  DROP CONSTRAINT IF EXISTS solicitacao_itens_solicitacao_id_fkey,
  DROP CONSTRAINT IF EXISTS solicitacao_itens_produto_id_fkey;
ALTER TABLE public.solicitacao_itens
  ADD CONSTRAINT solicitacao_itens_solicitacao_id_fkey FOREIGN KEY (solicitacao_id) REFERENCES public.solicitacoes(id) ON DELETE CASCADE,
  ADD CONSTRAINT solicitacao_itens_produto_id_fkey FOREIGN KEY (produto_id) REFERENCES public.produtos(id) ON DELETE CASCADE;

-- solicitacoes -> salas
ALTER TABLE public.solicitacoes
  DROP CONSTRAINT IF EXISTS solicitacoes_sala_id_fkey;
ALTER TABLE public.solicitacoes
  ADD CONSTRAINT solicitacoes_sala_id_fkey FOREIGN KEY (sala_id) REFERENCES public.salas(id) ON DELETE CASCADE;

-- movimentacoes -> sala, produto
ALTER TABLE public.movimentacoes
  DROP CONSTRAINT IF EXISTS movimentacoes_sala_id_fkey,
  DROP CONSTRAINT IF EXISTS movimentacoes_produto_id_fkey;
ALTER TABLE public.movimentacoes
  ADD CONSTRAINT movimentacoes_sala_id_fkey FOREIGN KEY (sala_id) REFERENCES public.salas(id) ON DELETE CASCADE,
  ADD CONSTRAINT movimentacoes_produto_id_fkey FOREIGN KEY (produto_id) REFERENCES public.produtos(id) ON DELETE CASCADE;

-- estoque -> sala, produto
ALTER TABLE public.estoque
  DROP CONSTRAINT IF EXISTS estoque_sala_id_fkey,
  DROP CONSTRAINT IF EXISTS estoque_produto_id_fkey;
ALTER TABLE public.estoque
  ADD CONSTRAINT estoque_sala_id_fkey FOREIGN KEY (sala_id) REFERENCES public.salas(id) ON DELETE CASCADE,
  ADD CONSTRAINT estoque_produto_id_fkey FOREIGN KEY (produto_id) REFERENCES public.produtos(id) ON DELETE CASCADE;

-- dividas
ALTER TABLE public.dividas
  DROP CONSTRAINT IF EXISTS dividas_sala_credora_id_fkey,
  DROP CONSTRAINT IF EXISTS dividas_sala_devedora_id_fkey,
  DROP CONSTRAINT IF EXISTS dividas_produto_id_fkey;
ALTER TABLE public.dividas
  ADD CONSTRAINT dividas_sala_credora_id_fkey FOREIGN KEY (sala_credora_id) REFERENCES public.salas(id) ON DELETE CASCADE,
  ADD CONSTRAINT dividas_sala_devedora_id_fkey FOREIGN KEY (sala_devedora_id) REFERENCES public.salas(id) ON DELETE CASCADE,
  ADD CONSTRAINT dividas_produto_id_fkey FOREIGN KEY (produto_id) REFERENCES public.produtos(id) ON DELETE CASCADE;

-- conversations -> sala
ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_sala_id_fkey,
  DROP CONSTRAINT IF EXISTS conversations_related_requisicao_id_fkey,
  DROP CONSTRAINT IF EXISTS conversations_related_emprestimo_id_fkey;
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_sala_id_fkey FOREIGN KEY (sala_id) REFERENCES public.salas(id) ON DELETE CASCADE,
  ADD CONSTRAINT conversations_related_requisicao_id_fkey FOREIGN KEY (related_requisicao_id) REFERENCES public.solicitacoes(id) ON DELETE CASCADE,
  ADD CONSTRAINT conversations_related_emprestimo_id_fkey FOREIGN KEY (related_emprestimo_id) REFERENCES public.emprestimos(id) ON DELETE CASCADE;

-- messages, conversation_reads, conversation_participants -> conversations
ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_conversation_id_fkey;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;

ALTER TABLE public.conversation_reads
  DROP CONSTRAINT IF EXISTS conversation_reads_conversation_id_fkey;
ALTER TABLE public.conversation_reads
  ADD CONSTRAINT conversation_reads_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;

ALTER TABLE public.conversation_participants
  DROP CONSTRAINT IF EXISTS conversation_participants_conversation_id_fkey;
ALTER TABLE public.conversation_participants
  ADD CONSTRAINT conversation_participants_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;

-- 2. Atualiza excluir_sala para limpar tudo (incluindo devoluções) antes do DELETE
CREATE OR REPLACE FUNCTION public.excluir_sala(_sala uuid, _force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_usuarios int;
  v_estoque int;
  v_solic_pend int;
  v_emp_pend int;
  v_emp_total int;
  v_mov int;
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN RAISE EXCEPTION 'apenas master'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.salas WHERE id = _sala) THEN
    RAISE EXCEPTION 'sala não encontrada';
  END IF;

  SELECT COUNT(*) INTO v_usuarios FROM public.profiles WHERE sala_id = _sala;
  SELECT COUNT(*) INTO v_estoque FROM public.estoque WHERE sala_id = _sala AND quantidade > 0;
  SELECT COUNT(*) INTO v_solic_pend FROM public.solicitacoes WHERE sala_id = _sala AND status = 'pendente';
  SELECT COUNT(*) INTO v_emp_pend FROM public.emprestimos
    WHERE (sala_origem_id = _sala OR sala_destino_id = _sala) AND status = 'pendente';
  SELECT COUNT(*) INTO v_emp_total FROM public.emprestimos
    WHERE sala_origem_id = _sala OR sala_destino_id = _sala;
  SELECT COUNT(*) INTO v_mov FROM public.movimentacoes WHERE sala_id = _sala;

  IF NOT _force THEN
    IF v_usuarios > 0 OR v_estoque > 0 OR v_solic_pend > 0 OR v_emp_pend > 0 OR v_emp_total > 0 OR v_mov > 0 THEN
      RETURN jsonb_build_object(
        'ok', false, 'has_deps', true,
        'usuarios', v_usuarios, 'estoque', v_estoque,
        'solicitacoes_pendentes', v_solic_pend,
        'emprestimos_pendentes', v_emp_pend,
        'emprestimos_total', v_emp_total,
        'movimentacoes', v_mov
      );
    END IF;
  END IF;

  -- Desvincula usuários
  UPDATE public.profiles SET sala_id = NULL WHERE sala_id = _sala;
  -- Cascata cuida do resto (estoque, dividas, solicitacoes, emprestimos+itens+devolucoes,
  -- movimentacoes, conversations+messages, etc.)
  DELETE FROM public.salas WHERE id = _sala;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- 3. Atualiza reset_sistema_total para aceitar caller (service role não tem auth.uid)
CREATE OR REPLACE FUNCTION public.reset_sistema_total(_caller uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := COALESCE(_caller, auth.uid());
  v_master_ids uuid[];
BEGIN
  IF v_user IS NULL OR NOT public.has_role(v_user, 'master') THEN
    RAISE EXCEPTION 'apenas master pode resetar o sistema';
  END IF;

  SELECT array_agg(user_id) INTO v_master_ids
  FROM public.user_roles WHERE role = 'master';

  -- Ordem segura (cascatas cobrem o resto)
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
$function$;
