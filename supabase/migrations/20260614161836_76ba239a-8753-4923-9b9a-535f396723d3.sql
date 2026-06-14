-- 1) Coluna de reserva no estoque
ALTER TABLE public.estoque
  ADD COLUMN IF NOT EXISTS quantidade_reservada INTEGER NOT NULL DEFAULT 0;

-- 2) Backfill a partir de empréstimos pendentes
UPDATE public.estoque e
   SET quantidade_reservada = 0;

UPDATE public.estoque e
   SET quantidade_reservada = r.total
  FROM (
    SELECT em.sala_origem_id AS sala_id, ei.produto_id, SUM(ei.quantidade)::int AS total
      FROM public.emprestimos em
      JOIN public.emprestimo_itens ei ON ei.emprestimo_id = em.id
     WHERE em.status = 'pendente'
     GROUP BY em.sala_origem_id, ei.produto_id
  ) r
 WHERE e.sala_id = r.sala_id AND e.produto_id = r.produto_id;

-- 3) Helper: ajusta reservada com clamp em 0
CREATE OR REPLACE FUNCTION public._aplicar_reserva(_produto uuid, _sala uuid, _delta integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _produto IS NULL OR _sala IS NULL OR COALESCE(_delta,0) = 0 THEN RETURN; END IF;
  INSERT INTO public.estoque (produto_id, sala_id, quantidade, quantidade_reservada)
    VALUES (_produto, _sala, 0, GREATEST(_delta, 0))
  ON CONFLICT (produto_id, sala_id) DO UPDATE
    SET quantidade_reservada = GREATEST(public.estoque.quantidade_reservada + _delta, 0);
END;
$$;

-- 4) Trigger nos itens de empréstimo
CREATE OR REPLACE FUNCTION public._trg_emp_item_reserva()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status public.emprestimo_status;
  v_origem uuid;
  v_old_status public.emprestimo_status;
  v_old_origem uuid;
BEGIN
  IF TG_OP IN ('INSERT','UPDATE') THEN
    SELECT status, sala_origem_id INTO v_status, v_origem
      FROM public.emprestimos WHERE id = NEW.emprestimo_id;
  END IF;
  IF TG_OP IN ('UPDATE','DELETE') THEN
    SELECT status, sala_origem_id INTO v_old_status, v_old_origem
      FROM public.emprestimos WHERE id = OLD.emprestimo_id;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_status = 'pendente' THEN
      PERFORM public._aplicar_reserva(NEW.produto_id, v_origem, NEW.quantidade);
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF v_old_status = 'pendente' THEN
      PERFORM public._aplicar_reserva(OLD.produto_id, v_old_origem, -OLD.quantidade);
    END IF;
  ELSE -- UPDATE
    IF v_old_status = 'pendente' THEN
      PERFORM public._aplicar_reserva(OLD.produto_id, v_old_origem, -OLD.quantidade);
    END IF;
    IF v_status = 'pendente' THEN
      PERFORM public._aplicar_reserva(NEW.produto_id, v_origem, NEW.quantidade);
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_emp_item_reserva ON public.emprestimo_itens;
CREATE TRIGGER trg_emp_item_reserva
AFTER INSERT OR UPDATE OR DELETE ON public.emprestimo_itens
FOR EACH ROW EXECUTE FUNCTION public._trg_emp_item_reserva();

-- 5) Trigger na mudança de status do empréstimo
CREATE OR REPLACE FUNCTION public._trg_emp_status_reserva()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r RECORD;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;

  IF OLD.status = 'pendente' AND NEW.status <> 'pendente' THEN
    FOR r IN SELECT produto_id, quantidade FROM public.emprestimo_itens WHERE emprestimo_id = NEW.id LOOP
      PERFORM public._aplicar_reserva(r.produto_id, OLD.sala_origem_id, -r.quantidade);
    END LOOP;
  ELSIF OLD.status <> 'pendente' AND NEW.status = 'pendente' THEN
    FOR r IN SELECT produto_id, quantidade FROM public.emprestimo_itens WHERE emprestimo_id = NEW.id LOOP
      PERFORM public._aplicar_reserva(r.produto_id, NEW.sala_origem_id, r.quantidade);
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_emp_status_reserva ON public.emprestimos;
CREATE TRIGGER trg_emp_status_reserva
AFTER UPDATE OF status ON public.emprestimos
FOR EACH ROW EXECUTE FUNCTION public._trg_emp_status_reserva();

