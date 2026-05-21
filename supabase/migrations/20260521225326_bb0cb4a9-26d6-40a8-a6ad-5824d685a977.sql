
CREATE OR REPLACE FUNCTION public.decidir_emprestimo(_emp uuid, _aprovar boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_origem UUID;
  v_destino UUID;
  v_status public.emprestimo_status;
  v_item RECORD;
  v_saldo_origem INTEGER;
  v_user_sala UUID;
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
    RETURN;
  END IF;

  FOR v_item IN SELECT produto_id, quantidade FROM public.emprestimo_itens WHERE emprestimo_id = _emp LOOP
    -- Apenas baixa no credor (sala origem). Devedora NÃO recebe estoque.
    UPDATE public.estoque SET quantidade = quantidade - v_item.quantidade
    WHERE produto_id = v_item.produto_id AND sala_id = v_origem
    RETURNING quantidade INTO v_saldo_origem;
    IF v_saldo_origem IS NULL THEN RAISE EXCEPTION 'produto sem estoque registrado na origem'; END IF;
    IF v_saldo_origem < 0 THEN RAISE EXCEPTION 'estoque insuficiente na sala origem'; END IF;

    INSERT INTO public.movimentacoes (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos, referencia_tipo, referencia_id, observacao)
    VALUES (v_item.produto_id, v_origem, v_user, 'emprestimo_saida', -v_item.quantidade, v_saldo_origem, 'emprestimo', _emp, 'empréstimo concedido (saída temporária)');

    -- Registra dívida da sala devedora com a credora
    INSERT INTO public.dividas (sala_devedora_id, sala_credora_id, produto_id, saldo)
    VALUES (v_destino, v_origem, v_item.produto_id, v_item.quantidade)
    ON CONFLICT (sala_devedora_id, sala_credora_id, produto_id)
    DO UPDATE SET saldo = public.dividas.saldo + EXCLUDED.saldo, updated_at = now();
  END LOOP;

  UPDATE public.emprestimos SET status='aprovado', decidido_por=v_user, decidido_em=now() WHERE id=_emp;
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
  v_origem uuid;
  v_destino uuid;
  v_status public.emprestimo_status;
  v_dev uuid;
  v_item jsonb;
  v_emp_item RECORD;
  v_qtd integer;
  v_pendente integer;
  v_saldo_origem integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  IF NOT public.has_role(v_user, 'master') THEN
    RAISE EXCEPTION 'apenas master pode registrar devoluções';
  END IF;

  SELECT sala_origem_id, sala_destino_id, status INTO v_origem, v_destino, v_status
  FROM public.emprestimos WHERE id = _emp;
  IF v_status IS NULL THEN RAISE EXCEPTION 'empréstimo não encontrado'; END IF;
  IF v_status <> 'aprovado' THEN RAISE EXCEPTION 'só é possível devolver empréstimos aprovados'; END IF;

  INSERT INTO public.devolucoes (emprestimo_id, usuario_id, observacao)
  VALUES (_emp, v_user, _observacao) RETURNING id INTO v_dev;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_itens) LOOP
    v_qtd := (v_item->>'quantidade')::integer;
    IF v_qtd IS NULL OR v_qtd <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_emp_item
    FROM public.emprestimo_itens
    WHERE id = (v_item->>'emprestimo_item_id')::uuid AND emprestimo_id = _emp;

    IF v_emp_item.id IS NULL THEN RAISE EXCEPTION 'item do empréstimo não encontrado'; END IF;

    v_pendente := v_emp_item.quantidade - v_emp_item.quantidade_devolvida;
    IF v_qtd > v_pendente THEN
      RAISE EXCEPTION 'quantidade devolvida (%) maior que pendente (%)', v_qtd, v_pendente;
    END IF;

    -- Empréstimo nunca creditou estoque na devedora. Devolução apenas restitui à credora.
    UPDATE public.estoque SET quantidade = quantidade + v_qtd
      WHERE produto_id = v_emp_item.produto_id AND sala_id = v_origem
      RETURNING quantidade INTO v_saldo_origem;
    IF v_saldo_origem IS NULL THEN
      INSERT INTO public.estoque (produto_id, sala_id, quantidade) VALUES (v_emp_item.produto_id, v_origem, v_qtd)
      RETURNING quantidade INTO v_saldo_origem;
    END IF;

    INSERT INTO public.movimentacoes (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos, referencia_tipo, referencia_id, observacao)
    VALUES (v_emp_item.produto_id, v_origem, v_user, 'emprestimo_entrada', v_qtd, v_saldo_origem, 'devolucao', v_dev, 'devolução recebida do devedor');

    UPDATE public.emprestimo_itens
       SET quantidade_devolvida = quantidade_devolvida + v_qtd
     WHERE id = v_emp_item.id;

    UPDATE public.dividas
       SET saldo = GREATEST(saldo - v_qtd, 0), updated_at = now()
     WHERE sala_devedora_id = v_destino
       AND sala_credora_id = v_origem
       AND produto_id = v_emp_item.produto_id;
    DELETE FROM public.dividas
     WHERE sala_devedora_id = v_destino
       AND sala_credora_id = v_origem
       AND produto_id = v_emp_item.produto_id
       AND saldo <= 0;

    INSERT INTO public.devolucao_itens (devolucao_id, emprestimo_item_id, produto_id, quantidade)
    VALUES (v_dev, v_emp_item.id, v_emp_item.produto_id, v_qtd);
  END LOOP;

  RETURN v_dev;
END;
$function$;
