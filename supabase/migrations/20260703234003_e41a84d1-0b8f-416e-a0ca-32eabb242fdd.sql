
-- =====================================================================
-- Migração A: notificações completas do Master + quitar_divida exige saldo=0
-- =====================================================================

-- Helper: notificar TODOS os masters, exceto o actor
CREATE OR REPLACE FUNCTION public._notify_masters(
  _category text, _event_type text, _title text, _body text,
  _link text, _entity_type text, _entity_id uuid, _sala_id uuid, _actor_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_ids uuid[];
BEGIN
  SELECT array_agg(user_id) INTO v_ids FROM public.user_roles WHERE role = 'master'::public.app_role;
  PERFORM public._notify_users(COALESCE(v_ids, ARRAY[]::uuid[]),
    _category, _event_type, _title, _body, _link, _entity_type, _entity_id, _sala_id, _actor_id);
END;
$$;

-- =====================================================================
-- Trigger de empréstimos: adicionar notificação ao master em todos os eventos
-- =====================================================================
CREATE OR REPLACE FUNCTION public._tg_notif_emprestimo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_short text;
  v_link text := '/app/emprestimos?id=' || NEW.id::text;
  v_credora_nome text;
  v_devedora_nome text;
  v_msg text;
  v_recipients uuid[];
BEGIN
  v_short := substr(NEW.id::text, 1, 8);
  SELECT nome INTO v_credora_nome FROM public.salas WHERE id = NEW.sala_origem_id;
  SELECT nome INTO v_devedora_nome FROM public.salas WHERE id = NEW.sala_destino_id;

  IF TG_OP = 'INSERT' THEN
    PERFORM public._notify_sala(NEW.sala_origem_id, 'emprestimo', 'emprestimo.criado',
      'Novo pedido de empréstimo',
      'A sala ' || COALESCE(v_devedora_nome, '—') || ' solicitou um empréstimo (#'||v_short||').',
      v_link, 'emprestimo', NEW.id, NEW.solicitante_id);
    PERFORM public._notify_masters('emprestimo', 'emprestimo.criado',
      'Novo empréstimo criado',
      COALESCE(v_devedora_nome,'—') || ' → ' || COALESCE(v_credora_nome,'—') || ' (#'||v_short||')',
      v_link, 'emprestimo', NEW.id, NEW.sala_origem_id, NEW.solicitante_id);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT array_agg(user_id) INTO v_recipients
      FROM public.user_salas WHERE sala_id = NEW.sala_destino_id;
    v_recipients := COALESCE(v_recipients, ARRAY[]::uuid[]) || ARRAY[NEW.solicitante_id];

    IF NEW.status = 'aprovado' THEN
      v_msg := 'Sua solicitação de empréstimo para a sala ' || COALESCE(v_credora_nome, '—') || ' foi aprovada.';
      IF NEW.motivo_decisao IS NOT NULL THEN v_msg := v_msg || E'\n\nObservação:\n' || NEW.motivo_decisao; END IF;
      PERFORM public._notify_users(v_recipients, 'emprestimo', 'emprestimo.aprovado',
        'Empréstimo aprovado', v_msg, v_link, 'emprestimo', NEW.id, NEW.sala_destino_id, NEW.decidido_por);
      PERFORM public._notify_sala(NEW.sala_origem_id, 'emprestimo', 'emprestimo.aprovado',
        'Empréstimo aprovado',
        'Aprovação registrada para o pedido #'||v_short||' da sala ' || COALESCE(v_devedora_nome, '—') || '.',
        v_link, 'emprestimo', NEW.id, NEW.decidido_por);
      PERFORM public._notify_masters('emprestimo', 'emprestimo.aprovado',
        'Empréstimo aprovado pela credora',
        COALESCE(v_credora_nome,'—') || ' aprovou o pedido de ' || COALESCE(v_devedora_nome,'—') || ' (#'||v_short||').',
        v_link, 'emprestimo', NEW.id, NEW.sala_origem_id, NEW.decidido_por);

    ELSIF NEW.status = 'rejeitado' THEN
      v_msg := 'Sua solicitação de empréstimo para a sala ' || COALESCE(v_credora_nome, '—') || ' foi rejeitada.';
      IF NEW.motivo_decisao IS NOT NULL THEN v_msg := v_msg || E'\n\nMotivo:\n' || NEW.motivo_decisao; END IF;
      PERFORM public._notify_users(v_recipients, 'emprestimo', 'emprestimo.rejeitado',
        'Empréstimo rejeitado', v_msg, v_link, 'emprestimo', NEW.id, NEW.sala_destino_id, NEW.decidido_por);
      PERFORM public._notify_sala(NEW.sala_origem_id, 'emprestimo', 'emprestimo.rejeitado',
        'Empréstimo rejeitado',
        'Rejeição registrada para o pedido #'||v_short||' da sala ' || COALESCE(v_devedora_nome, '—') || '.',
        v_link, 'emprestimo', NEW.id, NEW.decidido_por);
      PERFORM public._notify_masters('emprestimo', 'emprestimo.rejeitado',
        'Empréstimo rejeitado pela credora',
        COALESCE(v_credora_nome,'—') || ' rejeitou o pedido de ' || COALESCE(v_devedora_nome,'—') || ' (#'||v_short||').',
        v_link, 'emprestimo', NEW.id, NEW.sala_origem_id, NEW.decidido_por);

    ELSIF NEW.status = 'arquivado' THEN
      PERFORM public._notify_users(v_recipients, 'emprestimo', 'emprestimo.arquivado',
        'Empréstimo arquivado',
        'O empréstimo #'||v_short||' com a sala ' || COALESCE(v_credora_nome, '—') || ' foi arquivado.',
        v_link, 'emprestimo', NEW.id, NEW.sala_destino_id, auth.uid());
      PERFORM public._notify_sala(NEW.sala_origem_id, 'emprestimo', 'emprestimo.arquivado',
        'Empréstimo arquivado',
        'O empréstimo #'||v_short||' com a sala ' || COALESCE(v_devedora_nome, '—') || ' foi arquivado.',
        v_link, 'emprestimo', NEW.id, auth.uid());
      PERFORM public._notify_masters('emprestimo', 'emprestimo.arquivado',
        'Empréstimo arquivado',
        'Empréstimo #'||v_short||' ('||COALESCE(v_devedora_nome,'—')||' → '||COALESCE(v_credora_nome,'—')||') arquivado.',
        v_link, 'emprestimo', NEW.id, NEW.sala_origem_id, auth.uid());
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.status = 'pendente' AND NEW.status = 'pendente'
     AND (OLD.sala_origem_id IS DISTINCT FROM NEW.sala_origem_id
       OR COALESCE(OLD.observacao,'') IS DISTINCT FROM COALESCE(NEW.observacao,'')) THEN
    PERFORM public._notify_sala(NEW.sala_origem_id, 'emprestimo', 'emprestimo.editado',
      'Solicitação de empréstimo alterada',
      'O solicitante editou o pedido (#'||v_short||').', v_link,
      'emprestimo', NEW.id, auth.uid());
    IF OLD.sala_origem_id IS DISTINCT FROM NEW.sala_origem_id THEN
      PERFORM public._notify_sala(OLD.sala_origem_id, 'emprestimo', 'emprestimo.editado',
        'Pedido de empréstimo redirecionado',
        'A sala credora foi alterada (#'||v_short||').', v_link,
        'emprestimo', NEW.id, auth.uid());
    END IF;
    PERFORM public._notify_masters('emprestimo', 'emprestimo.editado',
      'Empréstimo editado',
      'O solicitante editou o pedido #'||v_short||'.',
      v_link, 'emprestimo', NEW.id, NEW.sala_origem_id, auth.uid());
  END IF;

  RETURN NEW;
END;
$$;

-- =====================================================================
-- Trigger de devolução: notificar master também
-- =====================================================================
CREATE OR REPLACE FUNCTION public._tg_notif_devolucao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_origem uuid; v_destino uuid; v_short text;
  v_pendente numeric;
  v_evt text; v_title_credora text; v_title_devedora text; v_title_master text;
BEGIN
  SELECT sala_origem_id, sala_destino_id INTO v_origem, v_destino
    FROM public.emprestimos WHERE id = NEW.emprestimo_id;
  v_short := substr(NEW.emprestimo_id::text, 1, 8);
  SELECT COALESCE(SUM(saldo),0) INTO v_pendente FROM public.dividas
    WHERE sala_devedora_id = v_destino AND sala_credora_id = v_origem;
  IF v_pendente <= 0 THEN
    v_evt := 'devolucao.total';
    v_title_credora := 'Todos os itens foram devolvidos';
    v_title_devedora := 'Empréstimo devolvido integralmente';
    v_title_master := 'Devolução total registrada';
  ELSE
    v_evt := 'devolucao.parcial';
    v_title_credora := 'Devolução parcial registrada';
    v_title_devedora := 'Devolução parcial registrada — saldo atualizado';
    v_title_master := 'Devolução parcial registrada';
  END IF;
  PERFORM public._notify_sala(v_origem, 'devolucao', v_evt, v_title_credora,
    'Empréstimo #'||v_short, '/app/dividas', 'emprestimo', NEW.emprestimo_id, NEW.usuario_id);
  PERFORM public._notify_sala(v_destino, 'devolucao', v_evt, v_title_devedora,
    'Empréstimo #'||v_short, '/app/dividas', 'emprestimo', NEW.emprestimo_id, NEW.usuario_id);
  PERFORM public._notify_masters('devolucao', v_evt, v_title_master,
    'Empréstimo #'||v_short, '/app/dividas', 'emprestimo', NEW.emprestimo_id, v_origem, NEW.usuario_id);
  RETURN NEW;
END;
$$;

-- =====================================================================
-- quitar_divida: agora EXIGE saldo já zerado (itens devolvidos fisicamente).
-- Assinatura antiga (com _quantidade) fica como wrapper que rejeita se pendente.
-- =====================================================================
DROP FUNCTION IF EXISTS public.quitar_divida(uuid, integer);

CREATE OR REPLACE FUNCTION public.quitar_divida(_divida uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_saldo integer;
  v_sd uuid; v_sc uuid; v_prod uuid;
  v_nome_prod text; v_nome_sd text; v_nome_sc text;
  v_outras_pend int;
  v_link text := '/app/dividas';
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN RAISE EXCEPTION 'apenas master'; END IF;
  SELECT saldo, sala_devedora_id, sala_credora_id, produto_id
    INTO v_saldo, v_sd, v_sc, v_prod
    FROM public.dividas WHERE id=_divida;
  IF v_saldo IS NULL THEN RAISE EXCEPTION 'dívida não encontrada'; END IF;
  IF v_saldo > 0 THEN
    RAISE EXCEPTION 'ainda existem % unidade(s) pendentes de devolução física. Registre a devolução antes de quitar.', v_saldo;
  END IF;

  SELECT nome INTO v_nome_prod FROM public.produtos WHERE id = v_prod;
  SELECT nome INTO v_nome_sd FROM public.salas WHERE id = v_sd;
  SELECT nome INTO v_nome_sc FROM public.salas WHERE id = v_sc;

  DELETE FROM public.dividas WHERE id=_divida;

  SELECT COUNT(*) INTO v_outras_pend FROM public.dividas
   WHERE sala_devedora_id = v_sd AND sala_credora_id = v_sc;

  PERFORM public._notify_sala(v_sc, 'devolucao', 'emprestimo.quitado_total',
    'Empréstimo quitado',
    'A sala ' || COALESCE(v_nome_sd,'devedora') || ' quitou a dívida de ' || COALESCE(v_nome_prod,'produto') ||
    CASE WHEN v_outras_pend = 0 THEN '. Não existem mais débitos em aberto com esta sala.'
         ELSE '. Ainda restam ' || v_outras_pend || ' pendência(s) em aberto com esta sala.' END,
    v_link, 'divida', _divida, v_user);

  PERFORM public._notify_sala(v_sd, 'devolucao', 'emprestimo.quitado_total',
    'Dívida quitada',
    'Sua sala quitou a dívida de ' || COALESCE(v_nome_prod,'produto') || ' junto à sala ' || COALESCE(v_nome_sc,'credora') ||
    CASE WHEN v_outras_pend = 0 THEN '. Este empréstimo não possui mais débitos em aberto.'
         ELSE '. Ainda restam ' || v_outras_pend || ' pendência(s) em aberto com essa sala.' END,
    v_link, 'divida', _divida, v_user);

  PERFORM public._notify_masters('devolucao', 'emprestimo.quitado_total',
    'Empréstimo quitado',
    COALESCE(v_nome_sd,'—') || ' quitou dívida de ' || COALESCE(v_nome_prod,'produto') || ' com ' || COALESCE(v_nome_sc,'—') || '.',
    v_link, 'divida', _divida, v_sd, v_user);

  PERFORM public.log_event(
    'divida.quitada','Dívida quitada (encerramento formal)','dividas', v_sd, 'divida', _divida,
    jsonb_build_object(
      'sala_credora', v_sc, 'sala_credora_nome', v_nome_sc,
      'sala_devedora', v_sd, 'sala_devedora_nome', v_nome_sd,
      'produto_id', v_prod, 'produto_nome', v_nome_prod,
      'pendencias_restantes_entre_salas', v_outras_pend
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.quitar_divida(uuid) TO authenticated;

-- =====================================================================
-- arquivar_emprestimo: notificar master
-- =====================================================================
-- (o trigger _tg_notif_emprestimo já cobre status='arquivado' e agora notifica master)
