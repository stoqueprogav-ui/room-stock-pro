
CREATE OR REPLACE FUNCTION public.editar_emprestimo(
  _emp uuid,
  _sala_origem uuid,
  _itens jsonb,
  _observacao text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_status public.emprestimo_status;
  v_solicitante uuid;
  v_destino uuid;
  v_origem_old uuid;
  v_obs_old text;
  v_item jsonb;
  v_qtd int;
  v_total int := 0;
  v_old_itens jsonb;
  v_new_itens jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;

  SELECT status, solicitante_id, sala_destino_id, sala_origem_id, observacao
    INTO v_status, v_solicitante, v_destino, v_origem_old, v_obs_old
    FROM public.emprestimos WHERE id = _emp;

  IF v_status IS NULL THEN RAISE EXCEPTION 'empréstimo não encontrado'; END IF;
  IF v_status <> 'pendente' THEN
    RAISE EXCEPTION 'apenas empréstimos pendentes podem ser editados';
  END IF;

  -- Permissão: o solicitante ou um master
  IF NOT (v_solicitante = v_user OR public.has_role(v_user, 'master')) THEN
    RAISE EXCEPTION 'sem permissão para editar esta solicitação';
  END IF;

  IF _sala_origem IS NULL THEN RAISE EXCEPTION 'sala de origem obrigatória'; END IF;
  IF _sala_origem = v_destino THEN RAISE EXCEPTION 'sala de origem e destino não podem ser iguais'; END IF;
  IF _itens IS NULL OR jsonb_array_length(_itens) = 0 THEN
    RAISE EXCEPTION 'informe ao menos um item';
  END IF;

  -- Snapshot dos itens antigos para auditoria
  SELECT COALESCE(jsonb_agg(jsonb_build_object('produto_id', produto_id, 'quantidade', quantidade)), '[]'::jsonb)
    INTO v_old_itens
    FROM public.emprestimo_itens WHERE emprestimo_id = _emp;

  -- Substitui itens
  DELETE FROM public.emprestimo_itens WHERE emprestimo_id = _emp;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_itens) LOOP
    v_qtd := (v_item->>'quantidade')::int;
    IF v_qtd IS NULL OR v_qtd <= 0 THEN
      RAISE EXCEPTION 'quantidade inválida';
    END IF;
    INSERT INTO public.emprestimo_itens (emprestimo_id, produto_id, quantidade)
    VALUES (_emp, (v_item->>'produto_id')::uuid, v_qtd);
    v_total := v_total + v_qtd;
  END LOOP;

  -- Atualiza cabeçalho
  UPDATE public.emprestimos
     SET sala_origem_id = _sala_origem,
         observacao = _observacao
   WHERE id = _emp;

  v_new_itens := _itens;

  PERFORM public.log_event(
    'emprestimo.editado',
    'Empréstimo editado pelo solicitante',
    'emprestimos',
    _sala_origem,
    'emprestimo',
    _emp,
    jsonb_build_object(
      'sala_origem_antiga', v_origem_old,
      'sala_origem_nova', _sala_origem,
      'observacao_antiga', v_obs_old,
      'observacao_nova', _observacao,
      'itens_anteriores', v_old_itens,
      'itens_novos', v_new_itens,
      'total_unidades', v_total
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.editar_emprestimo(uuid, uuid, jsonb, text) TO authenticated;
