-- Função de verificação de histórico (usada pela RPC e pelo frontend)
CREATE OR REPLACE FUNCTION public.produto_tem_historico(_produto uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    EXISTS(SELECT 1 FROM public.movimentacoes         WHERE produto_id = _produto)
 OR EXISTS(SELECT 1 FROM public.solicitacao_itens     WHERE produto_id = _produto)
 OR EXISTS(SELECT 1 FROM public.emprestimo_itens      WHERE produto_id = _produto)
 OR EXISTS(SELECT 1 FROM public.devolucao_itens       WHERE produto_id = _produto)
 OR EXISTS(SELECT 1 FROM public.dividas               WHERE produto_id = _produto)
 OR EXISTS(SELECT 1 FROM public.consumos_internos     WHERE produto_id = _produto)
 OR EXISTS(SELECT 1 FROM public.entradas_estoque      WHERE produto_id = _produto)
 OR EXISTS(SELECT 1 FROM public.produto_custo_historico WHERE produto_id = _produto)
 OR EXISTS(SELECT 1 FROM public.estoque               WHERE produto_id = _produto AND quantidade > 0)
$$;

GRANT EXECUTE ON FUNCTION public.produto_tem_historico(uuid) TO authenticated;

-- RPC de exclusão reforçada
CREATE OR REPLACE FUNCTION public.excluir_produto(_produto uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_nome text;
  v_sala uuid;
  v_tem  boolean;
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN
    RAISE EXCEPTION 'apenas master pode excluir produtos';
  END IF;

  SELECT nome, sala_id INTO v_nome, v_sala FROM public.produtos WHERE id = _produto;
  IF v_nome IS NULL THEN
    RETURN jsonb_build_object('modo', 'inexistente', 'mensagem', 'Produto não encontrado.');
  END IF;

  v_tem := public.produto_tem_historico(_produto);

  IF v_tem THEN
    UPDATE public.produtos SET ativo = false, updated_at = now() WHERE id = _produto;
    PERFORM public.log_event(
      'produto.desativado',
      'Produto desativado: '||v_nome,
      'catalogo', v_sala, 'produto', _produto,
      jsonb_build_object('motivo', 'possui_historico')
    );
    RETURN jsonb_build_object(
      'modo', 'desativado',
      'mensagem', 'Produto desativado. Como possui histórico operacional, ele é preservado para relatórios, auditoria e Central Analítica.'
    );
  ELSE
    DELETE FROM public.estoque   WHERE produto_id = _produto;
    DELETE FROM public.produtos  WHERE id = _produto;
    PERFORM public.log_event(
      'produto.excluido',
      'Produto excluído (sem histórico): '||v_nome,
      'catalogo', v_sala, 'produto', _produto, '{}'::jsonb
    );
    RETURN jsonb_build_object('modo', 'excluido', 'mensagem', 'Produto excluído permanentemente (sem histórico).');
  END IF;
END;
$function$;