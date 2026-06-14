
CREATE OR REPLACE FUNCTION public.quitar_divida(_divida uuid, _quantidade integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_saldo INTEGER;
  v_sd uuid; v_sc uuid; v_prod uuid;
  v_nome_prod text;
  v_nome_sd text;
  v_nome_sc text;
  v_quit_total boolean;
  v_outras_pend int;
  v_total_str text;
  v_link text := '/app/dividas';
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN RAISE EXCEPTION 'apenas master'; END IF;
  SELECT saldo, sala_devedora_id, sala_credora_id, produto_id INTO v_saldo, v_sd, v_sc, v_prod
    FROM public.dividas WHERE id=_divida;
  IF v_saldo IS NULL THEN RAISE EXCEPTION 'dívida não encontrada'; END IF;
  IF _quantidade <= 0 OR _quantidade > v_saldo THEN RAISE EXCEPTION 'quantidade inválida'; END IF;

  v_quit_total := (_quantidade = v_saldo);

  IF v_quit_total THEN
    DELETE FROM public.dividas WHERE id=_divida;
  ELSE
    UPDATE public.dividas SET saldo = saldo - _quantidade, updated_at = now() WHERE id=_divida;
  END IF;

  -- Dados para a notificação
  SELECT nome INTO v_nome_prod FROM public.produtos WHERE id = v_prod;
  SELECT nome INTO v_nome_sd FROM public.salas WHERE id = v_sd;
  SELECT nome INTO v_nome_sc FROM public.salas WHERE id = v_sc;

  -- Existem outras dívidas em aberto entre essas duas salas?
  SELECT COUNT(*) INTO v_outras_pend FROM public.dividas
   WHERE sala_devedora_id = v_sd AND sala_credora_id = v_sc;

  v_total_str := _quantidade::text || ' un. de ' || COALESCE(v_nome_prod,'produto');

  -- Notificação para SALA CREDORA
  PERFORM public._notify_sala(
    v_sc, 'devolucao',
    CASE WHEN v_quit_total THEN 'emprestimo.quitado_total' ELSE 'emprestimo.quitado_parcial' END,
    CASE WHEN v_outras_pend = 0
      THEN 'Empréstimo quitado'
      ELSE 'Pendência quitada (parcialmente liquidada)'
    END,
    'A sala ' || COALESCE(v_nome_sd,'devedora') || ' quitou ' || v_total_str ||
    CASE WHEN v_outras_pend = 0
      THEN '. Não existem mais débitos em aberto com esta sala.'
      ELSE '. Ainda restam ' || v_outras_pend || ' pendência(s) em aberto com esta sala.'
    END,
    v_link, 'divida', _divida, v_user
  );

  -- Notificação para SALA DEVEDORA
  PERFORM public._notify_sala(
    v_sd, 'devolucao',
    CASE WHEN v_quit_total THEN 'emprestimo.quitado_total' ELSE 'emprestimo.quitado_parcial' END,
    CASE WHEN v_outras_pend = 0
      THEN 'Dívida quitada'
      ELSE 'Dívida parcialmente quitada'
    END,
    'Sua sala quitou ' || v_total_str || ' junto à sala ' || COALESCE(v_nome_sc,'credora') ||
    CASE WHEN v_outras_pend = 0
      THEN '. Este empréstimo não possui mais débitos em aberto.'
      ELSE '. Ainda restam ' || v_outras_pend || ' pendência(s) em aberto com essa sala.'
    END,
    v_link, 'divida', _divida, v_user
  );

  PERFORM public.log_event(
    'divida.quitada','Dívida quitada manualmente','dividas', v_sd, 'divida', _divida,
    jsonb_build_object(
      'quantidade', _quantidade,
      'sala_credora', v_sc, 'sala_credora_nome', v_nome_sc,
      'sala_devedora', v_sd, 'sala_devedora_nome', v_nome_sd,
      'produto_id', v_prod, 'produto_nome', v_nome_prod,
      'quitacao_total', v_quit_total,
      'pendencias_restantes_entre_salas', v_outras_pend
    )
  );
END;
$function$;
