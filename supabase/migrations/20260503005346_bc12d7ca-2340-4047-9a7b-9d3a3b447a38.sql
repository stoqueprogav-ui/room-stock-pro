
-- 1. quantidade_devolvida em emprestimo_itens
ALTER TABLE public.emprestimo_itens
  ADD COLUMN IF NOT EXISTS quantidade_devolvida integer NOT NULL DEFAULT 0;

-- 2. Tabelas de devolução
CREATE TABLE IF NOT EXISTS public.devolucoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  emprestimo_id uuid NOT NULL REFERENCES public.emprestimos(id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.devolucao_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  devolucao_id uuid NOT NULL REFERENCES public.devolucoes(id) ON DELETE CASCADE,
  emprestimo_item_id uuid NOT NULL REFERENCES public.emprestimo_itens(id),
  produto_id uuid NOT NULL,
  quantidade integer NOT NULL CHECK (quantidade > 0)
);

ALTER TABLE public.devolucoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devolucao_itens ENABLE ROW LEVEL SECURITY;

-- Visível a todos autenticados (faz parte do histórico transparente)
CREATE POLICY devolucoes_select_all ON public.devolucoes
  FOR SELECT TO authenticated USING (true);
CREATE POLICY devolucao_itens_select_all ON public.devolucao_itens
  FOR SELECT TO authenticated USING (true);

-- 3. Histórico de empréstimos visível a todos os autenticados
DROP POLICY IF EXISTS emp_select_master_or_envolvido ON public.emprestimos;
CREATE POLICY emp_select_all_authenticated ON public.emprestimos
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS emp_itens_select ON public.emprestimo_itens;
CREATE POLICY emp_itens_select_all ON public.emprestimo_itens
  FOR SELECT TO authenticated USING (true);

-- 4. RPC registrar_devolucao
CREATE OR REPLACE FUNCTION public.registrar_devolucao(_emp uuid, _itens jsonb, _observacao text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_user_sala uuid;
  v_origem uuid;
  v_destino uuid;
  v_status public.emprestimo_status;
  v_dev uuid;
  v_item jsonb;
  v_emp_item RECORD;
  v_qtd integer;
  v_pendente integer;
  v_saldo_destino integer;
  v_saldo_origem integer;
  v_total_pendente integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;

  SELECT sala_origem_id, sala_destino_id, status INTO v_origem, v_destino, v_status
  FROM public.emprestimos WHERE id = _emp;
  IF v_status IS NULL THEN RAISE EXCEPTION 'empréstimo não encontrado'; END IF;
  IF v_status <> 'aprovado' THEN RAISE EXCEPTION 'só é possível devolver empréstimos aprovados'; END IF;

  v_user_sala := public.get_user_sala(v_user);
  -- Permitido: master, ou usuário (admin/analista) da sala destino (que pegou emprestado)
  IF NOT (public.has_role(v_user, 'master') OR v_user_sala = v_destino) THEN
    RAISE EXCEPTION 'apenas a sala que recebeu o empréstimo pode registrar devolução';
  END IF;

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

    -- Sai do destino
    UPDATE public.estoque SET quantidade = quantidade - v_qtd
      WHERE produto_id = v_emp_item.produto_id AND sala_id = v_destino
      RETURNING quantidade INTO v_saldo_destino;
    IF v_saldo_destino IS NULL THEN RAISE EXCEPTION 'estoque destino não encontrado'; END IF;
    IF v_saldo_destino < 0 THEN RAISE EXCEPTION 'estoque insuficiente para devolver'; END IF;

    INSERT INTO public.movimentacoes (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos, referencia_tipo, referencia_id, observacao)
    VALUES (v_emp_item.produto_id, v_destino, v_user, 'emprestimo_saida', -v_qtd, v_saldo_destino, 'devolucao', v_dev, 'devolução ao credor');

    -- Entra na origem
    UPDATE public.estoque SET quantidade = quantidade + v_qtd
      WHERE produto_id = v_emp_item.produto_id AND sala_id = v_origem
      RETURNING quantidade INTO v_saldo_origem;
    IF v_saldo_origem IS NULL THEN
      INSERT INTO public.estoque (produto_id, sala_id, quantidade) VALUES (v_emp_item.produto_id, v_origem, v_qtd)
      RETURNING quantidade INTO v_saldo_origem;
    END IF;

    INSERT INTO public.movimentacoes (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos, referencia_tipo, referencia_id, observacao)
    VALUES (v_emp_item.produto_id, v_origem, v_user, 'emprestimo_entrada', v_qtd, v_saldo_origem, 'devolucao', v_dev, 'devolução recebida');

    -- Atualiza item
    UPDATE public.emprestimo_itens
       SET quantidade_devolvida = quantidade_devolvida + v_qtd
     WHERE id = v_emp_item.id;

    -- Baixa dívida automaticamente
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

    -- Registra item de devolução
    INSERT INTO public.devolucao_itens (devolucao_id, emprestimo_item_id, produto_id, quantidade)
    VALUES (v_dev, v_emp_item.id, v_emp_item.produto_id, v_qtd);
  END LOOP;

  -- Se 100% devolvido, arquiva
  SELECT COALESCE(SUM(quantidade - quantidade_devolvida), 0) INTO v_total_pendente
  FROM public.emprestimo_itens WHERE emprestimo_id = _emp;

  IF v_total_pendente <= 0 THEN
    UPDATE public.emprestimos SET status = 'arquivado' WHERE id = _emp;
  END IF;

  RETURN v_dev;
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_devolucao(uuid, jsonb, text) TO authenticated;
