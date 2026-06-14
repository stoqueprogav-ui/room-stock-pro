
-- ============ TABELA ============
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  category text NOT NULL,
  event_type text NOT NULL,
  title text NOT NULL,
  body text,
  link text,
  entity_type text,
  entity_id uuid,
  sala_id uuid,
  actor_id uuid,
  is_read boolean NOT NULL DEFAULT false,
  is_dismissed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications(user_id) WHERE is_read = false AND is_dismissed = false;

GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users read own notifications" ON public.notifications;
CREATE POLICY "users read own notifications" ON public.notifications
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users update own notifications" ON public.notifications;
CREATE POLICY "users update own notifications" ON public.notifications
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Realtime
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.notifications REPLICA IDENTITY FULL;

-- ============ HELPERS ============
CREATE OR REPLACE FUNCTION public._notify_users(
  _user_ids uuid[], _category text, _event_type text,
  _title text, _body text, _link text,
  _entity_type text, _entity_id uuid, _sala_id uuid, _actor_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF _user_ids IS NULL OR cardinality(_user_ids) = 0 THEN RETURN; END IF;
  INSERT INTO public.notifications (user_id, category, event_type, title, body, link, entity_type, entity_id, sala_id, actor_id)
  SELECT DISTINCT u, _category, _event_type, _title, _body, _link, _entity_type, _entity_id, _sala_id, _actor_id
    FROM unnest(_user_ids) u
   WHERE u IS NOT NULL AND (_actor_id IS NULL OR u <> _actor_id);
END;
$$;

CREATE OR REPLACE FUNCTION public._notify_sala(
  _sala uuid, _category text, _event_type text,
  _title text, _body text, _link text,
  _entity_type text, _entity_id uuid, _actor_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_ids uuid[];
BEGIN
  IF _sala IS NULL THEN RETURN; END IF;
  SELECT array_agg(user_id) INTO v_ids FROM public.user_salas WHERE sala_id = _sala;
  PERFORM public._notify_users(COALESCE(v_ids, ARRAY[]::uuid[]), _category, _event_type, _title, _body, _link, _entity_type, _entity_id, _sala, _actor_id);
END;
$$;

CREATE OR REPLACE FUNCTION public._notify_masters(
  _category text, _event_type text, _title text, _body text, _link text,
  _entity_type text, _entity_id uuid, _sala_id uuid, _actor_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_ids uuid[];
BEGIN
  SELECT array_agg(user_id) INTO v_ids FROM public.user_roles WHERE role = 'master';
  PERFORM public._notify_users(COALESCE(v_ids, ARRAY[]::uuid[]), _category, _event_type, _title, _body, _link, _entity_type, _entity_id, _sala_id, _actor_id);
END;
$$;

-- ============ TRIGGER: SOLICITACOES ============
CREATE OR REPLACE FUNCTION public._tg_notif_solicitacao() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_short text;
  v_link text := '/app/minhas-requisicoes';
BEGIN
  v_short := substr(NEW.id::text, 1, 8);
  IF TG_OP = 'INSERT' THEN
    PERFORM public._notify_masters(
      'requisicao', 'requisicao.criada',
      'Nova requisição recebida',
      'Aguardando análise (#'||v_short||')',
      '/app/requisicoes',
      'solicitacao', NEW.id, NEW.sala_id, NEW.usuario_id);
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'aprovado' THEN
      PERFORM public._notify_sala(NEW.sala_id, 'requisicao', 'requisicao.aprovada',
        'Sua requisição foi aprovada', 'Requisição #'||v_short, v_link,
        'solicitacao', NEW.id, NEW.decidido_por);
    ELSIF NEW.status = 'rejeitado' THEN
      PERFORM public._notify_sala(NEW.sala_id, 'requisicao', 'requisicao.rejeitada',
        'Sua requisição foi rejeitada', 'Requisição #'||v_short, v_link,
        'solicitacao', NEW.id, NEW.decidido_por);
    ELSIF NEW.status = 'arquivado' THEN
      PERFORM public._notify_sala(NEW.sala_id, 'requisicao', 'requisicao.arquivada',
        'Sua requisição foi concluída e arquivada', 'Requisição #'||v_short, v_link,
        'solicitacao', NEW.id, NEW.decidido_por);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_notif_solicitacao ON public.solicitacoes;
CREATE TRIGGER tg_notif_solicitacao AFTER INSERT OR UPDATE ON public.solicitacoes
  FOR EACH ROW EXECUTE FUNCTION public._tg_notif_solicitacao();

-- ============ TRIGGER: EMPRESTIMOS ============
CREATE OR REPLACE FUNCTION public._tg_notif_emprestimo() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_short text;
  v_link text := '/app/emprestimos';
BEGIN
  v_short := substr(NEW.id::text, 1, 8);
  IF TG_OP = 'INSERT' THEN
    -- Notifica sala credora (sala_origem) — quem empresta
    PERFORM public._notify_sala(NEW.sala_origem_id, 'emprestimo', 'emprestimo.criado',
      'Novo pedido de empréstimo', 'Aguarda sua análise (#'||v_short||')', v_link,
      'emprestimo', NEW.id, NEW.solicitante_id);
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      IF NEW.status = 'aprovado' THEN
        -- Master aprovou: notifica devedora e credora
        PERFORM public._notify_sala(NEW.sala_destino_id, 'emprestimo', 'emprestimo.aprovado',
          'Seu empréstimo foi aprovado', 'Itens liberados (#'||v_short||')', v_link,
          'emprestimo', NEW.id, NEW.decidido_por);
        PERFORM public._notify_sala(NEW.sala_origem_id, 'emprestimo', 'emprestimo.aprovado',
          'Empréstimo aprovado pelo Master', 'Empréstimo #'||v_short, v_link,
          'emprestimo', NEW.id, NEW.decidido_por);
      ELSIF NEW.status = 'rejeitado' THEN
        PERFORM public._notify_sala(NEW.sala_destino_id, 'emprestimo', 'emprestimo.rejeitado',
          'Seu empréstimo foi rejeitado', 'Empréstimo #'||v_short, v_link,
          'emprestimo', NEW.id, NEW.decidido_por);
        PERFORM public._notify_sala(NEW.sala_origem_id, 'emprestimo', 'emprestimo.rejeitado',
          'Empréstimo rejeitado pelo Master', 'Empréstimo #'||v_short, v_link,
          'emprestimo', NEW.id, NEW.decidido_por);
      ELSIF NEW.status = 'arquivado' THEN
        PERFORM public._notify_sala(NEW.sala_destino_id, 'emprestimo', 'emprestimo.arquivado',
          'Empréstimo arquivado', 'Empréstimo #'||v_short, v_link,
          'emprestimo', NEW.id, auth.uid());
        PERFORM public._notify_sala(NEW.sala_origem_id, 'emprestimo', 'emprestimo.arquivado',
          'Empréstimo arquivado', 'Empréstimo #'||v_short, v_link,
          'emprestimo', NEW.id, auth.uid());
      END IF;
    ELSIF OLD.status = 'pendente' AND NEW.status = 'pendente'
      AND (OLD.sala_origem_id IS DISTINCT FROM NEW.sala_origem_id
        OR COALESCE(OLD.observacao,'') IS DISTINCT FROM COALESCE(NEW.observacao,'')) THEN
      -- Edição enquanto pendente
      PERFORM public._notify_sala(NEW.sala_origem_id, 'emprestimo', 'emprestimo.editado',
        'Solicitação de empréstimo alterada', 'O solicitante editou o pedido (#'||v_short||')', v_link,
        'emprestimo', NEW.id, auth.uid());
      IF OLD.sala_origem_id IS DISTINCT FROM NEW.sala_origem_id THEN
        PERFORM public._notify_sala(OLD.sala_origem_id, 'emprestimo', 'emprestimo.editado',
          'Pedido de empréstimo redirecionado', 'A sala credora foi alterada (#'||v_short||')', v_link,
          'emprestimo', NEW.id, auth.uid());
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_notif_emprestimo ON public.emprestimos;
CREATE TRIGGER tg_notif_emprestimo AFTER INSERT OR UPDATE ON public.emprestimos
  FOR EACH ROW EXECUTE FUNCTION public._tg_notif_emprestimo();

-- ============ TRIGGER: DEVOLUCOES ============
CREATE OR REPLACE FUNCTION public._tg_notif_devolucao() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_origem uuid; v_destino uuid; v_short text;
  v_pendente numeric;
  v_evt text; v_title_credora text; v_title_devedora text;
BEGIN
  SELECT sala_origem_id, sala_destino_id INTO v_origem, v_destino
    FROM public.emprestimos WHERE id = NEW.emprestimo_id;
  v_short := substr(NEW.emprestimo_id::text, 1, 8);
  SELECT COALESCE(SUM(saldo),0) INTO v_pendente FROM public.dividas
    WHERE sala_devedora_id = v_destino AND sala_credora_id = v_origem;
  IF v_pendente <= 0 THEN
    v_evt := 'devolucao.total';
    v_title_credora := 'Todos os itens foram devolvidos';
    v_title_devedora := 'Empréstimo quitado com sucesso';
  ELSE
    v_evt := 'devolucao.parcial';
    v_title_credora := 'Devolução parcial registrada';
    v_title_devedora := 'Devolução parcial registrada — saldo atualizado';
  END IF;
  PERFORM public._notify_sala(v_origem, 'devolucao', v_evt, v_title_credora,
    'Empréstimo #'||v_short, '/app/dividas', 'emprestimo', NEW.emprestimo_id, NEW.usuario_id);
  PERFORM public._notify_sala(v_destino, 'devolucao', v_evt, v_title_devedora,
    'Empréstimo #'||v_short, '/app/dividas', 'emprestimo', NEW.emprestimo_id, NEW.usuario_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_notif_devolucao ON public.devolucoes;
CREATE TRIGGER tg_notif_devolucao AFTER INSERT ON public.devolucoes
  FOR EACH ROW EXECUTE FUNCTION public._tg_notif_devolucao();