-- 6) Disponibilidade considerando reserva
CREATE OR REPLACE FUNCTION public.disponibilidade_produtos(_produto_ids uuid[])
RETURNS TABLE (sala_id uuid, sala_nome text, produto_id uuid, nivel text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_user_sala uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  v_user_sala := public.get_user_sala(v_user);

  RETURN QUERY
  SELECT s.id, s.nome, p.id,
    CASE
      WHEN GREATEST(COALESCE(e.quantidade,0) - COALESCE(e.quantidade_reservada,0), 0) <= 0 THEN 'vermelho'
      WHEN GREATEST(COALESCE(e.quantidade,0) - COALESCE(e.quantidade_reservada,0), 0) <= COALESCE(p.estoque_minimo,0) THEN 'amarelo'
      ELSE 'verde'
    END
  FROM public.salas s
  CROSS JOIN public.produtos p
  LEFT JOIN public.estoque e ON e.sala_id = s.id AND e.produto_id = p.id
  WHERE p.id = ANY(_produto_ids)
    AND p.ativo = true
    AND (v_user_sala IS NULL OR s.id <> v_user_sala)
    AND (p.sala_id IS NULL OR p.sala_id = s.id)
    AND COALESCE(e.ativo, true) = true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.disponibilidade_produtos(uuid[]) TO authenticated;

-- 7) criar_emprestimo com validação de disponibilidade
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

  -- Valida disponibilidade ANTES de criar
  FOR v_item IN SELECT * FROM jsonb_array_elements(_itens) LOOP
    v_qtd := (v_item->>'quantidade')::int;
    IF v_qtd IS NULL OR v_qtd <= 0 THEN RAISE EXCEPTION 'quantidade inválida'; END IF;
    SELECT GREATEST(COALESCE(quantidade,0) - COALESCE(quantidade_reservada,0), 0)
      INTO v_disp FROM public.estoque
     WHERE produto_id = (v_item->>'produto_id')::uuid AND sala_id = _sala_origem;
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

-- 8) editar_emprestimo: libera reserva antiga, valida nova, recria
CREATE OR REPLACE FUNCTION public.editar_emprestimo(_emp uuid, _sala_origem uuid, _itens jsonb, _observacao text DEFAULT NULL)
RETURNS void
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
  v_disp int;
  v_nome text;
  v_ativo boolean;
  v_total int := 0;
  v_old_itens jsonb;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;

  SELECT status, solicitante_id, sala_destino_id, sala_origem_id, observacao
    INTO v_status, v_solicitante, v_destino, v_origem_old, v_obs_old
    FROM public.emprestimos WHERE id = _emp FOR UPDATE;

  IF v_status IS NULL THEN RAISE EXCEPTION 'empréstimo não encontrado'; END IF;
  IF v_status <> 'pendente' THEN RAISE EXCEPTION 'apenas empréstimos pendentes podem ser editados'; END IF;
  IF NOT (v_solicitante = v_user OR public.has_role(v_user,'master')) THEN
    RAISE EXCEPTION 'sem permissão para editar esta solicitação';
  END IF;
  IF _sala_origem IS NULL THEN RAISE EXCEPTION 'sala de origem obrigatória'; END IF;
  IF _sala_origem = v_destino THEN RAISE EXCEPTION 'sala de origem e destino não podem ser iguais'; END IF;
  IF _itens IS NULL OR jsonb_array_length(_itens) = 0 THEN
    RAISE EXCEPTION 'informe ao menos um item';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('produto_id', produto_id, 'quantidade', quantidade)), '[]'::jsonb)
    INTO v_old_itens FROM public.emprestimo_itens WHERE emprestimo_id = _emp;

  -- Libera reserva atual ANTES de validar (trigger no DELETE)
  DELETE FROM public.emprestimo_itens WHERE emprestimo_id = _emp;

  -- Se mudou a sala de origem, atualiza para a nova antes de re-inserir
  UPDATE public.emprestimos SET sala_origem_id = _sala_origem, observacao = _observacao WHERE id = _emp;

  -- Valida e re-insere (trigger no INSERT reaplica reserva)
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
    v_total := v_total + v_qtd;
  END LOOP;

  PERFORM public.log_event('emprestimo.editado','Empréstimo editado (reserva atualizada)','emprestimos', _sala_origem, 'emprestimo', _emp,
    jsonb_build_object(
      'sala_origem_antiga', v_origem_old, 'sala_origem_nova', _sala_origem,
      'observacao_antiga', v_obs_old, 'observacao_nova', _observacao,
      'itens_anteriores', v_old_itens, 'itens_novos', _itens,
      'total_unidades', v_total
    ));
END;
$$;

-- 9) Resumo de reservas para Central Analítica
CREATE OR REPLACE FUNCTION public.reservas_resumo()
RETURNS TABLE (itens_reservados bigint, produtos_reservados bigint, salas_com_reserva bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(quantidade_reservada),0)::bigint,
    COUNT(DISTINCT produto_id) FILTER (WHERE quantidade_reservada > 0)::bigint,
    COUNT(DISTINCT sala_id) FILTER (WHERE quantidade_reservada > 0)::bigint
  FROM public.estoque
  WHERE quantidade_reservada > 0;
$$;

GRANT EXECUTE ON FUNCTION public.reservas_resumo() TO authenticated;