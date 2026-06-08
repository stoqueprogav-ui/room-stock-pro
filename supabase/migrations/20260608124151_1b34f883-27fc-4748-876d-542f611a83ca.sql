
-- RPC: Consumo Interno
CREATE OR REPLACE FUNCTION public.registrar_consumo_interno(
  _sala uuid, _produto uuid, _quantidade integer,
  _motivo public.motivo_consumo, _observacao text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_saldo integer;
  v_id uuid;
BEGIN
  IF NOT public.has_role(v_user,'master') THEN RAISE EXCEPTION 'apenas master'; END IF;
  IF _quantidade IS NULL OR _quantidade <= 0 THEN RAISE EXCEPTION 'quantidade inválida'; END IF;

  UPDATE public.estoque SET quantidade = quantidade - _quantidade
   WHERE produto_id = _produto AND sala_id = _sala
   RETURNING quantidade INTO v_saldo;
  IF v_saldo IS NULL THEN RAISE EXCEPTION 'produto não encontrado no estoque da sala'; END IF;
  IF v_saldo < 0 THEN RAISE EXCEPTION 'estoque insuficiente'; END IF;

  INSERT INTO public.consumos_internos (sala_id, produto_id, quantidade, motivo, observacao, usuario_id)
    VALUES (_sala, _produto, _quantidade, _motivo, _observacao, v_user)
    RETURNING id INTO v_id;

  INSERT INTO public.movimentacoes (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos, referencia_tipo, referencia_id, observacao)
    VALUES (_produto, _sala, v_user, 'consumo_interno', -_quantidade, v_saldo, 'consumo_interno', v_id,
            'Consumo interno ('||_motivo::text||')'||COALESCE(' — '||_observacao,''));

  PERFORM public.log_event('consumo.interno','Consumo interno registrado','consumo', _sala, 'consumo_interno', v_id,
    jsonb_build_object('produto_id',_produto,'quantidade',_quantidade,'motivo',_motivo,'observacao',_observacao));
  RETURN v_id;
END; $$;

REVOKE ALL ON FUNCTION public.registrar_consumo_interno(uuid,uuid,integer,public.motivo_consumo,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_consumo_interno(uuid,uuid,integer,public.motivo_consumo,text) TO authenticated;

-- RPC: gerar inventário (snapshot)
CREATE OR REPLACE FUNCTION public.gerar_inventario(
  _sala uuid DEFAULT NULL,
  _categoria uuid DEFAULT NULL,
  _produto uuid DEFAULT NULL,
  _observacao text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_id uuid;
  v_codigo text;
  v_seq int;
  v_total_itens int := 0;
  v_total_un int := 0;
BEGIN
  IF NOT public.has_role(v_user,'master') THEN RAISE EXCEPTION 'apenas master'; END IF;

  SELECT COUNT(*)+1 INTO v_seq FROM public.inventarios
   WHERE date_part('year', created_at) = date_part('year', now());
  v_codigo := 'INV-' || to_char(now(),'YYYY') || '-' || lpad(v_seq::text, 4, '0');

  INSERT INTO public.inventarios (codigo, sala_id, categoria_id, produto_id, criado_por, observacao)
    VALUES (v_codigo, _sala, _categoria, _produto, v_user, _observacao)
    RETURNING id INTO v_id;

  INSERT INTO public.inventario_itens
    (inventario_id, produto_id, sala_id, produto_nome, categoria_nome, sala_nome, unidade, quantidade)
  SELECT v_id, p.id, s.id, p.nome, c.nome, s.nome, p.unidade, COALESCE(e.quantidade,0)
    FROM public.estoque e
    JOIN public.produtos p ON p.id = e.produto_id
    JOIN public.salas s ON s.id = e.sala_id
    LEFT JOIN public.categorias c ON c.id = p.categoria_id
   WHERE p.ativo = true
     AND (_sala IS NULL OR e.sala_id = _sala)
     AND (_categoria IS NULL OR p.categoria_id = _categoria)
     AND (_produto IS NULL OR p.id = _produto);

  SELECT COUNT(*), COALESCE(SUM(quantidade),0) INTO v_total_itens, v_total_un
    FROM public.inventario_itens WHERE inventario_id = v_id;

  UPDATE public.inventarios SET total_itens = v_total_itens, total_unidades = v_total_un WHERE id = v_id;

  PERFORM public.log_event('inventario.gerado','Inventário '||v_codigo||' gerado','inventario', _sala, 'inventario', v_id,
    jsonb_build_object('total_itens',v_total_itens,'total_unidades',v_total_un));
  RETURN v_id;
END; $$;

REVOKE ALL ON FUNCTION public.gerar_inventario(uuid,uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gerar_inventario(uuid,uuid,uuid,text) TO authenticated;
