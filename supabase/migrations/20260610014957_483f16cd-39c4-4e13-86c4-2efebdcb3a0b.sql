CREATE TABLE IF NOT EXISTS public.user_sala_ativa (
  user_id uuid PRIMARY KEY,
  sala_id uuid NOT NULL REFERENCES public.salas(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.user_sala_ativa TO authenticated;
GRANT ALL ON public.user_sala_ativa TO service_role;

ALTER TABLE public.user_sala_ativa ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_sala_ativa_select_self_or_master ON public.user_sala_ativa;
CREATE POLICY user_sala_ativa_select_self_or_master ON public.user_sala_ativa
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'master'));

INSERT INTO public.user_sala_ativa (user_id, sala_id)
SELECT p.id, p.sala_id
FROM public.profiles p
WHERE p.sala_id IS NOT NULL
  AND (
    public.has_role(p.id, 'master')
    OR EXISTS (
      SELECT 1 FROM public.user_salas us
      WHERE us.user_id = p.id AND us.sala_id = p.sala_id
    )
  )
ON CONFLICT (user_id) DO UPDATE SET sala_id = EXCLUDED.sala_id, updated_at = now();

CREATE OR REPLACE FUNCTION public.get_user_sala(_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_active uuid;
  v_count integer;
  v_single uuid;
BEGIN
  IF _user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT usa.sala_id INTO v_active
  FROM public.user_sala_ativa usa
  WHERE usa.user_id = _user_id
    AND (
      public.has_role(_user_id, 'master')
      OR EXISTS (
        SELECT 1 FROM public.user_salas us
        WHERE us.user_id = _user_id AND us.sala_id = usa.sala_id
      )
    );

  IF v_active IS NOT NULL THEN
    RETURN v_active;
  END IF;

  IF public.has_role(_user_id, 'master') THEN
    RETURN NULL;
  END IF;

  SELECT count(*), min(sala_id)
    INTO v_count, v_single
  FROM public.user_salas
  WHERE user_id = _user_id;

  IF v_count = 1 THEN
    RETURN v_single;
  END IF;

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.listar_minhas_salas()
RETURNS TABLE(sala_id uuid, sala_nome text, ativa boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_active uuid;
  v_count integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;

  v_active := public.get_user_sala(v_user);

  IF public.has_role(v_user,'master') THEN
    RETURN QUERY
      SELECT s.id, s.nome, (s.id = v_active)
      FROM public.salas s
      ORDER BY s.nome;
  ELSE
    SELECT count(*) INTO v_count FROM public.user_salas WHERE user_id = v_user;
    RETURN QUERY
      SELECT s.id, s.nome, (s.id = v_active OR (v_active IS NULL AND v_count = 1))
      FROM public.user_salas us
      JOIN public.salas s ON s.id = us.sala_id
      WHERE us.user_id = v_user
      ORDER BY s.nome;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_minha_sala_ativa(_sala uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  IF _sala IS NULL THEN RAISE EXCEPTION 'sala inválida'; END IF;

  IF NOT public.has_role(v_user,'master') AND NOT EXISTS (
    SELECT 1 FROM public.user_salas WHERE user_id = v_user AND sala_id = _sala
  ) THEN
    RAISE EXCEPTION 'sala não autorizada para este usuário';
  END IF;

  INSERT INTO public.user_sala_ativa (user_id, sala_id, updated_at)
  VALUES (v_user, _sala, now())
  ON CONFLICT (user_id) DO UPDATE SET sala_id = EXCLUDED.sala_id, updated_at = now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_user_salas(_user uuid, _salas uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_active uuid;
  v_first uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'master') THEN
    RAISE EXCEPTION 'apenas master';
  END IF;

  DELETE FROM public.user_salas WHERE user_id = _user;
  IF coalesce(array_length(_salas, 1), 0) > 0 THEN
    INSERT INTO public.user_salas (user_id, sala_id)
    SELECT _user, unnest(_salas)
    ON CONFLICT DO NOTHING;
  END IF;

  SELECT sala_id INTO v_active FROM public.user_sala_ativa WHERE user_id = _user;
  IF coalesce(array_length(_salas, 1), 0) = 0 THEN
    DELETE FROM public.user_sala_ativa WHERE user_id = _user;
  ELSIF v_active IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_salas WHERE user_id = _user AND sala_id = v_active
  ) THEN
    SELECT sala_id INTO v_first FROM public.user_salas WHERE user_id = _user ORDER BY created_at LIMIT 1;
    INSERT INTO public.user_sala_ativa (user_id, sala_id, updated_at)
    VALUES (_user, v_first, now())
    ON CONFLICT (user_id) DO UPDATE SET sala_id = EXCLUDED.sala_id, updated_at = now();
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public._user_salas_after_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_active uuid;
  v_new uuid;
BEGIN
  SELECT sala_id INTO v_active FROM public.user_sala_ativa WHERE user_id = OLD.user_id;
  IF v_active = OLD.sala_id THEN
    SELECT sala_id INTO v_new FROM public.user_salas WHERE user_id = OLD.user_id ORDER BY created_at LIMIT 1;
    IF v_new IS NULL THEN
      DELETE FROM public.user_sala_ativa WHERE user_id = OLD.user_id;
    ELSE
      UPDATE public.user_sala_ativa SET sala_id = v_new, updated_at = now() WHERE user_id = OLD.user_id;
    END IF;
  END IF;
  RETURN OLD;
END;
$function$;

DROP POLICY IF EXISTS emp_insert_user_sala_destino ON public.emprestimos;
CREATE POLICY emp_insert_user_sala_destino ON public.emprestimos
  FOR INSERT TO authenticated
  WITH CHECK ((solicitante_id = auth.uid()) AND (sala_destino_id = public.get_user_sala(auth.uid())));

DROP POLICY IF EXISTS emp_update_master_or_admin_origem ON public.emprestimos;
CREATE POLICY emp_update_master_or_admin_origem ON public.emprestimos
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'master') OR (public.has_role(auth.uid(), 'admin') AND sala_origem_id = public.get_user_sala(auth.uid())))
  WITH CHECK (public.has_role(auth.uid(), 'master') OR (public.has_role(auth.uid(), 'admin') AND sala_origem_id = public.get_user_sala(auth.uid())));

