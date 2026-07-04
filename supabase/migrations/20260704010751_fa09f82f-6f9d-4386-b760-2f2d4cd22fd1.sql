
-- ========================================================
-- AVALIAÇÃO PATRIMONIAL DO ESTOQUE
-- ========================================================

-- 1) TABELA -----------------------------------------------
CREATE TABLE IF NOT EXISTS public.avaliacoes_patrimoniais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id uuid NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  sala_id uuid NOT NULL REFERENCES public.salas(id) ON DELETE CASCADE,
  quantidade_avaliada integer NOT NULL CHECK (quantidade_avaliada > 0),
  quantidade_restante integer NOT NULL,
  valor_unitario numeric(12,4) NOT NULL CHECK (valor_unitario >= 0),
  tipo text NOT NULL CHECK (tipo IN ('estimado','confirmado')),
  responsavel_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_avpat_produto_sala ON public.avaliacoes_patrimoniais(produto_id, sala_id);
CREATE INDEX IF NOT EXISTS idx_avpat_sala ON public.avaliacoes_patrimoniais(sala_id);
CREATE INDEX IF NOT EXISTS idx_avpat_peps ON public.avaliacoes_patrimoniais(produto_id, sala_id, created_at)
  WHERE quantidade_restante > 0;

-- 2) GRANTS -----------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.avaliacoes_patrimoniais TO authenticated;
GRANT ALL ON public.avaliacoes_patrimoniais TO service_role;

-- 3) RLS --------------------------------------------------
ALTER TABLE public.avaliacoes_patrimoniais ENABLE ROW LEVEL SECURITY;

CREATE POLICY "avpat_master_all" ON public.avaliacoes_patrimoniais
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'master'))
  WITH CHECK (public.has_role(auth.uid(),'master'));

-- Trigger updated_at
CREATE TRIGGER trg_avpat_updated BEFORE UPDATE ON public.avaliacoes_patrimoniais
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ========================================================
-- 4) RPC: criar avaliação individual
-- ========================================================
CREATE OR REPLACE FUNCTION public.criar_avaliacao_patrimonial(
  _produto uuid, _sala uuid, _quantidade integer,
  _valor_unitario numeric, _tipo text, _observacao text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_id uuid;
  v_nome_prod text;
  v_nome_sala text;
BEGIN
  IF NOT public.has_role(v_user,'master') THEN RAISE EXCEPTION 'apenas master pode criar avaliação patrimonial'; END IF;
  IF _quantidade IS NULL OR _quantidade <= 0 THEN RAISE EXCEPTION 'quantidade avaliada inválida'; END IF;
  IF _valor_unitario IS NULL OR _valor_unitario < 0 THEN RAISE EXCEPTION 'valor unitário inválido'; END IF;
  IF _tipo NOT IN ('estimado','confirmado') THEN RAISE EXCEPTION 'tipo inválido (use estimado ou confirmado)'; END IF;

  INSERT INTO public.avaliacoes_patrimoniais
    (produto_id, sala_id, quantidade_avaliada, quantidade_restante, valor_unitario, tipo, responsavel_id, observacao)
  VALUES (_produto, _sala, _quantidade, _quantidade, _valor_unitario, _tipo, v_user, _observacao)
  RETURNING id INTO v_id;

  SELECT nome INTO v_nome_prod FROM public.produtos WHERE id = _produto;
  SELECT nome INTO v_nome_sala FROM public.salas WHERE id = _sala;

  PERFORM public.log_event(
    'avaliacao_patrimonial.criada',
    'Avaliação patrimonial ('||_tipo||') registrada: '||COALESCE(v_nome_prod,'—')||' em '||COALESCE(v_nome_sala,'—'),
    'avaliacao_patrimonial', _sala, 'avaliacao_patrimonial', v_id,
    jsonb_build_object(
      'produto_id', _produto, 'produto_nome', v_nome_prod,
      'sala_nome', v_nome_sala,
      'quantidade', _quantidade, 'valor_unitario', _valor_unitario,
      'valor_total', ROUND(_quantidade * _valor_unitario, 2),
      'tipo', _tipo, 'observacao', _observacao
    )
  );

  RETURN v_id;
END;
$$;

-- ========================================================
-- 5) RPC: regularização em lote
-- ========================================================
CREATE OR REPLACE FUNCTION public.regularizar_avaliacoes_lote(_itens jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_item jsonb;
  v_cnt int := 0;
BEGIN
  IF NOT public.has_role(v_user,'master') THEN RAISE EXCEPTION 'apenas master'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_itens) LOOP
    PERFORM public.criar_avaliacao_patrimonial(
      (v_item->>'produto_id')::uuid,
      (v_item->>'sala_id')::uuid,
      (v_item->>'quantidade')::integer,
      (v_item->>'valor_unitario')::numeric,
      COALESCE(v_item->>'tipo','estimado'),
      COALESCE(v_item->>'observacao','Regularização em lote — implantação do módulo de custos')
    );
    v_cnt := v_cnt + 1;
  END LOOP;

  PERFORM public.log_event(
    'avaliacao_patrimonial.lote',
    'Regularização em lote executada ('||v_cnt||' avaliação(ões))',
    'avaliacao_patrimonial', NULL, NULL, NULL,
    jsonb_build_object('total_itens', v_cnt)
  );

  RETURN v_cnt;
