
-- =====================================================================
-- FASE 1: Helpers de auditoria
-- =====================================================================

CREATE OR REPLACE FUNCTION public._nome_sala(_sala uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT nome FROM public.salas WHERE id = _sala),
                  'sala ' || COALESCE(upper(left(_sala::text,8)),'?'));
$$;

CREATE OR REPLACE FUNCTION public._nome_produto(_produto uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT nome FROM public.produtos WHERE id = _produto),
                  'produto ' || COALESCE(upper(left(_produto::text,8)),'?'));
$$;

CREATE OR REPLACE FUNCTION public._ref_curta(_id uuid)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT '#' || upper(left(_id::text, 8));
$$;

CREATE OR REPLACE FUNCTION public._resumo_itens_emprestimo(_emp uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(string_agg(
           ei.quantidade || ' ' || COALESCE(p.unidade,'un') || ' de ' || p.nome,
           ', ' ORDER BY p.nome), 'sem itens')
    FROM public.emprestimo_itens ei
    JOIN public.produtos p ON p.id = ei.produto_id
   WHERE ei.emprestimo_id = _emp;
$$;

CREATE OR REPLACE FUNCTION public._json_itens_emprestimo(_emp uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'produto', p.nome, 'unidade', p.unidade,
           'quantidade', ei.quantidade,
           'devolvido', ei.quantidade_devolvida)
         ORDER BY p.nome), '[]'::jsonb)
    FROM public.emprestimo_itens ei
    JOIN public.produtos p ON p.id = ei.produto_id
   WHERE ei.emprestimo_id = _emp;
$$;

CREATE OR REPLACE FUNCTION public._resumo_itens_solicitacao(_solic uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(string_agg(
           si.quantidade || ' ' || COALESCE(p.unidade,'un') || ' de ' || p.nome,
           ', ' ORDER BY p.nome), 'sem itens')
    FROM public.solicitacao_itens si
    JOIN public.produtos p ON p.id = si.produto_id
   WHERE si.solicitacao_id = _solic;
$$;

CREATE OR REPLACE FUNCTION public._json_itens_solicitacao(_solic uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'produto', p.nome, 'unidade', p.unidade, 'quantidade', si.quantidade)
         ORDER BY p.nome), '[]'::jsonb)
    FROM public.solicitacao_itens si
    JOIN public.produtos p ON p.id = si.produto_id
   WHERE si.solicitacao_id = _solic;
$$;

-- =====================================================================
-- FASE 2: registrar_devolucao — edição cirúrgica no log
-- =====================================================================

CREATE OR REPLACE FUNCTION public.registrar_devolucao(_emp uuid, _itens jsonb, _observacao text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_itens_json jsonb := '[]'::jsonb;
  v_pendente_total integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  IF NOT public.has_role(v_user, 'master') THEN RAISE EXCEPTION 'apenas master pode registrar devoluções'; END IF;

  SELECT sala_origem_id, sala_destino_id, status INTO v_origem, v_destino, v_status
  FROM public.emprestimos WHERE id = _emp;
  IF v_status IS NULL THEN RAISE EXCEPTION 'empréstimo não encontrado'; END IF;
  IF NOT public.user_has_sala_access(v_user, v_origem) THEN RAISE EXCEPTION 'empréstimo de outra região'; END IF;
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

    INSERT INTO public.estoque (produto_id, sala_id, quantidade, custo_medio)
    VALUES (v_emp_item.produto_id, v_origem, 0, v_valor_unit)
    ON CONFLICT (produto_id, sala_id) DO NOTHING;

    INSERT INTO public.lotes (produto_id, sala_id, quantidade, validade, referencia_tipo, referencia_id)
    VALUES (v_emp_item.produto_id, v_origem, v_qtd, null, 'devolucao', v_dev);

    SELECT quantidade INTO v_saldo_origem FROM public.estoque
      WHERE produto_id = v_emp_item.produto_id AND sala_id = v_origem;

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
    v_itens_json := v_itens_json || jsonb_build_object(
        'produto', public._nome_produto(v_emp_item.produto_id),
        'quantidade', v_qtd,
        'pendente_antes', v_pendente);
  END LOOP;

  SELECT COALESCE(SUM(quantidade - quantidade_devolvida),0) INTO v_pendente_total
    FROM public.emprestimo_itens WHERE emprestimo_id = _emp;

  PERFORM public.log_event(
    'devolucao.registrada',
    'Devolução de ' || v_total || ' un. — empréstimo ' || public._ref_curta(_emp)
      || ' — ' || public._nome_sala(v_destino) || ' → ' || public._nome_sala(v_origem)
      || CASE WHEN v_pendente_total > 0
              THEN ' (restam ' || v_pendente_total || ' un. a devolver)'
              ELSE ' (empréstimo quitado)' END,
    'emprestimos', v_origem, 'devolucao', v_dev,
    jsonb_build_object(
      'emprestimo_id', _emp,
      'emprestimo_ref', public._ref_curta(_emp),
      'sala_origem_id', v_origem,   'sala_origem_nome', public._nome_sala(v_origem),
      'sala_destino_id', v_destino, 'sala_destino_nome', public._nome_sala(v_destino),
      'itens_devolvidos', v_itens_json,
      'total_unidades', v_total,
      'valor_financeiro', v_total_valor,
      'pendente_apos', v_pendente_total,
      'observacao', _observacao));
  RETURN v_dev;
END;
$function$;
