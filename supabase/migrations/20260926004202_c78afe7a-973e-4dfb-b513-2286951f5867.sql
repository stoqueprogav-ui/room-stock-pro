
CREATE OR REPLACE FUNCTION public.get_user_sala(_user_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_active uuid; v_count integer; v_single uuid;
BEGIN
  IF _user_id IS NULL THEN RETURN NULL; END IF;
  SELECT usa.sala_id INTO v_active FROM public.user_sala_ativa usa
   WHERE usa.user_id = _user_id
     AND (public.has_role(_user_id, 'master')
          OR EXISTS (SELECT 1 FROM public.user_salas us WHERE us.user_id = _user_id AND us.sala_id = usa.sala_id));
  IF v_active IS NOT NULL THEN RETURN v_active; END IF;
  IF public.has_role(_user_id, 'master') THEN RETURN NULL; END IF;
  SELECT count(*), (array_agg(sala_id))[1] INTO v_count, v_single
    FROM public.user_salas WHERE user_id = _user_id;
  IF v_count = 1 THEN RETURN v_single; END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.user_regioes_explicitas(_user uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT mr.regiao_id FROM public.master_regioes mr WHERE mr.user_id = _user
  UNION
  SELECT s.regiao_id FROM public.user_salas us JOIN public.salas s ON s.id = us.sala_id
   WHERE us.user_id = _user AND s.regiao_id IS NOT NULL
  UNION
  SELECT s.regiao_id FROM public.profiles p JOIN public.salas s ON s.id = p.sala_id
   WHERE p.id = _user AND s.regiao_id IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.gestor_da_sala(_user uuid, _sala uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT (public.has_role(_user,'master') OR public.is_super_master(_user))
     AND public.sala_regiao(_sala) IN (SELECT public.user_regioes_explicitas(_user));
$$;

CREATE OR REPLACE FUNCTION public.can_access_conversation(_conv uuid, _user uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_type public.conversation_type; v_sala uuid; v_owner uuid; v_req uuid; v_emp uuid;
  v_user_sala uuid; v_gestor boolean; v_req_sala uuid; v_o uuid; v_d uuid;
BEGIN
  IF _user IS NULL THEN RETURN false; END IF;
  SELECT type, sala_id, owner_user_id, related_requisicao_id, related_emprestimo_id
    INTO v_type, v_sala, v_owner, v_req, v_emp FROM public.conversations WHERE id = _conv;
  IF v_type IS NULL THEN RETURN false; END IF;

  IF EXISTS (SELECT 1 FROM public.conversation_participants WHERE conversation_id=_conv AND user_id=_user) THEN
    RETURN true;
  END IF;

  v_gestor := public.has_role(_user,'master') OR public.is_super_master(_user);
  v_user_sala := public.get_user_sala(_user);

  IF v_req IS NOT NULL THEN
    SELECT sala_id INTO v_req_sala FROM public.solicitacoes WHERE id = v_req;
    IF v_gestor THEN RETURN public.gestor_da_sala(_user, v_req_sala); END IF;
    RETURN v_user_sala IS NOT NULL AND v_user_sala = v_req_sala;
  END IF;

  IF v_emp IS NOT NULL THEN
    SELECT sala_origem_id, sala_destino_id INTO v_o, v_d FROM public.emprestimos WHERE id = v_emp;
    IF v_gestor THEN RETURN public.gestor_da_sala(_user, v_o) OR public.gestor_da_sala(_user, v_d); END IF;
    RETURN v_user_sala IS NOT NULL AND v_user_sala IN (v_o, v_d);
  END IF;

  IF v_type = 'sala' THEN
    IF v_gestor THEN RETURN public.gestor_da_sala(_user, v_sala); END IF;
    RETURN v_user_sala IS NOT NULL AND v_user_sala = v_sala;
  ELSIF v_type = 'master' THEN
    IF v_owner = _user THEN RETURN true; END IF;
    RETURN v_gestor AND EXISTS (
      SELECT 1 FROM public.user_regioes_explicitas(_user) a
       WHERE a IN (SELECT public.user_regioes_explicitas(v_owner)));
  END IF;
  RETURN false;
END;
$function$;

CREATE OR REPLACE FUNCTION public._notify_masters(_category text, _event_type text, _title text, _body text, _link text, _entity_type text, _entity_id uuid, _sala_id uuid, _actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_ids uuid[];
BEGIN
  IF _sala_id IS NULL THEN RETURN; END IF;
  SELECT array_agg(DISTINCT ur.user_id) INTO v_ids
    FROM public.user_roles ur
   WHERE ur.role IN ('master'::public.app_role, 'super_master'::public.app_role)
     AND public.gestor_da_sala(ur.user_id, _sala_id)
     AND ur.user_id IS DISTINCT FROM _actor_id;
  PERFORM public._notify_users(COALESCE(v_ids, ARRAY[]::uuid[]),
    _category, _event_type, _title, _body, _link, _entity_type, _entity_id, _sala_id, _actor_id);
END;
$function$;

DELETE FROM public.notifications n
 WHERE n.sala_id IS NOT NULL
   AND (public.has_role(n.user_id,'master') OR public.is_super_master(n.user_id))
   AND NOT public.gestor_da_sala(n.user_id, n.sala_id)
   AND public.get_user_sala(n.user_id) IS DISTINCT FROM n.sala_id;
