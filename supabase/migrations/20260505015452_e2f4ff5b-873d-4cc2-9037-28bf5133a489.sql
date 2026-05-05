
-- Update access function to allow pedido-linked conversations
CREATE OR REPLACE FUNCTION public.can_access_conversation(_conv uuid, _user uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_type public.conversation_type;
  v_sala uuid;
  v_owner uuid;
  v_req uuid;
  v_emp uuid;
  v_user_sala uuid;
  v_master_audit boolean;
  v_is_master boolean;
  v_is_part boolean;
  v_req_sala uuid;
  v_emp_origem uuid;
  v_emp_destino uuid;
BEGIN
  IF _user IS NULL THEN RETURN false; END IF;
  SELECT type, sala_id, owner_user_id, related_requisicao_id, related_emprestimo_id
    INTO v_type, v_sala, v_owner, v_req, v_emp
    FROM public.conversations WHERE id = _conv;
  IF v_type IS NULL THEN RETURN false; END IF;

  v_is_master := public.has_role(_user, 'master');
  IF v_is_master THEN RETURN true; END IF;
  v_user_sala := public.get_user_sala(_user);

  -- Pedido-linked conversation: any user from involved salas can access
  IF v_req IS NOT NULL THEN
    SELECT sala_id INTO v_req_sala FROM public.solicitacoes WHERE id = v_req;
    RETURN v_user_sala = v_req_sala;
  END IF;
  IF v_emp IS NOT NULL THEN
    SELECT sala_origem_id, sala_destino_id INTO v_emp_origem, v_emp_destino
      FROM public.emprestimos WHERE id = v_emp;
    RETURN v_user_sala IN (v_emp_origem, v_emp_destino);
  END IF;

  IF v_type = 'sala' THEN
    RETURN v_user_sala = v_sala;
  ELSIF v_type = 'master' THEN
    RETURN v_owner = _user;
  ELSE
    SELECT EXISTS(SELECT 1 FROM public.conversation_participants
      WHERE conversation_id=_conv AND user_id=_user) INTO v_is_part;
    IF v_is_part THEN RETURN true; END IF;
    SELECT COALESCE((value)::boolean, false) INTO v_master_audit
      FROM public.app_settings WHERE key='master_can_read_all_dms';
    RETURN false;
  END IF;
END;
$function$;

-- Get or create a conversation linked to a pedido
CREATE OR REPLACE FUNCTION public.get_or_create_pedido_conversation(_kind text, _id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_user_sala uuid;
  v_conv uuid;
  v_title text;
  v_sala uuid;
  v_origem uuid;
  v_destino uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  v_user_sala := public.get_user_sala(v_user);

  IF _kind = 'requisicao' THEN
    SELECT sala_id INTO v_sala FROM public.solicitacoes WHERE id = _id;
    IF v_sala IS NULL THEN RAISE EXCEPTION 'requisição não encontrada'; END IF;
    IF NOT (public.has_role(v_user,'master') OR v_user_sala = v_sala) THEN
      RAISE EXCEPTION 'sem acesso';
    END IF;
    SELECT id INTO v_conv FROM public.conversations
      WHERE related_requisicao_id = _id LIMIT 1;
    IF v_conv IS NOT NULL THEN RETURN v_conv; END IF;
    v_title := 'Requisição #' || substr(_id::text, 1, 8);
    INSERT INTO public.conversations (type, sala_id, related_requisicao_id, created_by, title)
      VALUES ('sala', v_sala, _id, v_user, v_title) RETURNING id INTO v_conv;
    RETURN v_conv;

  ELSIF _kind = 'emprestimo' THEN
    SELECT sala_origem_id, sala_destino_id INTO v_origem, v_destino
      FROM public.emprestimos WHERE id = _id;
    IF v_origem IS NULL THEN RAISE EXCEPTION 'empréstimo não encontrado'; END IF;
    IF NOT (public.has_role(v_user,'master') OR v_user_sala IN (v_origem, v_destino)) THEN
      RAISE EXCEPTION 'sem acesso';
    END IF;
    SELECT id INTO v_conv FROM public.conversations
      WHERE related_emprestimo_id = _id LIMIT 1;
    IF v_conv IS NOT NULL THEN RETURN v_conv; END IF;
    v_title := 'Empréstimo #' || substr(_id::text, 1, 8);
    INSERT INTO public.conversations (type, related_emprestimo_id, created_by, title)
      VALUES ('sala', _id, v_user, v_title) RETURNING id INTO v_conv;
    RETURN v_conv;
  ELSE
    RAISE EXCEPTION 'tipo inválido';
  END IF;
END;
$function$;