END;
$$;

-- ========================================================
-- 6) RPC: consumo PEPS (interno)
-- ========================================================
CREATE OR REPLACE FUNCTION public._consumir_avaliacao_peps(
  _produto uuid, _sala uuid, _quantidade integer
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_falta integer := _quantidade;
  v_row RECORD;
  v_baixa integer;
BEGIN
  IF _quantidade IS NULL OR _quantidade <= 0 THEN RETURN 0; END IF;

  FOR v_row IN
    SELECT id, quantidade_restante
      FROM public.avaliacoes_patrimoniais
     WHERE produto_id = _produto AND sala_id = _sala AND quantidade_restante > 0
     ORDER BY created_at ASC, id ASC
     FOR UPDATE
  LOOP
    EXIT WHEN v_falta <= 0;
    v_baixa := LEAST(v_falta, v_row.quantidade_restante);
    UPDATE public.avaliacoes_patrimoniais
       SET quantidade_restante = quantidade_restante - v_baixa
     WHERE id = v_row.id;
    v_falta := v_falta - v_baixa;
  END LOOP;

  RETURN _quantidade - v_falta;
END;
$$;

-- ========================================================
-- 7) TRIGGER: consumir camada PEPS em saídas
-- ========================================================
CREATE OR REPLACE FUNCTION public._tg_avpat_consumo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Só processa saídas (quantidade negativa) que representam consumo real de estoque
  IF NEW.quantidade < 0 AND NEW.tipo IN ('saida','consumo_interno','solicitacao','emprestimo_saida','ajuste') THEN
    PERFORM public._consumir_avaliacao_peps(NEW.produto_id, NEW.sala_id, ABS(NEW.quantidade));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_avpat_consumo ON public.movimentacoes;
CREATE TRIGGER trg_avpat_consumo AFTER INSERT ON public.movimentacoes
  FOR EACH ROW EXECUTE FUNCTION public._tg_avpat_consumo();

