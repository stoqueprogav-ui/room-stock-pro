-- ========== MIGRAÇÃO 1: relatórios isolados por acesso do chamador ==========
CREATE OR REPLACE FUNCTION public.relatorio_consumo_financeiro(
  _from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL,
  _sala uuid DEFAULT NULL, _categoria uuid DEFAULT NULL, _produto uuid DEFAULT NULL
)
RETURNS TABLE(produto_id uuid, produto_nome text, categoria_id uuid, categoria_nome text, sala_id uuid, sala_nome text, quantidade bigint, valor numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT p.id, p.nome, c.id, c.nome, s.id, s.nome,
         COALESCE(SUM(-m.quantidade),0)::bigint,
         COALESCE(SUM(m.valor_financeiro),0)::numeric
    FROM public.movimentacoes m
    JOIN public.produtos p ON p.id = m.produto_id
    LEFT JOIN public.categorias c ON c.id = p.categoria_id
    JOIN public.salas s ON s.id = m.sala_id
   WHERE m.quantidade < 0
     AND m.tipo IN ('consumo_interno','solicitacao','emprestimo_saida','ajuste')
     AND COALESCE(m.valor_financeiro,0) > 0
     AND public.user_has_sala_access(auth.uid(), m.sala_id)
     AND (_from IS NULL OR m.created_at >= _from)
     AND (_to IS NULL OR m.created_at <= _to)
     AND (_sala IS NULL OR m.sala_id = _sala)
     AND (_categoria IS NULL OR p.categoria_id = _categoria)
     AND (_produto IS NULL OR p.id = _produto)
   GROUP BY p.id, p.nome, c.id, c.nome, s.id, s.nome;
$$;

CREATE OR REPLACE FUNCTION public.relatorio_top_produtos_financeiro(
  _from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL,
  _sala uuid DEFAULT NULL, _limit int DEFAULT 20
)
RETURNS TABLE(produto_id uuid, produto_nome text, quantidade bigint, valor numeric, participacao_pct numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH base AS (
    SELECT p.id AS produto_id, p.nome AS produto_nome,
           COALESCE(SUM(-m.quantidade),0)::bigint AS qtd,
           COALESCE(SUM(m.valor_financeiro),0)::numeric AS val
      FROM public.movimentacoes m
      JOIN public.produtos p ON p.id = m.produto_id
     WHERE m.quantidade < 0
       AND m.tipo IN ('consumo_interno','solicitacao','emprestimo_saida','ajuste')
       AND COALESCE(m.valor_financeiro,0) > 0
       AND public.user_has_sala_access(auth.uid(), m.sala_id)
       AND (_from IS NULL OR m.created_at >= _from)
       AND (_to IS NULL OR m.created_at <= _to)
       AND (_sala IS NULL OR m.sala_id = _sala)
     GROUP BY p.id, p.nome
  ), tot AS (SELECT COALESCE(SUM(val),0) AS total FROM base)
  SELECT b.produto_id, b.produto_nome, b.qtd, b.val,
         CASE WHEN tot.total > 0 THEN ROUND(b.val/tot.total*100,2) ELSE 0 END
    FROM base b CROSS JOIN tot
   ORDER BY b.val DESC
   LIMIT GREATEST(COALESCE(_limit,20),1);
$$;

CREATE OR REPLACE FUNCTION public.relatorio_categorias_financeiro(
  _from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL, _sala uuid DEFAULT NULL
)
RETURNS TABLE(categoria_id uuid, categoria_nome text, quantidade bigint, valor numeric, participacao_pct numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH base AS (
    SELECT c.id AS categoria_id, COALESCE(c.nome,'Sem categoria') AS categoria_nome,
           COALESCE(SUM(-m.quantidade),0)::bigint AS qtd,
           COALESCE(SUM(m.valor_financeiro),0)::numeric AS val
      FROM public.movimentacoes m
      JOIN public.produtos p ON p.id = m.produto_id
      LEFT JOIN public.categorias c ON c.id = p.categoria_id
     WHERE m.quantidade < 0
       AND m.tipo IN ('consumo_interno','solicitacao','emprestimo_saida','ajuste')
       AND COALESCE(m.valor_financeiro,0) > 0
       AND public.user_has_sala_access(auth.uid(), m.sala_id)
       AND (_from IS NULL OR m.created_at >= _from)
       AND (_to IS NULL OR m.created_at <= _to)
       AND (_sala IS NULL OR m.sala_id = _sala)
     GROUP BY c.id, c.nome
  ), tot AS (SELECT COALESCE(SUM(val),0) AS total FROM base)
  SELECT b.categoria_id, b.categoria_nome, b.qtd, b.val,
         CASE WHEN tot.total > 0 THEN ROUND(b.val/tot.total*100,2) ELSE 0 END
    FROM base b CROSS JOIN tot ORDER BY b.val DESC;
$$;

CREATE OR REPLACE FUNCTION public.curva_abc(
  _from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL, _sala uuid DEFAULT NULL
)
RETURNS TABLE(produto_id uuid, produto_nome text, valor numeric, participacao_pct numeric, acumulado_pct numeric, classe text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH base AS (
    SELECT p.id AS produto_id, p.nome AS produto_nome,
           COALESCE(SUM(m.valor_financeiro),0)::numeric AS val
      FROM public.movimentacoes m
      JOIN public.produtos p ON p.id = m.produto_id
     WHERE m.quantidade < 0
       AND m.tipo IN ('consumo_interno','solicitacao','emprestimo_saida','ajuste')
       AND COALESCE(m.valor_financeiro,0) > 0
       AND public.user_has_sala_access(auth.uid(), m.sala_id)
       AND (_from IS NULL OR m.created_at >= _from)
       AND (_to IS NULL OR m.created_at <= _to)
       AND (_sala IS NULL OR m.sala_id = _sala)
     GROUP BY p.id, p.nome
     HAVING COALESCE(SUM(m.valor_financeiro),0) > 0
  ), tot AS (SELECT COALESCE(SUM(val),0) AS total FROM base),
  ord AS (
    SELECT b.*,
           CASE WHEN tot.total>0 THEN ROUND(b.val/tot.total*100,2) ELSE 0 END AS pct,
           SUM(b.val) OVER (ORDER BY b.val DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS acc,
           tot.total AS total
      FROM base b CROSS JOIN tot
  )
  SELECT produto_id, produto_nome, val, pct,
         CASE WHEN total>0 THEN ROUND(acc/total*100,2) ELSE 0 END,
         CASE
           WHEN total > 0 AND acc/total*100 <= 80 THEN 'A'
           WHEN total > 0 AND acc/total*100 <= 95 THEN 'B'
           ELSE 'C'
         END
    FROM ord
   ORDER BY val DESC;
$$;

CREATE OR REPLACE FUNCTION public.evolucao_mensal_financeira(_meses int DEFAULT 12)
RETURNS TABLE(mes date, valor_compras numeric, valor_consumido numeric, quantidade_consumida bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH meses AS (
    SELECT (date_trunc('month', now())::date - (g || ' months')::interval)::date AS mes
      FROM generate_series(0, GREATEST(_meses,1)-1) g
  ),
  compras AS (
    SELECT date_trunc('month', data_entrada)::date AS mes,
           COALESCE(SUM(valor_total),0)::numeric AS val
      FROM public.entradas_estoque
     WHERE COALESCE(valor_total,0) > 0
       AND public.user_has_sala_access(auth.uid(), sala_id)
     GROUP BY 1
  ),
  consumo AS (
    SELECT date_trunc('month', created_at)::date AS mes,
           COALESCE(SUM(valor_financeiro),0)::numeric AS val,
           COALESCE(SUM(-quantidade),0)::bigint AS qtd
      FROM public.movimentacoes
     WHERE quantidade < 0
       AND tipo IN ('consumo_interno','solicitacao','emprestimo_saida','ajuste')
       AND COALESCE(valor_financeiro,0) > 0
       AND public.user_has_sala_access(auth.uid(), sala_id)
     GROUP BY 1
  )
  SELECT m.mes,
         COALESCE(c.val,0), COALESCE(k.val,0), COALESCE(k.qtd,0)
    FROM meses m
    LEFT JOIN compras c ON c.mes = m.mes
    LEFT JOIN consumo k ON k.mes = m.mes
   ORDER BY m.mes;
$$;

CREATE OR REPLACE FUNCTION public.patrimonio_global()
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(SUM(valor_total),0)::numeric
    FROM public.estoque
   WHERE public.user_has_sala_access(auth.uid(), sala_id);
$$;

CREATE OR REPLACE FUNCTION public.reservas_resumo()
RETURNS TABLE (itens_reservados bigint, produtos_reservados bigint, salas_com_reserva bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(quantidade_reservada),0)::bigint,
    COUNT(DISTINCT produto_id) FILTER (WHERE quantidade_reservada > 0)::bigint,
    COUNT(DISTINCT sala_id) FILTER (WHERE quantidade_reservada > 0)::bigint
  FROM public.estoque
  WHERE quantidade_reservada > 0
    AND public.user_has_sala_access(auth.uid(), sala_id);
$$;

-- ========== MIGRAÇÃO 2: escritas checam acesso à sala ==========

CREATE OR REPLACE FUNCTION public.registrar_saida_estoque(_produto uuid, _sala uuid, _quantidade integer, _motivo text DEFAULT NULL::text, _observacao text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_saldo_atual integer;
  v_saldo integer;
  v_cmp numeric;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  IF NOT public.has_role(v_user, 'master') THEN RAISE EXCEPTION 'apenas master pode registrar saída de estoque'; END IF;
  IF NOT public.user_has_sala_access(v_user, _sala) THEN RAISE EXCEPTION 'sala não autorizada'; END IF;
  IF _quantidade IS NULL OR _quantidade <= 0 THEN RAISE EXCEPTION 'quantidade inválida'; END IF;

  SELECT quantidade, custo_medio INTO v_saldo_atual, v_cmp
    FROM public.estoque WHERE produto_id = _produto AND sala_id = _sala FOR UPDATE;
  IF v_saldo_atual IS NULL THEN RAISE EXCEPTION 'produto não encontrado no estoque da sala'; END IF;
  IF v_saldo_atual < _quantidade THEN RAISE EXCEPTION 'estoque insuficiente'; END IF;

  PERFORM public.baixar_lotes_fefo(_produto, _sala, _quantidade);

  SELECT quantidade INTO v_saldo FROM public.estoque WHERE produto_id = _produto AND sala_id = _sala;

  INSERT INTO public.movimentacoes
    (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos, observacao,
     custo_unitario_aplicado, valor_financeiro)
  VALUES (_produto, _sala, v_user, 'saida', -_quantidade, v_saldo,
          concat('Saída', COALESCE(' · ' || _motivo, ''), COALESCE(' — ' || _observacao, '')),
          COALESCE(v_cmp,0), COALESCE(v_cmp,0) * _quantidade);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ajustar_estoque(_produto uuid, _sala uuid, _quantidade integer, _observacao text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_atual INTEGER;
  v_cmp NUMERIC;
  v_diff INTEGER;
  v_custo_ref NUMERIC;
  v_final INTEGER;
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN RAISE EXCEPTION 'apenas master'; END IF;
  IF NOT public.user_has_sala_access(v_user, _sala) THEN RAISE EXCEPTION 'sala não autorizada'; END IF;

  SELECT COALESCE(custo_unitario, 0) INTO v_custo_ref FROM public.produtos WHERE id = _produto;

  SELECT quantidade, custo_medio INTO v_atual, v_cmp FROM public.estoque
    WHERE produto_id=_produto AND sala_id=_sala FOR UPDATE;

  IF v_atual IS NULL THEN
    INSERT INTO public.estoque (produto_id, sala_id, quantidade, custo_medio)
    VALUES (_produto, _sala, 0, COALESCE(v_custo_ref, 0));
    v_atual := 0;
    v_cmp := COALESCE(v_custo_ref, 0);
  ELSIF COALESCE(v_cmp,0) = 0 AND COALESCE(v_custo_ref,0) > 0 THEN
    UPDATE public.estoque SET custo_medio = v_custo_ref
      WHERE produto_id=_produto AND sala_id=_sala;
    v_cmp := v_custo_ref;
  END IF;

  v_diff := _quantidade - v_atual;

  IF v_diff > 0 THEN
    INSERT INTO public.lotes (produto_id, sala_id, quantidade, validade, referencia_tipo)
    VALUES (_produto, _sala, v_diff, null, 'ajuste');
  ELSIF v_diff < 0 THEN
    PERFORM public.baixar_lotes_fefo(_produto, _sala, -v_diff);
  END IF;

  SELECT quantidade INTO v_final FROM public.estoque WHERE produto_id=_produto AND sala_id=_sala;

  PERFORM public._recalc_estoque_valor(_produto, _sala);
  INSERT INTO public.movimentacoes
    (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos, observacao,
     custo_unitario_aplicado, valor_financeiro)
  VALUES (_produto, _sala, v_user, 'ajuste', v_diff, v_final, _observacao,
          COALESCE(v_cmp,0), ROUND(ABS(v_diff) * COALESCE(v_cmp,0), 2));
  PERFORM public.log_event('estoque.ajustado','Ajuste manual de estoque','estoque', _sala, 'produto', _produto,
    jsonb_build_object('diferenca', v_diff, 'saldo_final', v_final, 'observacao', _observacao));
  RETURN v_final;
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_entrada_estoque(_produto uuid, _sala uuid, _quantidade integer, _valor_unitario numeric, _fornecedor text DEFAULT NULL::text, _numero_nf text DEFAULT NULL::text, _data_entrada timestamp with time zone DEFAULT NULL::timestamp with time zone, _observacao text DEFAULT NULL::text, _validade date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_nome text;
  v_qtd_atual integer;
  v_cmp_atual numeric;
  v_qtd_val_atual integer;
  v_qtd_nova integer;
  v_qtd_val_nova integer;
  v_cmp_novo numeric;
  v_entrada_id uuid;
  v_valor_total_novo numeric;
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN RAISE EXCEPTION 'apenas master pode registrar entradas'; END IF;
  IF NOT public.user_has_sala_access(v_user, _sala) THEN RAISE EXCEPTION 'sala não autorizada'; END IF;
  IF _quantidade IS NULL OR _quantidade <= 0 THEN RAISE EXCEPTION 'quantidade inválida'; END IF;
  IF _valor_unitario IS NULL OR _valor_unitario < 0 THEN RAISE EXCEPTION 'valor unitário inválido'; END IF;

  SELECT nome INTO v_nome FROM public.profiles WHERE id = v_user;

  INSERT INTO public.estoque (produto_id, sala_id, quantidade, custo_medio, valor_total, quantidade_valorizada)
  VALUES (_produto, _sala, 0, 0, 0, 0)
  ON CONFLICT (produto_id, sala_id) DO NOTHING;

  SELECT quantidade, custo_medio, quantidade_valorizada
    INTO v_qtd_atual, v_cmp_atual, v_qtd_val_atual
    FROM public.estoque WHERE produto_id = _produto AND sala_id = _sala
    FOR UPDATE;

  v_qtd_nova := v_qtd_atual + _quantidade;
  v_qtd_val_nova := COALESCE(v_qtd_val_atual,0) + _quantidade;

  IF COALESCE(v_qtd_val_atual,0) <= 0 OR COALESCE(v_cmp_atual,0) <= 0 THEN
    v_cmp_novo := _valor_unitario;
  ELSE
    v_cmp_novo := ROUND(
      ((v_qtd_val_atual::numeric * v_cmp_atual) + (_quantidade::numeric * _valor_unitario))
      / v_qtd_val_nova::numeric, 4);
  END IF;

  v_valor_total_novo := ROUND(v_qtd_val_nova * v_cmp_novo, 2);

  UPDATE public.estoque
     SET quantidade_valorizada = v_qtd_val_nova,
         custo_medio = v_cmp_novo,
         valor_total = v_valor_total_novo
   WHERE produto_id = _produto AND sala_id = _sala;

  INSERT INTO public.entradas_estoque
    (produto_id, sala_id, quantidade, valor_unitario, fornecedor, numero_nf,
     data_entrada, observacao, usuario_responsavel, usuario_responsavel_nome)
  VALUES (_produto, _sala, _quantidade, _valor_unitario, NULLIF(trim(_fornecedor),''),
          NULLIF(trim(_numero_nf),''), COALESCE(_data_entrada, now()),
          NULLIF(trim(_observacao),''), v_user, v_nome)
  RETURNING id INTO v_entrada_id;

  INSERT INTO public.lotes (produto_id, sala_id, quantidade, validade, referencia_tipo, referencia_id)
  VALUES (_produto, _sala, _quantidade, _validade, 'entrada', v_entrada_id);

  INSERT INTO public.movimentacoes
    (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos,
     referencia_tipo, referencia_id, observacao,
     custo_unitario_aplicado, valor_financeiro)
  VALUES (_produto, _sala, v_user, 'entrada', _quantidade, v_qtd_nova,
          'entrada_estoque', v_entrada_id,
          COALESCE('Compra'||CASE WHEN _fornecedor IS NOT NULL THEN ' — '||_fornecedor ELSE '' END
                   ||CASE WHEN _numero_nf IS NOT NULL THEN ' (NF '||_numero_nf||')' ELSE '' END, 'Compra'),
          _valor_unitario,
          ROUND(_quantidade * _valor_unitario, 2));

  PERFORM public.log_event(
    'estoque.entrada','Entrada de estoque registrada','estoque', _sala, 'entrada_estoque', v_entrada_id,
    jsonb_build_object('produto_id', _produto, 'quantidade', _quantidade,
                       'valor_unitario', _valor_unitario, 'cmp_novo', v_cmp_novo,
                       'fornecedor', _fornecedor, 'numero_nf', _numero_nf,
                       'validade', _validade));
  RETURN v_entrada_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.decidir_solicitacao(_solic uuid, _aprovar boolean, _motivo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_sala UUID;
  v_status public.solicitacao_status;
  v_baixado BOOLEAN;
  v_item RECORD;
  v_saldo_atual INTEGER;
  v_saldo INTEGER;
  v_cmp NUMERIC;
  v_total INT := 0;
  v_total_valor NUMERIC := 0;
  v_motivo text := NULLIF(btrim(COALESCE(_motivo,'')), '');
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN RAISE EXCEPTION 'apenas master'; END IF;
  SELECT status, sala_id, estoque_baixado INTO v_status, v_sala, v_baixado
  FROM public.solicitacoes WHERE id = _solic;
  IF v_status IS NULL THEN RAISE EXCEPTION 'requisição não encontrada'; END IF;
  IF NOT public.user_has_sala_access(v_user, v_sala) THEN RAISE EXCEPTION 'requisição de outra região'; END IF;
  IF v_status <> 'pendente' THEN RAISE EXCEPTION 'requisição já decidida'; END IF;

  IF _aprovar THEN
    IF NOT v_baixado THEN
      FOR v_item IN SELECT produto_id, quantidade FROM public.solicitacao_itens WHERE solicitacao_id=_solic LOOP
        SELECT quantidade, custo_medio INTO v_saldo_atual, v_cmp FROM public.estoque
          WHERE produto_id = v_item.produto_id AND sala_id = v_sala FOR UPDATE;
        IF v_saldo_atual IS NULL THEN RAISE EXCEPTION 'produto não existe no estoque da sala'; END IF;
        IF v_saldo_atual < v_item.quantidade THEN RAISE EXCEPTION 'estoque insuficiente para aprovar'; END IF;
        PERFORM public.baixar_lotes_fefo(v_item.produto_id, v_sala, v_item.quantidade);
        SELECT quantidade INTO v_saldo FROM public.estoque WHERE produto_id = v_item.produto_id AND sala_id = v_sala;
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
    UPDATE public.solicitacoes
       SET status='aprovado', decidido_por=v_user, decidido_em=now(),
           estoque_baixado=true, motivo_decisao=v_motivo
     WHERE id=_solic;
    PERFORM public.log_event('requisicao.aprovada', 'Requisição aprovada', 'requisicoes', v_sala, 'solicitacao', _solic,
      jsonb_build_object('total_unidades', v_total, 'valor_financeiro', v_total_valor, 'motivo', v_motivo));
  ELSE
    IF v_baixado THEN
      FOR v_item IN SELECT produto_id, quantidade FROM public.solicitacao_itens WHERE solicitacao_id=_solic LOOP
        SELECT custo_medio INTO v_cmp FROM public.estoque
          WHERE produto_id = v_item.produto_id AND sala_id = v_sala;
        INSERT INTO public.estoque (produto_id, sala_id, quantidade, custo_medio)
        VALUES (v_item.produto_id, v_sala, 0, COALESCE(v_cmp,0))
        ON CONFLICT (produto_id, sala_id) DO NOTHING;
        INSERT INTO public.lotes (produto_id, sala_id, quantidade, validade, referencia_tipo, referencia_id)
        VALUES (v_item.produto_id, v_sala, v_item.quantidade, null, 'estorno_solicitacao', _solic);
        SELECT quantidade INTO v_saldo FROM public.estoque WHERE produto_id = v_item.produto_id AND sala_id = v_sala;
        INSERT INTO public.movimentacoes
          (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos,
           referencia_tipo, referencia_id, observacao,
           custo_unitario_aplicado, valor_financeiro)
        VALUES (v_item.produto_id, v_sala, v_user, 'estorno', v_item.quantidade, v_saldo,
                'solicitacao', _solic, 'estorno por rejeição',
                COALESCE(v_cmp,0), ROUND(v_item.quantidade * COALESCE(v_cmp,0), 2));
      END LOOP;
    END IF;
    UPDATE public.solicitacoes
       SET status='rejeitado', decidido_por=v_user, decidido_em=now(),
           estoque_baixado=false, motivo_decisao=v_motivo
     WHERE id=_solic;
    PERFORM public.log_event('requisicao.rejeitada', 'Requisição rejeitada', 'requisicoes', v_sala, 'solicitacao', _solic,
      jsonb_build_object('motivo', v_motivo));
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.decidir_emprestimo(_emp uuid, _aprovar boolean, _motivo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_origem UUID; v_destino UUID;
  v_status public.emprestimo_status;
  v_item RECORD;
  v_saldo_atual INTEGER;
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
  IF NOT public.user_has_sala_access(v_user, v_origem) THEN RAISE EXCEPTION 'empréstimo de outra região'; END IF;
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
    SELECT quantidade, custo_medio INTO v_saldo_atual, v_cmp FROM public.estoque
      WHERE produto_id = v_item.produto_id AND sala_id = v_origem FOR UPDATE;
    IF v_saldo_atual IS NULL THEN RAISE EXCEPTION 'produto sem estoque registrado na origem'; END IF;
    IF v_saldo_atual < v_item.quantidade THEN RAISE EXCEPTION 'estoque insuficiente na sala origem'; END IF;
    PERFORM public.baixar_lotes_fefo(v_item.produto_id, v_origem, v_item.quantidade);
    SELECT quantidade INTO v_saldo_origem FROM public.estoque WHERE produto_id = v_item.produto_id AND sala_id = v_origem;

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
$function$;

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
  END LOOP;

  PERFORM public.log_event('devolucao.registrada','Devolução registrada','emprestimos', v_origem, 'devolucao', v_dev,
    jsonb_build_object('emprestimo_id', _emp, 'sala_destino', v_destino,
                       'total_unidades', v_total, 'valor_financeiro', v_total_valor));
  RETURN v_dev;
END;
$function$;