
-- 1) Preserve históricos: trocar CASCADE -> SET NULL para usuario_id em solicitacoes e solicitante_id em emprestimos
ALTER TABLE public.solicitacoes DROP CONSTRAINT IF EXISTS solicitacoes_usuario_id_fkey;
ALTER TABLE public.solicitacoes ALTER COLUMN usuario_id DROP NOT NULL;
ALTER TABLE public.solicitacoes
  ADD CONSTRAINT solicitacoes_usuario_id_fkey
  FOREIGN KEY (usuario_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.emprestimos DROP CONSTRAINT IF EXISTS emprestimos_solicitante_id_fkey;
ALTER TABLE public.emprestimos ALTER COLUMN solicitante_id DROP NOT NULL;
ALTER TABLE public.emprestimos
  ADD CONSTRAINT emprestimos_solicitante_id_fkey
  FOREIGN KEY (solicitante_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 2) Remover estoque_critico
ALTER TABLE public.produtos DROP COLUMN IF EXISTS estoque_critico;

-- 3) Função de exclusão de sala com validação/forçar
CREATE OR REPLACE FUNCTION public.excluir_sala(_sala uuid, _force boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
        'ok', false,
        'has_deps', true,
        'usuarios', v_usuarios,
        'estoque', v_estoque,
        'solicitacoes_pendentes', v_solic_pend,
        'emprestimos_pendentes', v_emp_pend,
        'emprestimos_total', v_emp_total,
        'movimentacoes', v_mov
      );
    END IF;
  END IF;

  -- Forçado: limpa dependências sem cascade automático
  UPDATE public.profiles SET sala_id = NULL WHERE sala_id = _sala;
  DELETE FROM public.movimentacoes WHERE sala_id = _sala;
  DELETE FROM public.emprestimos WHERE sala_origem_id = _sala OR sala_destino_id = _sala;
  -- estoque, solicitacoes, dividas, conversations já têm ON DELETE CASCADE
  DELETE FROM public.salas WHERE id = _sala;

  RETURN jsonb_build_object('ok', true);
END;
$$;