-- ========================================================
-- 8) RPC: totais patrimoniais (KPIs)
-- ========================================================
CREATE OR REPLACE FUNCTION public.patrimonio_totais(_sala uuid DEFAULT NULL)
RETURNS TABLE(
  valor_confirmado numeric,
  valor_estimado numeric,
  valor_patrimonial numeric,
  valor_compras numeric,
  valor_total_estoque numeric,
  quantidade_avaliada bigint,
  quantidade_estoque bigint,
  produtos_confirmados bigint,
  produtos_estimados bigint,
  produtos_sem_avaliacao bigint,
  cobertura_pct numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'master') THEN RAISE EXCEPTION 'acesso restrito ao master'; END IF;

  RETURN QUERY
  WITH ap AS (
    SELECT produto_id, sala_id,
           SUM(CASE WHEN tipo='confirmado' THEN quantidade_restante * valor_unitario ELSE 0 END)::numeric AS val_conf,
           SUM(CASE WHEN tipo='estimado'   THEN quantidade_restante * valor_unitario ELSE 0 END)::numeric AS val_est,
           SUM(quantidade_restante)::bigint AS qtd
      FROM public.avaliacoes_patrimoniais
     WHERE (_sala IS NULL OR sala_id = _sala)
     GROUP BY produto_id, sala_id
  ),
  est AS (
    SELECT e.produto_id, e.sala_id, e.quantidade, e.valor_total
      FROM public.estoque e
     WHERE (_sala IS NULL OR e.sala_id = _sala)
  ),
  merged AS (
    SELECT
      COALESCE(e.produto_id, ap.produto_id) AS produto_id,
      COALESCE(e.sala_id, ap.sala_id) AS sala_id,
      COALESCE(e.quantidade,0) AS qtd_est,
      COALESCE(e.valor_total,0) AS val_compras,
      COALESCE(ap.val_conf,0) AS val_conf,
      COALESCE(ap.val_est,0) AS val_est,
      COALESCE(ap.qtd,0) AS qtd_ap
    FROM est e FULL OUTER JOIN ap ON ap.produto_id = e.produto_id AND ap.sala_id = e.sala_id
  ),
  agg AS (
    SELECT
      SUM(val_conf)::numeric AS v_conf,
      SUM(val_est)::numeric AS v_est,
      SUM(val_compras)::numeric AS v_comp,
      SUM(qtd_ap)::bigint AS q_ap,
      SUM(qtd_est)::bigint AS q_est,
      COUNT(*) FILTER (WHERE val_conf > 0)::bigint AS p_conf,
      COUNT(*) FILTER (WHERE val_est  > 0 AND val_conf = 0)::bigint AS p_est,
      COUNT(*) FILTER (WHERE qtd_est  > 0 AND val_conf = 0 AND val_est = 0)::bigint AS p_sem,
      COUNT(*) FILTER (WHERE qtd_est  > 0)::bigint AS p_com_estoque
    FROM merged
  )
  SELECT
    v_conf, v_est, v_conf + v_est,
    v_comp, v_conf + v_est + v_comp,
    q_ap, q_est,
    p_conf, p_est, p_sem,
    CASE WHEN p_com_estoque > 0
      THEN ROUND(((p_conf + p_est)::numeric / p_com_estoque::numeric) * 100, 1)
      ELSE 0 END
  FROM agg;
END;
$$;

-- ========================================================
-- 9) RPC: produtos sem avaliação (para regularização em lote)
-- ========================================================
CREATE OR REPLACE FUNCTION public.produtos_sem_avaliacao(_sala uuid DEFAULT NULL)
RETURNS TABLE(
  produto_id uuid,
  produto_nome text,
  categoria_nome text,
  sala_id uuid,
  sala_nome text,
  quantidade integer,
  custo_unitario_ref numeric,
  valor_total_atual numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'master') THEN RAISE EXCEPTION 'acesso restrito ao master'; END IF;
  RETURN QUERY
  SELECT p.id, p.nome, c.nome, s.id, s.nome,
         e.quantidade, COALESCE(p.custo_unitario,0),
         COALESCE(e.valor_total,0)
    FROM public.estoque e
    JOIN public.produtos p ON p.id = e.produto_id
    JOIN public.salas s ON s.id = e.sala_id
    LEFT JOIN public.categorias c ON c.id = p.categoria_id
   WHERE e.quantidade > 0
     AND COALESCE(p.ativo,true) = true
     AND (_sala IS NULL OR e.sala_id = _sala)
     AND NOT EXISTS (
       SELECT 1 FROM public.avaliacoes_patrimoniais ap
        WHERE ap.produto_id = p.id AND ap.sala_id = e.sala_id AND ap.quantidade_restante > 0
     )
   ORDER BY s.nome, p.nome;
END;
$$;