DROP POLICY IF EXISTS emp_itens_insert ON public.emprestimo_itens;
CREATE POLICY emp_itens_insert ON public.emprestimo_itens
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.emprestimos e
    WHERE e.id = emprestimo_itens.emprestimo_id
      AND e.solicitante_id = auth.uid()
      AND e.sala_destino_id = public.get_user_sala(auth.uid())
  ));

DROP POLICY IF EXISTS solic_insert_user_sala ON public.solicitacoes;
CREATE POLICY solic_insert_user_sala ON public.solicitacoes
  FOR INSERT TO authenticated
  WITH CHECK ((usuario_id = auth.uid()) AND (sala_id = public.get_user_sala(auth.uid())));

DROP POLICY IF EXISTS solic_itens_insert ON public.solicitacao_itens;
CREATE POLICY solic_itens_insert ON public.solicitacao_itens
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.solicitacoes s
    WHERE s.id = solicitacao_itens.solicitacao_id
      AND s.usuario_id = auth.uid()
      AND s.sala_id = public.get_user_sala(auth.uid())
  ));

DROP POLICY IF EXISTS devolucoes_select_envolvidos ON public.devolucoes;
CREATE POLICY devolucoes_select_envolvidos ON public.devolucoes
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.emprestimos e
    WHERE e.id = devolucoes.emprestimo_id
      AND (
        public.has_role(auth.uid(), 'master')
        OR public.user_has_sala_access(auth.uid(), e.sala_origem_id)
        OR public.user_has_sala_access(auth.uid(), e.sala_destino_id)
      )
  ));

DROP POLICY IF EXISTS devolucao_itens_select_envolvidos ON public.devolucao_itens;
CREATE POLICY devolucao_itens_select_envolvidos ON public.devolucao_itens
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.devolucoes d
    JOIN public.emprestimos e ON e.id = d.emprestimo_id
    WHERE d.id = devolucao_itens.devolucao_id
      AND (
        public.has_role(auth.uid(), 'master')
        OR public.user_has_sala_access(auth.uid(), e.sala_origem_id)
        OR public.user_has_sala_access(auth.uid(), e.sala_destino_id)
      )
  ));

