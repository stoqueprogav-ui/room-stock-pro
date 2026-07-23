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

  v_qtd_nova := COALESCE(v_qtd_atual,0) + _quantidade;
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
     SET quantidade = v_qtd_nova,
         quantidade_valorizada = v_qtd_val_nova,
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

  PERFORM public._sync_estoque_from_lotes(_produto, _sala);

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
    'estoque.entrada',
    'Entrada em ' || public._nome_sala(_sala) || ': ' || _quantidade || ' un. de '
      || public._nome_produto(_produto)
      || ' a R$ ' || to_char(_valor_unitario,'FM999G999D00') || '/un'
      || ' (total R$ ' || to_char(_quantidade * _valor_unitario,'FM999G999D00') || ')'
      || COALESCE(' — venc. ' || to_char(_validade,'DD/MM/YYYY'), '')
      || ' — novo saldo: ' || v_qtd_nova || ' un.',
    'estoque', _sala, 'produto', _produto,
    jsonb_build_object(
      'produto', public._nome_produto(_produto),
      'sala_nome', public._nome_sala(_sala),
      'quantidade', _quantidade,
      'valor_unitario', _valor_unitario,
      'valor_total', _quantidade * _valor_unitario,
      'validade', _validade,
      'saldo_antes', v_qtd_atual,
      'saldo_depois', v_qtd_nova,
      'cmp_antes', v_cmp_atual,
      'cmp_depois', v_cmp_novo,
      'entrada_id', v_entrada_id,
      'observacao', _observacao));
  RETURN v_entrada_id;
END;
$function$;