-- ========================================================
-- 10) RPC: resumo da avaliação por produto (badges + tela detalhe)
-- ========================================================
CREATE OR REPLACE FUNCTION public.avaliacao_produto_resumo(_produto uuid, _sala uuid)
RETURNS TABLE(
  tem_avaliacao boolean,
  tipo_predominante text,
  quantidade_avaliada bigint,
  valor_total numeric,
  ultima_avaliacao timestamptz,
  responsavel_nome text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT ap.*, pr.nome AS resp_nome
      FROM public.avaliacoes_patrimoniais ap
      LEFT JOIN public.profiles pr ON pr.id = ap.responsavel_id
     WHERE ap.produto_id = _produto AND ap.sala_id = _sala AND ap.quantidade_restante > 0
  ),
  ult AS (SELECT * FROM base ORDER BY created_at DESC LIMIT 1)
  SELECT
    EXISTS(SELECT 1 FROM base),
    (SELECT CASE WHEN SUM(CASE WHEN tipo='confirmado' THEN quantidade_restante*valor_unitario ELSE 0 END) >=
                       SUM(CASE WHEN tipo='estimado'   THEN quantidade_restante*valor_unitario ELSE 0 END)
                 THEN 'confirmado' ELSE 'estimado' END FROM base),
    (SELECT COALESCE(SUM(quantidade_restante),0)::bigint FROM base),
    (SELECT COALESCE(SUM(quantidade_restante * valor_unitario),0)::numeric FROM base),
    (SELECT created_at FROM ult),
    (SELECT resp_nome FROM ult);
END;
$$;

-- ========================================================
-- 11) RPC: listar todas as avaliações (para tela e auditoria)
-- ========================================================
CREATE OR REPLACE FUNCTION public.listar_avaliacoes_patrimoniais(_sala uuid DEFAULT NULL)
RETURNS TABLE(
  id uuid,
  produto_id uuid,
  produto_nome text,
  categoria_nome text,
  sala_id uuid,
  sala_nome text,
  quantidade_avaliada integer,
  quantidade_restante integer,
  valor_unitario numeric,
  valor_total numeric,
  tipo text,
  responsavel_id uuid,
  responsavel_nome text,
  observacao text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'master') THEN RAISE EXCEPTION 'acesso restrito ao master'; END IF;
  RETURN QUERY
  SELECT ap.id, ap.produto_id, p.nome, c.nome, ap.sala_id, s.nome,
         ap.quantidade_avaliada, ap.quantidade_restante,
         ap.valor_unitario, ROUND(ap.quantidade_avaliada * ap.valor_unitario, 2),
         ap.tipo, ap.responsavel_id, pr.nome, ap.observacao,
         ap.created_at, ap.updated_at
    FROM public.avaliacoes_patrimoniais ap
    JOIN public.produtos p ON p.id = ap.produto_id
    JOIN public.salas s ON s.id = ap.sala_id
    LEFT JOIN public.categorias c ON c.id = p.categoria_id
    LEFT JOIN public.profiles pr ON pr.id = ap.responsavel_id
   WHERE (_sala IS NULL OR ap.sala_id = _sala)
   ORDER BY ap.created_at DESC;
END;
$$;

-- ========================================================
-- 12) RPC: excluir avaliação (master, com auditoria)
-- ========================================================
CREATE OR REPLACE FUNCTION public.excluir_avaliacao_patrimonial(_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row public.avaliacoes_patrimoniais;
BEGIN
  IF NOT public.has_role(auth.uid(),'master') THEN RAISE EXCEPTION 'apenas master'; END IF;
  SELECT * INTO v_row FROM public.avaliacoes_patrimoniais WHERE id = _id;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'avaliação não encontrada'; END IF;
  DELETE FROM public.avaliacoes_patrimoniais WHERE id = _id;
  PERFORM public.log_event(
    'avaliacao_patrimonial.excluida',
    'Avaliação patrimonial excluída',
    'avaliacao_patrimonial', v_row.sala_id, 'avaliacao_patrimonial', _id,
    jsonb_build_object(
      'produto_id', v_row.produto_id,
      'quantidade', v_row.quantidade_avaliada,
      'valor_unitario', v_row.valor_unitario,
      'tipo', v_row.tipo
    )
  );
END;
$$;

-- ========================================================
-- 13) Incluir tabela no reset total (limpeza de ambiente de teste)
-- ========================================================
-- Nada aqui: reset_sistema_total limpa tudo dinamicamente via TRUNCATE do schema public.
-- Caso use lista explícita, o master pode revisar posteriormente.
