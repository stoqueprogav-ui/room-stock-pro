-- (1) Saída de estoque relativa
CREATE OR REPLACE FUNCTION public.registrar_saida_estoque(
  _produto uuid, _sala uuid, _quantidade integer,
  _motivo text DEFAULT NULL, _observacao text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_saldo integer;
  v_cmp numeric;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  IF NOT public.has_role(v_user, 'master') THEN
    RAISE EXCEPTION 'apenas master pode registrar saída de estoque';
  END IF;
  IF _quantidade IS NULL OR _quantidade <= 0 THEN RAISE EXCEPTION 'quantidade inválida'; END IF;
  SELECT custo_medio INTO v_cmp FROM public.estoque
    WHERE produto_id = _produto AND sala_id = _sala;
  UPDATE public.estoque SET quantidade = quantidade - _quantidade
   WHERE produto_id = _produto AND sala_id = _sala
   RETURNING quantidade INTO v_saldo;
  IF v_saldo IS NULL THEN RAISE EXCEPTION 'produto não encontrado no estoque da sala'; END IF;
  IF v_saldo < 0 THEN RAISE EXCEPTION 'estoque insuficiente'; END IF;
  PERFORM public._recalc_estoque_valor(_produto, _sala);
  INSERT INTO public.movimentacoes
    (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos, observacao,
     custo_unitario_aplicado, valor_financeiro)
  VALUES (_produto, _sala, v_user, 'saida', -_quantidade, v_saldo,
          concat('Saída', COALESCE(' · ' || _motivo, ''), COALESCE(' — ' || _observacao, '')),
          COALESCE(v_cmp,0), COALESCE(v_cmp,0) * _quantidade);
END;
$$;

-- (2) Consumo mensal
CREATE OR REPLACE FUNCTION public.consumo_mensal(
  _from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL,
  _sala uuid DEFAULT NULL, _categoria uuid DEFAULT NULL, _produto uuid DEFAULT NULL)
RETURNS TABLE(mes date, quantidade bigint, valor numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    date_trunc('month', m.created_at)::date AS mes,
    COALESCE(SUM(-m.quantidade),0)::bigint AS quantidade,
    COALESCE(SUM(
      CASE WHEN m.valor_financeiro IS NOT NULL AND m.valor_financeiro > 0
           THEN m.valor_financeiro
           ELSE (-m.quantidade) * COALESCE(p.custo_unitario,0)
      END
    ),0)::numeric AS valor
  FROM public.movimentacoes m
  JOIN public.produtos p ON p.id = m.produto_id
  WHERE m.quantidade < 0
    AND m.tipo IN ('consumo_interno','solicitacao','emprestimo_saida','ajuste')
    AND public.user_has_sala_access(auth.uid(), m.sala_id)
    AND (_from IS NULL OR m.created_at >= _from)
    AND (_to   IS NULL OR m.created_at <= _to)
    AND (_sala IS NULL OR m.sala_id = _sala)
    AND (_categoria IS NULL OR p.categoria_id = _categoria)
    AND (_produto IS NULL OR p.id = _produto)
  GROUP BY 1
  ORDER BY 1;
$$;

-- (3) set_user_role
CREATE OR REPLACE FUNCTION public.set_user_role(_user uuid, _role public.app_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'master') THEN
    RAISE EXCEPTION 'apenas master pode alterar cargos';
  END IF;
  IF _user IS NULL OR _role IS NULL THEN RAISE EXCEPTION 'parâmetros inválidos'; END IF;
  DELETE FROM public.user_roles WHERE user_id = _user;
  INSERT INTO public.user_roles (user_id, role) VALUES (_user, _role);
END;
$$;

-- (4a) criar_emprestimo
CREATE OR REPLACE FUNCTION public.criar_emprestimo(_sala_origem uuid, _itens jsonb, _observacao text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_sala_destino uuid;
  v_emp uuid;
  v_item jsonb;
  v_qtd int;
  v_disp int;
  v_nome text;
  v_total integer := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  v_sala_destino := public.get_user_sala(v_user);
  IF v_sala_destino IS NULL THEN RAISE EXCEPTION 'selecione uma sala antes de criar o empréstimo'; END IF;
  IF NOT public.user_has_sala_access(v_user, v_sala_destino) THEN RAISE EXCEPTION 'sala solicitante não autorizada'; END IF;
  IF v_sala_destino = _sala_origem THEN RAISE EXCEPTION 'salas iguais'; END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(_itens) LOOP
    v_qtd := (v_item->>'quantidade')::int;
    IF v_qtd IS NULL OR v_qtd <= 0 THEN RAISE EXCEPTION 'quantidade inválida'; END IF;
    SELECT GREATEST(COALESCE(quantidade,0) - COALESCE(quantidade_reservada,0), 0)
      INTO v_disp FROM public.estoque
     WHERE produto_id = (v_item->>'produto_id')::uuid AND sala_id = _sala_origem
     FOR UPDATE;
    IF v_disp IS NULL THEN v_disp := 0; END IF;
    IF v_disp < v_qtd THEN
      SELECT nome INTO v_nome FROM public.produtos WHERE id = (v_item->>'produto_id')::uuid;
      RAISE EXCEPTION 'Quantidade indisponível para "%". Disponível atualmente: % unidade(s).', COALESCE(v_nome,'produto'), v_disp;
    END IF;
  END LOOP;
  INSERT INTO public.emprestimos (solicitante_id, sala_origem_id, sala_destino_id, observacao)
  VALUES (v_user, _sala_origem, v_sala_destino, _observacao) RETURNING id INTO v_emp;
  FOR v_item IN SELECT * FROM jsonb_array_elements(_itens) LOOP
    v_qtd := (v_item->>'quantidade')::int;
    INSERT INTO public.emprestimo_itens (emprestimo_id, produto_id, quantidade)
    VALUES (v_emp, (v_item->>'produto_id')::uuid, v_qtd);
    v_total := v_total + v_qtd;
  END LOOP;
  PERFORM public.log_event('emprestimo.criado','Empréstimo solicitado (reserva criada)','emprestimos', _sala_origem, 'emprestimo', v_emp,
    jsonb_build_object('sala_destino', v_sala_destino, 'total_unidades', v_total));
  RETURN v_emp;
END;
$$;

-- (4b) editar_emprestimo
CREATE OR REPLACE FUNCTION public.editar_emprestimo(_emp uuid, _sala_origem uuid, _itens jsonb, _observacao text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_status public.emprestimo_status;
  v_solicitante uuid;
  v_destino uuid;
  v_origem_old uuid;
  v_user_sala uuid;
  v_item jsonb;
  v_qtd int;
  v_disp int;
  v_nome text;
  v_ativo boolean;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  SELECT status, solicitante_id, sala_destino_id, sala_origem_id
    INTO v_status, v_solicitante, v_destino, v_origem_old
    FROM public.emprestimos WHERE id = _emp FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'empréstimo não encontrado'; END IF;
  IF v_status <> 'pendente' THEN RAISE EXCEPTION 'apenas empréstimos pendentes podem ser editados'; END IF;
  v_user_sala := public.get_user_sala(v_user);
  IF NOT (
    public.has_role(v_user,'master')
    OR v_solicitante = v_user
    OR (v_user_sala IS NOT NULL AND v_user_sala = v_destino)
  ) THEN
    RAISE EXCEPTION 'Você não possui permissão para editar esta solicitação.';
  END IF;
  IF _sala_origem IS NULL THEN RAISE EXCEPTION 'sala de origem obrigatória'; END IF;
  IF _sala_origem = v_destino THEN RAISE EXCEPTION 'sala de origem e destino não podem ser iguais'; END IF;
  IF _itens IS NULL OR jsonb_array_length(_itens) = 0 THEN
    RAISE EXCEPTION 'informe ao menos um item';
  END IF;
  DELETE FROM public.emprestimo_itens WHERE emprestimo_id = _emp;
  UPDATE public.emprestimos SET sala_origem_id = _sala_origem, observacao = _observacao WHERE id = _emp;
  FOR v_item IN SELECT * FROM jsonb_array_elements(_itens) LOOP
    v_qtd := (v_item->>'quantidade')::int;
    IF v_qtd IS NULL OR v_qtd <= 0 THEN RAISE EXCEPTION 'quantidade inválida'; END IF;
    SELECT nome, ativo INTO v_nome, v_ativo FROM public.produtos WHERE id = (v_item->>'produto_id')::uuid;
    IF v_nome IS NULL THEN RAISE EXCEPTION 'produto inexistente'; END IF;
    IF COALESCE(v_ativo,false) = false THEN
      RAISE EXCEPTION 'Produto "%" está inativo e não pode ser solicitado.', v_nome;
    END IF;
    SELECT GREATEST(COALESCE(quantidade,0) - COALESCE(quantidade_reservada,0), 0)
      INTO v_disp FROM public.estoque
     WHERE produto_id = (v_item->>'produto_id')::uuid AND sala_id = _sala_origem
     FOR UPDATE;
    IF v_disp IS NULL THEN v_disp := 0; END IF;
    IF v_disp < v_qtd THEN
      RAISE EXCEPTION 'Quantidade indisponível para "%". Disponível atualmente: % unidade(s).', v_nome, v_disp;
    END IF;
    INSERT INTO public.emprestimo_itens (emprestimo_id, produto_id, quantidade)
    VALUES (_emp, (v_item->>'produto_id')::uuid, v_qtd);
  END LOOP;
  PERFORM public.log_event(
    'emprestimo.editado',
    'Solicitação de empréstimo editada',
    'emprestimos', v_destino, 'emprestimo', _emp,
    jsonb_build_object('sala_origem_old', v_origem_old, 'sala_origem_new', _sala_origem)
  );
END;
$$;

-- (5) decidir_emprestimo
CREATE OR REPLACE FUNCTION public.decidir_emprestimo(_emp uuid, _aprovar boolean, _motivo text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_origem UUID; v_destino UUID;
  v_status public.emprestimo_status;
  v_item RECORD;
  v_saldo_origem INTEGER;
  v_user_sala UUID;
  v_cmp NUMERIC;
  v_total INT := 0;
  v_total_valor NUMERIC := 0;
  v_motivo text := NULLIF(btrim(COALESCE(_motivo,'')), '');
BEGIN
  SELECT sala_origem_id, sala_destino_id, status INTO v_origem, v_destino, v_status
  FROM public.emprestimos WHERE id = _emp;
  IF v_status IS NULL THEN RAISE EXCEPTION 'empréstimo não encontrado'; END IF;
  IF v_status <> 'pendente' THEN RAISE EXCEPTION 'empréstimo já decidido'; END IF;
  v_user_sala := public.get_user_sala(v_user);
  IF NOT (
    (public.has_role(v_user, 'admin') AND v_user_sala = v_origem)
    OR public.has_role(v_user, 'master')
  ) THEN
    RAISE EXCEPTION 'apenas o administrador da sala que empresta (ou o master) pode decidir';
  END IF;
  IF NOT _aprovar THEN
    UPDATE public.emprestimos
       SET status='rejeitado', decidido_por=v_user, decidido_em=now(), motivo_decisao=v_motivo
     WHERE id=_emp;
    PERFORM public.log_event('emprestimo.rejeitado','Empréstimo rejeitado','emprestimos', v_origem, 'emprestimo', _emp,
      jsonb_build_object('sala_destino', v_destino, 'motivo', v_motivo));
    RETURN;
  END IF;
  FOR v_item IN SELECT id, produto_id, quantidade FROM public.emprestimo_itens WHERE emprestimo_id = _emp LOOP
    SELECT custo_medio INTO v_cmp FROM public.estoque
      WHERE produto_id = v_item.produto_id AND sala_id = v_origem;
    UPDATE public.estoque SET quantidade = quantidade - v_item.quantidade
    WHERE produto_id = v_item.produto_id AND sala_id = v_origem
    RETURNING quantidade INTO v_saldo_origem;
    IF v_saldo_origem IS NULL THEN RAISE EXCEPTION 'produto sem estoque registrado na origem'; END IF;
    IF v_saldo_origem < 0 THEN RAISE EXCEPTION 'estoque insuficiente na sala origem'; END IF;
    PERFORM public._recalc_estoque_valor(v_item.produto_id, v_origem);
    UPDATE public.emprestimo_itens
       SET valor_unitario_aplicado = COALESCE(v_cmp,0),
           valor_total = ROUND(v_item.quantidade * COALESCE(v_cmp,0), 2)
     WHERE id = v_item.id;
    INSERT INTO public.movimentacoes
      (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos,
       referencia_tipo, referencia_id, observacao,
       custo_unitario_aplicado, valor_financeiro)
    VALUES (v_item.produto_id, v_origem, v_user, 'emprestimo_saida', -v_item.quantidade, v_saldo_origem,
            'emprestimo', _emp, 'empréstimo concedido (saída temporária)',
            COALESCE(v_cmp,0), ROUND(v_item.quantidade * COALESCE(v_cmp,0), 2));
    INSERT INTO public.dividas (sala_devedora_id, sala_credora_id, produto_id, saldo, valor_financeiro)
    VALUES (v_destino, v_origem, v_item.produto_id, v_item.quantidade,
            ROUND(v_item.quantidade * COALESCE(v_cmp,0), 2))
    ON CONFLICT (sala_devedora_id, sala_credora_id, produto_id)
    DO UPDATE SET saldo = public.dividas.saldo + EXCLUDED.saldo,
                  valor_financeiro = public.dividas.valor_financeiro + EXCLUDED.valor_financeiro,
                  updated_at = now();
    v_total := v_total + v_item.quantidade;
    v_total_valor := v_total_valor + ROUND(v_item.quantidade * COALESCE(v_cmp,0), 2);
  END LOOP;
  UPDATE public.emprestimos
     SET status='aprovado', decidido_por=v_user, decidido_em=now(), motivo_decisao=v_motivo
   WHERE id=_emp;
  PERFORM public.log_event('emprestimo.aprovado','Empréstimo aprovado','emprestimos', v_origem, 'emprestimo', _emp,
    jsonb_build_object('sala_destino', v_destino, 'total_unidades', v_total, 'valor_financeiro', v_total_valor, 'motivo', v_motivo));
END;
$$;