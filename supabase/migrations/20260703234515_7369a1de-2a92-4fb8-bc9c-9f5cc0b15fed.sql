
CREATE OR REPLACE FUNCTION public._migrar_global_para_sala(p_old uuid, p_sala uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  p_row RECORD;
  target_id uuid;
BEGIN
  SELECT * INTO p_row FROM public.produtos WHERE id = p_old;
  IF p_row.id IS NULL THEN RETURN; END IF;

  -- Existe um produto com mesmo nome nesta sala?
  SELECT id INTO target_id FROM public.produtos
    WHERE sala_id = p_sala AND lower(nome) = lower(p_row.nome)
    LIMIT 1;

  IF target_id IS NULL THEN
    -- Criar clone
    INSERT INTO public.produtos
      (nome, descricao, unidade, estoque_minimo, categoria_id, ativo, sala_id, custo_unitario)
    VALUES
      (p_row.nome, p_row.descricao, p_row.unidade, p_row.estoque_minimo,
       p_row.categoria_id, p_row.ativo, p_sala, p_row.custo_unitario)
    RETURNING id INTO target_id;

    -- Trigger seed_estoque_for_new_produto criou linha vazia (target_id, p_sala) — remover
    DELETE FROM public.estoque WHERE produto_id = target_id AND sala_id = p_sala;

    -- Duplicar histórico de custo apenas para clone novo
    INSERT INTO public.produto_custo_historico
      (produto_id, valor_anterior, valor_novo, alterado_por, alterado_por_nome, alterado_em)
    SELECT target_id, valor_anterior, valor_novo, alterado_por, alterado_por_nome, alterado_em
      FROM public.produto_custo_historico WHERE produto_id = p_old;
  END IF;

  -- Reapontar todas as referências para target_id (novo clone OU produto já existente na sala)
  -- estoque: se já há linha (target_id, p_sala) [merge], somamos e removemos a antiga
  IF EXISTS (SELECT 1 FROM public.estoque WHERE produto_id = target_id AND sala_id = p_sala)
     AND EXISTS (SELECT 1 FROM public.estoque WHERE produto_id = p_old AND sala_id = p_sala) THEN
    UPDATE public.estoque tgt
       SET quantidade = tgt.quantidade + src.quantidade,
           quantidade_valorizada = COALESCE(tgt.quantidade_valorizada,0) + COALESCE(src.quantidade_valorizada,0),
           quantidade_reservada = COALESCE(tgt.quantidade_reservada,0) + COALESCE(src.quantidade_reservada,0),
           valor_total = COALESCE(tgt.valor_total,0) + COALESCE(src.valor_total,0),
           updated_at = now()
      FROM (SELECT * FROM public.estoque WHERE produto_id = p_old AND sala_id = p_sala) src
     WHERE tgt.produto_id = target_id AND tgt.sala_id = p_sala;
    DELETE FROM public.estoque WHERE produto_id = p_old AND sala_id = p_sala;
  ELSE
    UPDATE public.estoque SET produto_id = target_id
      WHERE produto_id = p_old AND sala_id = p_sala;
  END IF;

  UPDATE public.movimentacoes SET produto_id = target_id
    WHERE produto_id = p_old AND sala_id = p_sala;

  UPDATE public.consumos_internos SET produto_id = target_id
    WHERE produto_id = p_old AND sala_id = p_sala;

  UPDATE public.emprestimo_itens ei SET produto_id = target_id
    FROM public.emprestimos e
    WHERE ei.emprestimo_id = e.id AND ei.produto_id = p_old AND e.sala_origem_id = p_sala;

  UPDATE public.solicitacao_itens si SET produto_id = target_id
    FROM public.solicitacoes s
    WHERE si.solicitacao_id = s.id AND si.produto_id = p_old AND s.sala_id = p_sala;

  -- Dividas: merge se conflitar em (devedora, credora, produto)
  UPDATE public.dividas tgt
     SET saldo = tgt.saldo + src.saldo,
         valor_financeiro = COALESCE(tgt.valor_financeiro,0) + COALESCE(src.valor_financeiro,0),
         updated_at = now()
    FROM public.dividas src
   WHERE tgt.sala_credora_id = p_sala
     AND tgt.produto_id = target_id
     AND src.sala_credora_id = p_sala
     AND src.produto_id = p_old
     AND src.sala_devedora_id = tgt.sala_devedora_id
     AND src.id <> tgt.id;
  DELETE FROM public.dividas d1
   WHERE d1.produto_id = p_old AND d1.sala_credora_id = p_sala
     AND EXISTS (SELECT 1 FROM public.dividas d2
                  WHERE d2.produto_id = target_id AND d2.sala_credora_id = p_sala
                    AND d2.sala_devedora_id = d1.sala_devedora_id);
  UPDATE public.dividas SET produto_id = target_id
    WHERE produto_id = p_old AND sala_credora_id = p_sala;

  UPDATE public.devolucao_itens di SET produto_id = target_id
    FROM public.emprestimo_itens ei2
    JOIN public.emprestimos e2 ON e2.id = ei2.emprestimo_id
    WHERE di.emprestimo_item_id = ei2.id
      AND di.produto_id = p_old AND e2.sala_origem_id = p_sala;
END;
$$;

DO $mig$
DECLARE
  p RECORD;
  s_id uuid;
  sala_list uuid[];
BEGIN
  FOR p IN SELECT id, nome FROM public.produtos WHERE sala_id IS NULL LOOP
    SELECT array_agg(DISTINCT sid) INTO sala_list FROM (
      SELECT sala_id AS sid FROM public.estoque
        WHERE produto_id = p.id
          AND (COALESCE(quantidade,0) > 0
               OR COALESCE(quantidade_reservada,0) > 0
               OR COALESCE(quantidade_valorizada,0) > 0
               OR COALESCE(valor_total,0) > 0
               OR COALESCE(custo_medio,0) > 0)
      UNION
      SELECT sala_id FROM public.movimentacoes WHERE produto_id = p.id
      UNION
      SELECT sala_id FROM public.consumos_internos WHERE produto_id = p.id
      UNION
      SELECT e.sala_origem_id FROM public.emprestimo_itens ei
        JOIN public.emprestimos e ON e.id = ei.emprestimo_id
        WHERE ei.produto_id = p.id
      UNION
      SELECT s.sala_id FROM public.solicitacao_itens si
        JOIN public.solicitacoes s ON s.id = si.solicitacao_id
        WHERE si.produto_id = p.id
      UNION
      SELECT sala_credora_id FROM public.dividas WHERE produto_id = p.id
    ) x WHERE sid IS NOT NULL;

    IF sala_list IS NULL OR cardinality(sala_list) = 0 THEN
      DELETE FROM public.estoque WHERE produto_id = p.id;
      DELETE FROM public.produto_custo_historico WHERE produto_id = p.id;
      DELETE FROM public.produtos WHERE id = p.id;
      CONTINUE;
    END IF;

    -- Sempre usa a rotina de merge (que lida com colisão de nome)
    FOREACH s_id IN ARRAY sala_list LOOP
      PERFORM public._migrar_global_para_sala(p.id, s_id);
    END LOOP;

    DELETE FROM public.estoque WHERE produto_id = p.id;
    DELETE FROM public.produto_custo_historico WHERE produto_id = p.id;
    DELETE FROM public.produtos WHERE id = p.id;
  END LOOP;
END $mig$;

DROP FUNCTION public._migrar_global_para_sala(uuid, uuid);

DO $chk$
DECLARE v_orf int;
BEGIN
  SELECT COUNT(*) INTO v_orf FROM public.produtos WHERE sala_id IS NULL;
  IF v_orf > 0 THEN
    RAISE EXCEPTION 'ainda existem % produtos sem sala após a migração', v_orf;
  END IF;
END $chk$;

ALTER TABLE public.produtos ALTER COLUMN sala_id SET NOT NULL;

CREATE OR REPLACE FUNCTION public.seed_estoque_for_new_produto()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.sala_id IS NULL THEN
    RAISE EXCEPTION 'produto deve estar vinculado a uma sala';
  END IF;
  INSERT INTO public.estoque (produto_id, sala_id, quantidade)
  VALUES (NEW.id, NEW.sala_id, 0)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.seed_estoque_for_new_sala()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN NEW;
END;
$$;