CREATE OR REPLACE FUNCTION public.criar_solicitacao(_itens jsonb, _observacao text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_sala uuid;
  v_solic uuid;
  v_item jsonb;
  v_qtd integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  v_sala := public.get_user_sala(v_user);
  IF v_sala IS NULL THEN RAISE EXCEPTION 'selecione uma sala antes de criar a requisição'; END IF;
  IF NOT public.user_has_sala_access(v_user, v_sala) THEN RAISE EXCEPTION 'sala não autorizada'; END IF;

  INSERT INTO public.solicitacoes (usuario_id, sala_id, observacao, estoque_baixado)
  VALUES (v_user, v_sala, _observacao, false) RETURNING id INTO v_solic;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_itens) LOOP
    v_qtd := (v_item->>'quantidade')::integer;
    IF v_qtd <= 0 THEN RAISE EXCEPTION 'quantidade inválida'; END IF;
    INSERT INTO public.solicitacao_itens (solicitacao_id, produto_id, quantidade)
    VALUES (v_solic, (v_item->>'produto_id')::uuid, v_qtd);
  END LOOP;

  RETURN v_solic;
END;
$function$;

CREATE OR REPLACE FUNCTION public.criar_emprestimo(_sala_origem uuid, _itens jsonb, _observacao text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_sala_destino uuid;
  v_emp uuid;
  v_item jsonb;
  v_total integer := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  v_sala_destino := public.get_user_sala(v_user);
  IF v_sala_destino IS NULL THEN RAISE EXCEPTION 'selecione uma sala antes de criar o empréstimo'; END IF;
  IF NOT public.user_has_sala_access(v_user, v_sala_destino) THEN RAISE EXCEPTION 'sala solicitante não autorizada'; END IF;
  IF v_sala_destino = _sala_origem THEN RAISE EXCEPTION 'salas iguais'; END IF;

  INSERT INTO public.emprestimos (solicitante_id, sala_origem_id, sala_destino_id, observacao)
  VALUES (v_user, _sala_origem, v_sala_destino, _observacao) RETURNING id INTO v_emp;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_itens) LOOP
    INSERT INTO public.emprestimo_itens (emprestimo_id, produto_id, quantidade)
    VALUES (v_emp, (v_item->>'produto_id')::uuid, (v_item->>'quantidade')::integer);
    v_total := v_total + (v_item->>'quantidade')::int;
  END LOOP;

  PERFORM public.log_event('emprestimo.criado','Empréstimo solicitado','emprestimos', _sala_origem, 'emprestimo', v_emp,
    jsonb_build_object('sala_destino', v_sala_destino, 'total_unidades', v_total));
  RETURN v_emp;
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_consumo_interno(_sala uuid, _produto uuid, _quantidade integer, _motivo motivo_consumo, _observacao text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_sala uuid;
  v_saldo integer;
  v_cmp numeric;
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  IF _quantidade IS NULL OR _quantidade <= 0 THEN RAISE EXCEPTION 'quantidade inválida'; END IF;

  IF public.has_role(v_user,'master') THEN
    v_sala := _sala;
  ELSE
    v_sala := public.get_user_sala(v_user);
    IF v_sala IS NULL THEN RAISE EXCEPTION 'selecione uma sala antes de registrar consumo'; END IF;
    IF _sala IS NOT NULL AND _sala <> v_sala THEN RAISE EXCEPTION 'sala não autorizada'; END IF;
  END IF;

  IF v_sala IS NULL THEN RAISE EXCEPTION 'sala inválida'; END IF;
  IF NOT public.user_has_sala_access(v_user, v_sala) THEN RAISE EXCEPTION 'sala não autorizada'; END IF;

  SELECT custo_medio INTO v_cmp FROM public.estoque
    WHERE produto_id = _produto AND sala_id = v_sala;

  UPDATE public.estoque SET quantidade = quantidade - _quantidade
   WHERE produto_id = _produto AND sala_id = v_sala
   RETURNING quantidade INTO v_saldo;
  IF v_saldo IS NULL THEN RAISE EXCEPTION 'produto não encontrado no estoque da sala'; END IF;
  IF v_saldo < 0 THEN RAISE EXCEPTION 'estoque insuficiente'; END IF;

  INSERT INTO public.consumos_internos (sala_id, produto_id, usuario_id, quantidade, motivo, observacao)
  VALUES (v_sala, _produto, v_user, _quantidade, _motivo, _observacao)
  RETURNING id INTO v_id;

  INSERT INTO public.movimentacoes (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos, observacao, referencia_tipo, referencia_id, custo_unitario_aplicado, valor_financeiro)
  VALUES (_produto, v_sala, v_user, 'saida', -_quantidade, v_saldo, concat('Consumo interno: ', _motivo, coalesce(' — ' || _observacao, '')), 'consumo_interno', v_id, coalesce(v_cmp,0), coalesce(v_cmp,0) * _quantidade);

  RETURN v_id;
END;
$function$;