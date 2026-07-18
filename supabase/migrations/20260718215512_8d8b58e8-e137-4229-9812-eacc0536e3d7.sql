CREATE OR REPLACE FUNCTION public.editar_emprestimo(
  _emp uuid, _sala_origem uuid, _itens jsonb, _observacao text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_solicitante uuid;
  v_destino uuid;
  v_status public.emprestimo_status;
  v_item jsonb;
  v_qtd int;
  v_disp int;
  v_nome text;
  v_total int := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;

  SELECT solicitante_id, sala_destino_id, status
    INTO v_solicitante, v_destino, v_status
    FROM public.emprestimos WHERE id = _emp FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'empréstimo não encontrado'; END IF;
  IF v_status <> 'pendente' THEN RAISE EXCEPTION 'apenas empréstimos pendentes podem ser editados'; END IF;

  IF NOT (
        v_user = v_solicitante
     OR public.user_has_sala_access(v_user, v_destino)
     OR public.has_role(v_user, 'master')
  ) THEN
    RAISE EXCEPTION 'sem permissão para editar este empréstimo';
  END IF;

  IF _sala_origem IS NULL THEN RAISE EXCEPTION 'selecione a sala de origem'; END IF;
  IF _sala_origem = v_destino THEN RAISE EXCEPTION 'a sala de origem não pode ser a mesma da solicitante'; END IF;
  IF _itens IS NULL OR jsonb_array_length(_itens) = 0 THEN RAISE EXCEPTION 'informe ao menos um item'; END IF;

  DELETE FROM public.emprestimo_itens WHERE emprestimo_id = _emp;

  UPDATE public.emprestimos
     SET sala_origem_id = _sala_origem,
         observacao     = _observacao
   WHERE id = _emp;

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
      RAISE EXCEPTION 'Quantidade indisponível para "%". Disponível atualmente: % unidade(s).',
        COALESCE(v_nome,'produto'), v_disp;
    END IF;
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_itens) LOOP
    v_qtd := (v_item->>'quantidade')::int;
    INSERT INTO public.emprestimo_itens (emprestimo_id, produto_id, quantidade)
    VALUES (_emp, (v_item->>'produto_id')::uuid, v_qtd);
    v_total := v_total + v_qtd;
  END LOOP;

  PERFORM public.log_event(
    'emprestimo.editado','Empréstimo pendente editado','emprestimos',
    _sala_origem, 'emprestimo', _emp,
    jsonb_build_object('sala_destino', v_destino, 'total_unidades', v_total));
END;
$$;

CREATE OR REPLACE FUNCTION public.cancelar_emprestimo(_emp uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_solicitante uuid;
  v_origem uuid;
  v_destino uuid;
  v_status public.emprestimo_status;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;

  SELECT solicitante_id, sala_origem_id, sala_destino_id, status
    INTO v_solicitante, v_origem, v_destino, v_status
    FROM public.emprestimos WHERE id = _emp FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'empréstimo não encontrado'; END IF;
  IF v_status <> 'pendente' THEN RAISE EXCEPTION 'apenas empréstimos pendentes podem ser cancelados'; END IF;

  IF NOT (
        v_user = v_solicitante
     OR public.user_has_sala_access(v_user, v_destino)
     OR public.has_role(v_user, 'master')
  ) THEN
    RAISE EXCEPTION 'sem permissão para cancelar este empréstimo';
  END IF;

  UPDATE public.emprestimos
     SET status         = 'rejeitado',
         decidido_por   = v_user,
         decidido_em    = now(),
         motivo_decisao = 'Cancelado pelo solicitante'
   WHERE id = _emp;

  PERFORM public.log_event(
    'emprestimo.cancelado','Empréstimo cancelado pelo solicitante','emprestimos',
    v_origem, 'emprestimo', _emp,
    jsonb_build_object('sala_destino', v_destino));
END;
$$;