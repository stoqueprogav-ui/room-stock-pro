ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS excluido boolean NOT NULL DEFAULT false;
ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS excluido_em timestamptz;

CREATE OR REPLACE FUNCTION public.excluir_produto_sala(_produto uuid, _sala uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_nome text;
  v_tem_historico boolean;
  v_pendentes int;
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN
    RAISE EXCEPTION 'apenas master pode excluir produtos';
  END IF;
  IF NOT public.user_has_sala_access(v_user, _sala) THEN
    RAISE EXCEPTION 'sala não autorizada';
  END IF;
  SELECT nome INTO v_nome FROM public.produtos
   WHERE id = _produto AND sala_id = _sala;
  IF v_nome IS NULL THEN RAISE EXCEPTION 'produto não encontrado nesta sala'; END IF;

  SELECT (SELECT COUNT(*) FROM public.solicitacao_itens si
            JOIN public.solicitacoes s ON s.id = si.solicitacao_id
           WHERE si.produto_id = _produto AND s.status = 'pendente')
       + (SELECT COUNT(*) FROM public.emprestimo_itens ei
            JOIN public.emprestimos e ON e.id = ei.emprestimo_id
           WHERE ei.produto_id = _produto AND e.status = 'pendente')
    INTO v_pendentes;
  IF v_pendentes > 0 THEN
    RETURN jsonb_build_object('ok', false, 'modo', 'bloqueado',
      'mensagem', 'Há '||v_pendentes||' pedido(s) pendente(s) com este produto. Decida-os antes de excluir.');
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.movimentacoes    WHERE produto_id = _produto)
      OR EXISTS(SELECT 1 FROM public.entradas_estoque WHERE produto_id = _produto)
      OR EXISTS(SELECT 1 FROM public.solicitacao_itens WHERE produto_id = _produto)
      OR EXISTS(SELECT 1 FROM public.emprestimo_itens  WHERE produto_id = _produto)
      OR EXISTS(SELECT 1 FROM public.consumos_internos WHERE produto_id = _produto)
    INTO v_tem_historico;

  IF NOT v_tem_historico THEN
    DELETE FROM public.lotes    WHERE produto_id = _produto AND sala_id = _sala;
    DELETE FROM public.avaliacoes_patrimoniais WHERE produto_id = _produto AND sala_id = _sala;
    DELETE FROM public.estoque  WHERE produto_id = _produto AND sala_id = _sala;
    DELETE FROM public.produtos WHERE id = _produto AND sala_id = _sala;
    PERFORM public.log_event('produto.excluido_definitivo',
      'Produto excluído definitivamente (sem histórico): '||v_nome,
      'catalogo', _sala, 'produto', _produto, '{}'::jsonb);
    RETURN jsonb_build_object('ok', true, 'modo', 'excluido_definitivo',
      'mensagem', 'Produto excluído permanentemente (não possuía histórico).');
  ELSE
    UPDATE public.produtos
       SET excluido = true, excluido_em = now(), ativo = false
     WHERE id = _produto AND sala_id = _sala;
    DELETE FROM public.lotes WHERE produto_id = _produto AND sala_id = _sala;
    UPDATE public.estoque
       SET quantidade = 0, quantidade_reservada = 0,
           quantidade_valorizada = 0, valor_total = 0,
           ativo = false, updated_at = now()
     WHERE produto_id = _produto AND sala_id = _sala;
    PERFORM public.log_event('produto.excluido',
      'Produto excluído (histórico preservado nos relatórios): '||v_nome,
      'catalogo', _sala, 'produto', _produto, '{}'::jsonb);
    RETURN jsonb_build_object('ok', true, 'modo', 'excluido',
      'mensagem', 'Produto excluído. O histórico de movimentações permanece nos relatórios.');
  END IF;
END;
$$;

DROP INDEX IF EXISTS public.produtos_nome_sala_uniq;
CREATE UNIQUE INDEX produtos_nome_sala_uniq
  ON public.produtos (lower(nome), sala_id)
  WHERE sala_id IS NOT NULL AND excluido = false;

DROP INDEX IF EXISTS public.uniq_produtos_catalogo_sala;
CREATE UNIQUE INDEX uniq_produtos_catalogo_sala
  ON public.produtos (catalogo_id, sala_id)
  WHERE excluido = false;