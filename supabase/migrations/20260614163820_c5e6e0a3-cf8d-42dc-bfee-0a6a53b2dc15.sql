CREATE OR REPLACE FUNCTION public.editar_emprestimo(_emp uuid, _sala_origem uuid, _itens jsonb, _observacao text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Apenas o criador, usuários da sala devedora (destino) ou master podem editar.
  -- A sala credora (origem) NUNCA pode editar — apenas aprovar/rejeitar.
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

  -- Libera reserva atual ANTES de validar (trigger no DELETE)
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
     WHERE produto_id = (v_item->>'produto_id')::uuid AND sala_id = _sala_origem;
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
$function$;