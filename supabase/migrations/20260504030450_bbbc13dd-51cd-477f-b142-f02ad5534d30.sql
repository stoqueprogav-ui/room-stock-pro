
-- =========================================
-- CHAT INTERNO
-- =========================================

-- Configurações globais
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_settings_select_all ON public.app_settings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY app_settings_master_write ON public.app_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'master'))
  WITH CHECK (public.has_role(auth.uid(), 'master'));

INSERT INTO public.app_settings (key, value) VALUES
  ('master_can_read_all_dms', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Tipos de conversa
DO $$ BEGIN
  CREATE TYPE public.conversation_type AS ENUM ('direct','sala','master');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Conversas
CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type public.conversation_type NOT NULL,
  sala_id uuid REFERENCES public.salas(id) ON DELETE CASCADE,
  owner_user_id uuid, -- para tipo 'master'
  related_requisicao_id uuid,
  related_emprestimo_id uuid,
  title text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS conv_unique_sala ON public.conversations(sala_id) WHERE type='sala' AND related_requisicao_id IS NULL AND related_emprestimo_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS conv_unique_master_owner ON public.conversations(owner_user_id) WHERE type='master' AND related_requisicao_id IS NULL AND related_emprestimo_id IS NULL;

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

-- Participantes (usado principalmente para 'direct')
CREATE TABLE IF NOT EXISTS public.conversation_participants (
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;

-- Leituras
CREATE TABLE IF NOT EXISTS public.conversation_reads (
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);
ALTER TABLE public.conversation_reads ENABLE ROW LEVEL SECURITY;

-- Mensagens
CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  body text,
  attachment_path text,
  attachment_name text,
  attachment_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conv_created ON public.messages(conversation_id, created_at);
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- =========================================
-- HELPERS (security definer)
-- =========================================

CREATE OR REPLACE FUNCTION public.can_access_conversation(_conv uuid, _user uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type public.conversation_type;
  v_sala uuid;
  v_owner uuid;
  v_user_sala uuid;
  v_master_audit boolean;
  v_is_master boolean;
  v_is_part boolean;
BEGIN
  IF _user IS NULL THEN RETURN false; END IF;
  SELECT type, sala_id, owner_user_id INTO v_type, v_sala, v_owner
    FROM public.conversations WHERE id = _conv;
  IF v_type IS NULL THEN RETURN false; END IF;

  v_is_master := public.has_role(_user, 'master');
  v_user_sala := public.get_user_sala(_user);

  IF v_type = 'sala' THEN
    IF v_is_master THEN RETURN true; END IF;
    RETURN v_user_sala = v_sala;
  ELSIF v_type = 'master' THEN
    IF v_is_master THEN RETURN true; END IF;
    RETURN v_owner = _user;
  ELSE -- direct
    SELECT EXISTS(SELECT 1 FROM public.conversation_participants
      WHERE conversation_id=_conv AND user_id=_user) INTO v_is_part;
    IF v_is_part THEN RETURN true; END IF;
    IF v_is_master THEN
      SELECT COALESCE((value)::boolean, false) INTO v_master_audit
        FROM public.app_settings WHERE key='master_can_read_all_dms';
      RETURN COALESCE(v_master_audit, false);
    END IF;
    RETURN false;
  END IF;
END;
$$;

-- =========================================
-- POLICIES
-- =========================================

CREATE POLICY conv_select ON public.conversations
  FOR SELECT TO authenticated
  USING (public.can_access_conversation(id, auth.uid()));

CREATE POLICY conv_insert_auth ON public.conversations
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY conv_master_all ON public.conversations
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'master'))
  WITH CHECK (public.has_role(auth.uid(),'master'));

CREATE POLICY parts_select ON public.conversation_participants
  FOR SELECT TO authenticated
  USING (public.can_access_conversation(conversation_id, auth.uid()));
CREATE POLICY parts_insert ON public.conversation_participants
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY parts_master ON public.conversation_participants
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'master'))
  WITH CHECK (public.has_role(auth.uid(),'master'));

CREATE POLICY reads_select_self ON public.conversation_reads
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY reads_upsert_self ON public.conversation_reads
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY reads_update_self ON public.conversation_reads
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY msg_select ON public.messages
  FOR SELECT TO authenticated
  USING (public.can_access_conversation(conversation_id, auth.uid()));
CREATE POLICY msg_insert ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid() AND public.can_access_conversation(conversation_id, auth.uid()));
CREATE POLICY msg_master_delete ON public.messages
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'master'));

-- =========================================
-- RPC: criar/obter conversas
-- =========================================

