
-- ============================================================
-- FASE 1 — Migração 2: Lógica do CMP + funções financeiras
-- ============================================================

-- Helper: recalcula valor_total da linha de estoque
CREATE OR REPLACE FUNCTION public._recalc_estoque_valor(_produto uuid, _sala uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.estoque
     SET valor_total = ROUND(quantidade * custo_medio, 2)
   WHERE produto_id = _produto AND sala_id = _sala;
$$;

-- 1) Registrar entrada de estoque (compra) com recálculo de CMP
CREATE OR REPLACE FUNCTION public.registrar_entrada_estoque(
  _produto uuid,
  _sala uuid,
  _quantidade integer,
  _valor_unitario numeric,
  _fornecedor text DEFAULT NULL,
  _numero_nf text DEFAULT NULL,
  _data_entrada timestamptz DEFAULT NULL,
  _observacao text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_nome text;
  v_qtd_atual integer;
  v_cmp_atual numeric;
  v_qtd_nova integer;
  v_cmp_novo numeric;
  v_entrada_id uuid;
  v_saldo_apos integer;
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN
    RAISE EXCEPTION 'apenas master pode registrar entradas';
  END IF;
  IF _quantidade IS NULL OR _quantidade <= 0 THEN RAISE EXCEPTION 'quantidade inválida'; END IF;
  IF _valor_unitario IS NULL OR _valor_unitario < 0 THEN RAISE EXCEPTION 'valor unitário inválido'; END IF;

  SELECT nome INTO v_nome FROM public.profiles WHERE id = v_user;

  -- garante linha em estoque
  INSERT INTO public.estoque (produto_id, sala_id, quantidade, custo_medio, valor_total)
  VALUES (_produto, _sala, 0, 0, 0)
  ON CONFLICT (produto_id, sala_id) DO NOTHING;

  SELECT quantidade, custo_medio INTO v_qtd_atual, v_cmp_atual
    FROM public.estoque WHERE produto_id = _produto AND sala_id = _sala
    FOR UPDATE;

  v_qtd_nova := v_qtd_atual + _quantidade;
  -- CMP só aumenta com saldo positivo. Se atual <= 0, CMP novo = valor da entrada.
  IF v_qtd_atual <= 0 THEN
    v_cmp_novo := _valor_unitario;
  ELSE
    v_cmp_novo := ROUND(
      ((v_qtd_atual::numeric * COALESCE(v_cmp_atual,0)) + (_quantidade::numeric * _valor_unitario))
      / v_qtd_nova::numeric, 4);
  END IF;

  UPDATE public.estoque
     SET quantidade = v_qtd_nova,
         custo_medio = v_cmp_novo,
         valor_total = ROUND(v_qtd_nova * v_cmp_novo, 2)
   WHERE produto_id = _produto AND sala_id = _sala;

  INSERT INTO public.entradas_estoque
    (produto_id, sala_id, quantidade, valor_unitario, fornecedor, numero_nf,
     data_entrada, observacao, usuario_responsavel, usuario_responsavel_nome)
  VALUES (_produto, _sala, _quantidade, _valor_unitario, NULLIF(trim(_fornecedor),''),
          NULLIF(trim(_numero_nf),''), COALESCE(_data_entrada, now()),
          NULLIF(trim(_observacao),''), v_user, v_nome)
  RETURNING id INTO v_entrada_id;

  v_saldo_apos := v_qtd_nova;
  INSERT INTO public.movimentacoes
    (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos,
     referencia_tipo, referencia_id, observacao,
     custo_unitario_aplicado, valor_financeiro)
  VALUES (_produto, _sala, v_user, 'entrada', _quantidade, v_saldo_apos,
          'entrada_estoque', v_entrada_id,
          COALESCE('Compra'||CASE WHEN _fornecedor IS NOT NULL THEN ' — '||_fornecedor ELSE '' END
                   ||CASE WHEN _numero_nf IS NOT NULL THEN ' (NF '||_numero_nf||')' ELSE '' END, 'Compra'),
          _valor_unitario,
          ROUND(_quantidade * _valor_unitario, 2));

  PERFORM public.log_event(
    'estoque.entrada','Entrada de estoque registrada','estoque', _sala, 'entrada_estoque', v_entrada_id,
    jsonb_build_object('produto_id', _produto, 'quantidade', _quantidade,
                       'valor_unitario', _valor_unitario, 'cmp_novo', v_cmp_novo,
                       'fornecedor', _fornecedor, 'numero_nf', _numero_nf));
  RETURN v_entrada_id;
END;
$$;

-- 2) decidir_solicitacao com valor financeiro
CREATE OR REPLACE FUNCTION public.decidir_solicitacao(_solic uuid, _aprovar boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_sala UUID;
  v_status public.solicitacao_status;
  v_baixado BOOLEAN;
  v_item RECORD;
  v_saldo INTEGER;
  v_cmp NUMERIC;
  v_total INT := 0;
  v_total_valor NUMERIC := 0;
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN RAISE EXCEPTION 'apenas master'; END IF;
  SELECT status, sala_id, estoque_baixado INTO v_status, v_sala, v_baixado
  FROM public.solicitacoes WHERE id = _solic;
  IF v_status IS NULL THEN RAISE EXCEPTION 'requisição não encontrada'; END IF;
  IF v_status <> 'pendente' THEN RAISE EXCEPTION 'requisição já decidida'; END IF;

  IF _aprovar THEN
    IF NOT v_baixado THEN
      FOR v_item IN SELECT produto_id, quantidade FROM public.solicitacao_itens WHERE solicitacao_id=_solic LOOP
        SELECT custo_medio INTO v_cmp FROM public.estoque
          WHERE produto_id = v_item.produto_id AND sala_id = v_sala;
        UPDATE public.estoque SET quantidade = quantidade - v_item.quantidade
        WHERE produto_id = v_item.produto_id AND sala_id = v_sala
        RETURNING quantidade INTO v_saldo;
        IF v_saldo IS NULL THEN RAISE EXCEPTION 'produto não existe no estoque da sala'; END IF;
        IF v_saldo < 0 THEN RAISE EXCEPTION 'estoque insuficiente para aprovar'; END IF;
        PERFORM public._recalc_estoque_valor(v_item.produto_id, v_sala);
        INSERT INTO public.movimentacoes
          (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos,
           referencia_tipo, referencia_id, custo_unitario_aplicado, valor_financeiro)
        VALUES (v_item.produto_id, v_sala, v_user, 'solicitacao', -v_item.quantidade, v_saldo,
                'solicitacao', _solic, COALESCE(v_cmp,0),
                ROUND(v_item.quantidade * COALESCE(v_cmp,0), 2));
        v_total := v_total + v_item.quantidade;
        v_total_valor := v_total_valor + ROUND(v_item.quantidade * COALESCE(v_cmp,0), 2);
      END LOOP;
    END IF;
    UPDATE public.solicitacoes SET status='aprovado', decidido_por=v_user, decidido_em=now(), estoque_baixado=true WHERE id=_solic;
    PERFORM public.log_event('requisicao.aprovada', 'Requisição aprovada', 'requisicoes', v_sala, 'solicitacao', _solic,
      jsonb_build_object('total_unidades', v_total, 'valor_financeiro', v_total_valor));
  ELSE
    IF v_baixado THEN
      FOR v_item IN SELECT produto_id, quantidade FROM public.solicitacao_itens WHERE solicitacao_id=_solic LOOP
        SELECT custo_medio INTO v_cmp FROM public.estoque
          WHERE produto_id = v_item.produto_id AND sala_id = v_sala;
        UPDATE public.estoque SET quantidade = quantidade + v_item.quantidade
        WHERE produto_id = v_item.produto_id AND sala_id = v_sala
        RETURNING quantidade INTO v_saldo;
        PERFORM public._recalc_estoque_valor(v_item.produto_id, v_sala);
        INSERT INTO public.movimentacoes
          (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos,
           referencia_tipo, referencia_id, observacao,
           custo_unitario_aplicado, valor_financeiro)
        VALUES (v_item.produto_id, v_sala, v_user, 'estorno', v_item.quantidade, v_saldo,
                'solicitacao', _solic, 'estorno por rejeição',
                COALESCE(v_cmp,0), ROUND(v_item.quantidade * COALESCE(v_cmp,0), 2));
      END LOOP;
    END IF;
    UPDATE public.solicitacoes SET status='rejeitado', decidido_por=v_user, decidido_em=now(), estoque_baixado=false WHERE id=_solic;
    PERFORM public.log_event('requisicao.rejeitada', 'Requisição rejeitada', 'requisicoes', v_sala, 'solicitacao', _solic, '{}'::jsonb);
  END IF;
END;
$$;

-- 3) decidir_emprestimo com valor financeiro + dívidas
CREATE OR REPLACE FUNCTION public.decidir_emprestimo(_emp uuid, _aprovar boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
BEGIN
  SELECT sala_origem_id, sala_destino_id, status INTO v_origem, v_destino, v_status
  FROM public.emprestimos WHERE id = _emp;
  IF v_status IS NULL THEN RAISE EXCEPTION 'empréstimo não encontrado'; END IF;
  IF v_status <> 'pendente' THEN RAISE EXCEPTION 'empréstimo já decidido'; END IF;

  v_user_sala := public.get_user_sala(v_user);
  IF NOT (public.has_role(v_user, 'admin') AND v_user_sala = v_origem) THEN
    RAISE EXCEPTION 'apenas o administrador da sala que empresta pode decidir';
  END IF;

  IF NOT _aprovar THEN
    UPDATE public.emprestimos SET status='rejeitado', decidido_por=v_user, decidido_em=now() WHERE id=_emp;
    PERFORM public.log_event('emprestimo.rejeitado','Empréstimo rejeitado','emprestimos', v_origem, 'emprestimo', _emp,
      jsonb_build_object('sala_destino', v_destino));
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

  UPDATE public.emprestimos SET status='aprovado', decidido_por=v_user, decidido_em=now() WHERE id=_emp;
  PERFORM public.log_event('emprestimo.aprovado','Empréstimo aprovado','emprestimos', v_origem, 'emprestimo', _emp,
    jsonb_build_object('sala_destino', v_destino, 'total_unidades', v_total, 'valor_financeiro', v_total_valor));
END;
$$;

-- 4) registrar_consumo_interno com valor financeiro
CREATE OR REPLACE FUNCTION public.registrar_consumo_interno(_sala uuid, _produto uuid, _quantidade integer, _motivo motivo_consumo, _observacao text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_saldo integer;
  v_cmp numeric;
  v_id uuid;
BEGIN
  IF NOT public.has_role(v_user,'master') THEN RAISE EXCEPTION 'apenas master'; END IF;
  IF _quantidade IS NULL OR _quantidade <= 0 THEN RAISE EXCEPTION 'quantidade inválida'; END IF;

  SELECT custo_medio INTO v_cmp FROM public.estoque
    WHERE produto_id = _produto AND sala_id = _sala;

  UPDATE public.estoque SET quantidade = quantidade - _quantidade
   WHERE produto_id = _produto AND sala_id = _sala
   RETURNING quantidade INTO v_saldo;
  IF v_saldo IS NULL THEN RAISE EXCEPTION 'produto não encontrado no estoque da sala'; END IF;
  IF v_saldo < 0 THEN RAISE EXCEPTION 'estoque insuficiente'; END IF;
  PERFORM public._recalc_estoque_valor(_produto, _sala);

  INSERT INTO public.consumos_internos (sala_id, produto_id, quantidade, motivo, observacao, usuario_id)
    VALUES (_sala, _produto, _quantidade, _motivo, _observacao, v_user)
    RETURNING id INTO v_id;

  INSERT INTO public.movimentacoes
    (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos,
     referencia_tipo, referencia_id, observacao,
     custo_unitario_aplicado, valor_financeiro)
  VALUES (_produto, _sala, v_user, 'consumo_interno', -_quantidade, v_saldo,
          'consumo_interno', v_id,
          'Consumo interno ('||_motivo::text||')'||COALESCE(' — '||_observacao,''),
          COALESCE(v_cmp,0), ROUND(_quantidade * COALESCE(v_cmp,0), 2));

  PERFORM public.log_event('consumo.interno','Consumo interno registrado','consumo', _sala, 'consumo_interno', v_id,
    jsonb_build_object('produto_id',_produto,'quantidade',_quantidade,'motivo',_motivo,
                       'valor_financeiro', ROUND(_quantidade * COALESCE(v_cmp,0), 2)));
  RETURN v_id;
END; $$;

-- 5) ajustar_estoque com CMP (ajuste positivo NÃO altera CMP por padrão; negativo só consome)
CREATE OR REPLACE FUNCTION public.ajustar_estoque(_produto uuid, _sala uuid, _quantidade integer, _observacao text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_atual INTEGER;
  v_cmp NUMERIC;
  v_diff INTEGER;
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN RAISE EXCEPTION 'apenas master'; END IF;
  SELECT quantidade, custo_medio INTO v_atual, v_cmp FROM public.estoque
    WHERE produto_id=_produto AND sala_id=_sala;
  IF v_atual IS NULL THEN
    INSERT INTO public.estoque (produto_id, sala_id, quantidade) VALUES (_produto, _sala, _quantidade);
    v_diff := _quantidade; v_atual := _quantidade; v_cmp := 0;
  ELSE
    v_diff := _quantidade - v_atual;
    UPDATE public.estoque SET quantidade=_quantidade WHERE produto_id=_produto AND sala_id=_sala;
    v_atual := _quantidade;
  END IF;
  PERFORM public._recalc_estoque_valor(_produto, _sala);
  INSERT INTO public.movimentacoes
    (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos, observacao,
     custo_unitario_aplicado, valor_financeiro)
  VALUES (_produto, _sala, v_user, 'ajuste', v_diff, v_atual, _observacao,
          COALESCE(v_cmp,0), ROUND(ABS(v_diff) * COALESCE(v_cmp,0), 2));
  PERFORM public.log_event('estoque.ajustado','Ajuste manual de estoque','estoque', _sala, 'produto', _produto,
    jsonb_build_object('diferenca', v_diff, 'saldo_final', v_atual, 'observacao', _observacao));
  RETURN v_atual;
END;
$$;

-- 6) registrar_devolucao preservando valor original
CREATE OR REPLACE FUNCTION public.registrar_devolucao(_emp uuid, _itens jsonb, _observacao text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_origem uuid; v_destino uuid;
  v_status public.emprestimo_status;
  v_dev uuid;
  v_item jsonb;
  v_emp_item RECORD;
  v_qtd integer;
  v_pendente integer;
  v_saldo_origem integer;
  v_valor_unit numeric;
  v_valor_total numeric;
  v_total int := 0;
  v_total_valor numeric := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  IF NOT public.has_role(v_user, 'master') THEN RAISE EXCEPTION 'apenas master pode registrar devoluções'; END IF;

  SELECT sala_origem_id, sala_destino_id, status INTO v_origem, v_destino, v_status
  FROM public.emprestimos WHERE id = _emp;
  IF v_status IS NULL THEN RAISE EXCEPTION 'empréstimo não encontrado'; END IF;
  IF v_status <> 'aprovado' THEN RAISE EXCEPTION 'só é possível devolver empréstimos aprovados'; END IF;

  INSERT INTO public.devolucoes (emprestimo_id, usuario_id, observacao)
  VALUES (_emp, v_user, _observacao) RETURNING id INTO v_dev;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_itens) LOOP
    v_qtd := (v_item->>'quantidade')::integer;
    IF v_qtd IS NULL OR v_qtd <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_emp_item FROM public.emprestimo_itens
    WHERE id = (v_item->>'emprestimo_item_id')::uuid AND emprestimo_id = _emp;
    IF v_emp_item.id IS NULL THEN RAISE EXCEPTION 'item do empréstimo não encontrado'; END IF;

    v_pendente := v_emp_item.quantidade - v_emp_item.quantidade_devolvida;
    IF v_qtd > v_pendente THEN RAISE EXCEPTION 'quantidade devolvida (%) maior que pendente (%)', v_qtd, v_pendente; END IF;

    v_valor_unit := COALESCE(v_emp_item.valor_unitario_aplicado, 0);
    v_valor_total := ROUND(v_qtd * v_valor_unit, 2);

    UPDATE public.estoque SET quantidade = quantidade + v_qtd
      WHERE produto_id = v_emp_item.produto_id AND sala_id = v_origem
      RETURNING quantidade INTO v_saldo_origem;
    IF v_saldo_origem IS NULL THEN
      INSERT INTO public.estoque (produto_id, sala_id, quantidade, custo_medio)
      VALUES (v_emp_item.produto_id, v_origem, v_qtd, v_valor_unit)
      RETURNING quantidade INTO v_saldo_origem;
    END IF;
    PERFORM public._recalc_estoque_valor(v_emp_item.produto_id, v_origem);

    INSERT INTO public.movimentacoes
      (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos,
       referencia_tipo, referencia_id, observacao,
       custo_unitario_aplicado, valor_financeiro)
    VALUES (v_emp_item.produto_id, v_origem, v_user, 'emprestimo_entrada', v_qtd, v_saldo_origem,
            'devolucao', v_dev, 'devolução recebida do devedor',
            v_valor_unit, v_valor_total);

    UPDATE public.emprestimo_itens SET quantidade_devolvida = quantidade_devolvida + v_qtd WHERE id = v_emp_item.id;

    UPDATE public.dividas
       SET saldo = GREATEST(saldo - v_qtd, 0),
           valor_financeiro = GREATEST(valor_financeiro - v_valor_total, 0),
           updated_at = now()
     WHERE sala_devedora_id = v_destino AND sala_credora_id = v_origem AND produto_id = v_emp_item.produto_id;
    DELETE FROM public.dividas
      WHERE sala_devedora_id = v_destino AND sala_credora_id = v_origem AND produto_id = v_emp_item.produto_id AND saldo <= 0;

    INSERT INTO public.devolucao_itens
      (devolucao_id, emprestimo_item_id, produto_id, quantidade,
       valor_unitario_aplicado, valor_total)
    VALUES (v_dev, v_emp_item.id, v_emp_item.produto_id, v_qtd, v_valor_unit, v_valor_total);

    v_total := v_total + v_qtd;
    v_total_valor := v_total_valor + v_valor_total;
  END LOOP;

  PERFORM public.log_event('devolucao.registrada','Devolução registrada','emprestimos', v_origem, 'devolucao', v_dev,
    jsonb_build_object('emprestimo_id', _emp, 'sala_destino', v_destino,
                       'total_unidades', v_total, 'valor_financeiro', v_total_valor));
  RETURN v_dev;
END;
$$;