CREATE OR REPLACE FUNCTION public.get_or_create_direct_conversation(_other uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_conv uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  IF _other = v_user THEN RAISE EXCEPTION 'não pode conversar consigo mesmo'; END IF;

  SELECT c.id INTO v_conv
  FROM public.conversations c
  WHERE c.type='direct'
    AND c.related_requisicao_id IS NULL
    AND c.related_emprestimo_id IS NULL
    AND EXISTS(SELECT 1 FROM public.conversation_participants p WHERE p.conversation_id=c.id AND p.user_id=v_user)
    AND EXISTS(SELECT 1 FROM public.conversation_participants p WHERE p.conversation_id=c.id AND p.user_id=_other)
    AND (SELECT COUNT(*) FROM public.conversation_participants p WHERE p.conversation_id=c.id) = 2
  LIMIT 1;

  IF v_conv IS NOT NULL THEN RETURN v_conv; END IF;

  INSERT INTO public.conversations (type, created_by) VALUES ('direct', v_user) RETURNING id INTO v_conv;
  INSERT INTO public.conversation_participants (conversation_id, user_id) VALUES (v_conv, v_user), (v_conv, _other);
  RETURN v_conv;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_or_create_sala_conversation(_sala uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_user_sala uuid;
  v_conv uuid;
  v_nome text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  v_user_sala := public.get_user_sala(v_user);
  IF NOT (public.has_role(v_user,'master') OR v_user_sala = _sala) THEN
    RAISE EXCEPTION 'sem acesso à sala';
  END IF;

  SELECT id INTO v_conv FROM public.conversations
   WHERE type='sala' AND sala_id=_sala AND related_requisicao_id IS NULL AND related_emprestimo_id IS NULL
   LIMIT 1;
  IF v_conv IS NOT NULL THEN RETURN v_conv; END IF;

  SELECT nome INTO v_nome FROM public.salas WHERE id=_sala;
  INSERT INTO public.conversations (type, sala_id, created_by, title)
    VALUES ('sala', _sala, v_user, COALESCE(v_nome,'Sala')) RETURNING id INTO v_conv;
  RETURN v_conv;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_or_create_master_conversation(_owner uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_target uuid;
  v_conv uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  v_target := COALESCE(_owner, v_user);
  IF v_target <> v_user AND NOT public.has_role(v_user,'master') THEN
    RAISE EXCEPTION 'sem permissão';
  END IF;
  IF public.has_role(v_target,'master') THEN
    RAISE EXCEPTION 'master não tem conversa-com-master própria';
  END IF;

  SELECT id INTO v_conv FROM public.conversations
   WHERE type='master' AND owner_user_id=v_target AND related_requisicao_id IS NULL AND related_emprestimo_id IS NULL
   LIMIT 1;
  IF v_conv IS NOT NULL THEN RETURN v_conv; END IF;

  INSERT INTO public.conversations (type, owner_user_id, created_by, title)
    VALUES ('master', v_target, v_user, 'Master') RETURNING id INTO v_conv;
  RETURN v_conv;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_message(
  _conv uuid, _body text, _attachment_path text DEFAULT NULL,
  _attachment_name text DEFAULT NULL, _attachment_type text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  IF NOT public.can_access_conversation(_conv, v_user) THEN
    RAISE EXCEPTION 'sem acesso à conversa';
  END IF;
  IF (COALESCE(trim(_body),'') = '') AND _attachment_path IS NULL THEN
    RAISE EXCEPTION 'mensagem vazia';
  END IF;
  INSERT INTO public.messages (conversation_id, sender_id, body, attachment_path, attachment_name, attachment_type)
    VALUES (_conv, v_user, NULLIF(trim(_body),''), _attachment_path, _attachment_name, _attachment_type)
    RETURNING id INTO v_id;
  UPDATE public.conversations SET updated_at=now() WHERE id=_conv;
  INSERT INTO public.conversation_reads (conversation_id, user_id, last_read_at)
    VALUES (_conv, v_user, now())
    ON CONFLICT (conversation_id, user_id) DO UPDATE SET last_read_at=EXCLUDED.last_read_at;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_conversation_read(_conv uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  IF NOT public.can_access_conversation(_conv, v_user) THEN RETURN; END IF;
  INSERT INTO public.conversation_reads (conversation_id, user_id, last_read_at)
    VALUES (_conv, v_user, now())
    ON CONFLICT (conversation_id, user_id) DO UPDATE SET last_read_at=EXCLUDED.last_read_at;
END;
$$;

-- Lista de conversas acessíveis ao usuário com prévia
CREATE OR REPLACE FUNCTION public.list_my_conversations()
RETURNS TABLE(
  id uuid, type public.conversation_type, sala_id uuid, owner_user_id uuid,
  title text, related_requisicao_id uuid, related_emprestimo_id uuid,
  updated_at timestamptz, last_message_body text, last_message_at timestamptz,
  last_sender_id uuid, unread_count integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  RETURN QUERY
  WITH accessible AS (
    SELECT c.* FROM public.conversations c
    WHERE public.can_access_conversation(c.id, v_user)
  ),
  last_msg AS (
    SELECT DISTINCT ON (m.conversation_id)
      m.conversation_id, m.body, m.created_at, m.sender_id, m.attachment_name
    FROM public.messages m
    WHERE m.conversation_id IN (SELECT id FROM accessible)
    ORDER BY m.conversation_id, m.created_at DESC
  )
  SELECT
    a.id, a.type, a.sala_id, a.owner_user_id, a.title,
    a.related_requisicao_id, a.related_emprestimo_id, a.updated_at,
    COALESCE(lm.body, CASE WHEN lm.attachment_name IS NOT NULL THEN '📎 '||lm.attachment_name ELSE NULL END),
    lm.created_at, lm.sender_id,
    (SELECT COUNT(*)::int FROM public.messages m2
       WHERE m2.conversation_id = a.id
         AND m2.sender_id <> v_user
         AND m2.created_at > COALESCE(
           (SELECT last_read_at FROM public.conversation_reads r WHERE r.conversation_id=a.id AND r.user_id=v_user),
           'epoch'::timestamptz
         ))
  FROM accessible a
  LEFT JOIN last_msg lm ON lm.conversation_id = a.id
  ORDER BY COALESCE(lm.created_at, a.updated_at) DESC;
END;
$$;

-- =========================================
-- REALTIME
-- =========================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;

-- =========================================
-- STORAGE BUCKET para anexos
-- =========================================
INSERT INTO storage.buckets (id, name, public) VALUES ('chat-anexos','chat-anexos', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "chat anexos select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id='chat-anexos'
    AND public.can_access_conversation(
      (split_part(name,'/',1))::uuid, auth.uid()
    )
  );

CREATE POLICY "chat anexos insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id='chat-anexos'
    AND public.can_access_conversation(
      (split_part(name,'/',1))::uuid, auth.uid()
    )
  );
