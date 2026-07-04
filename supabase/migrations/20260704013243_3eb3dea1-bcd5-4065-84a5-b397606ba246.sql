
-- 1) Campo motivo nas avaliações
ALTER TABLE public.avaliacoes_patrimoniais
  ADD COLUMN IF NOT EXISTS motivo text;

-- 2) Histórico de alterações patrimoniais
CREATE TABLE IF NOT EXISTS public.avaliacoes_patrimoniais_historico (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  produto_id uuid NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  sala_id uuid NOT NULL REFERENCES public.salas(id) ON DELETE CASCADE,
  quantidade integer NOT NULL,
  valor_anterior numeric(12,4),
  valor_novo numeric(12,4) NOT NULL,
  tipo_anterior text,
  tipo_novo text NOT NULL,
  motivo text NOT NULL,
  responsavel_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  responsavel_nome text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.avaliacoes_patrimoniais_historico TO authenticated;
GRANT ALL ON public.avaliacoes_patrimoniais_historico TO service_role;

ALTER TABLE public.avaliacoes_patrimoniais_historico ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS avpat_hist_master_all ON public.avaliacoes_patrimoniais_historico;
CREATE POLICY avpat_hist_master_all ON public.avaliacoes_patrimoniais_historico
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'master'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'master'::app_role));

CREATE INDEX IF NOT EXISTS idx_avpat_hist_prod_sala
  ON public.avaliacoes_patrimoniais_historico(produto_id, sala_id, created_at DESC);

-- 3) Resumo atual da avaliação patrimonial de um produto/sala
CREATE OR REPLACE FUNCTION public.resumo_avaliacao_produto(_produto uuid, _sala uuid)
RETURNS TABLE(
  tem_avaliacao boolean,
  tipo text,
  quantidade_coberta bigint,
  valor_unitario numeric,
  valor_total numeric,
  ultima_atualizacao timestamptz,
  responsavel_nome text,
  motivo text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ativos AS (
    SELECT a.*
    FROM public.avaliacoes_patrimoniais a
    WHERE a.produto_id = _produto AND a.sala_id = _sala
      AND a.quantidade_restante > 0
  ),
  agg AS (
    SELECT
      COALESCE(SUM(quantidade_restante), 0)::bigint AS qtd,
      CASE
        WHEN COALESCE(SUM(quantidade_restante),0) = 0 THEN 0
        ELSE SUM(quantidade_restante * valor_unitario) / SUM(quantidade_restante)
      END::numeric AS vu,
      COALESCE(SUM(quantidade_restante * valor_unitario), 0)::numeric AS vt,
      MAX(updated_at) AS ult,
      bool_or(tipo = 'confirmado') AS tem_confirmado
    FROM ativos
  ),
  ult AS (
    SELECT a.tipo, a.motivo, a.updated_at, a.responsavel_id
    FROM ativos a
    ORDER BY a.updated_at DESC
    LIMIT 1
  )
  SELECT
    (agg.qtd > 0),
    CASE WHEN agg.qtd = 0 THEN NULL
         WHEN agg.tem_confirmado THEN 'confirmado'
         ELSE 'estimado' END,
    agg.qtd,
    agg.vu,
    agg.vt,
    agg.ult,
    (SELECT p.nome FROM public.profiles p WHERE p.id = (SELECT responsavel_id FROM ult)),
    (SELECT motivo FROM ult)
  FROM agg;
$$;

-- 4) Atualizar avaliação (substitui camadas ativas por uma nova)
CREATE OR REPLACE FUNCTION public.atualizar_avaliacao_patrimonial_produto(
  _produto uuid,
  _sala uuid,
  _valor_unitario numeric,
  _tipo text,
  _motivo text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_qtd_estoque integer;
  v_valor_anterior numeric;
  v_tipo_anterior text;
  v_nome text;
  v_new_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'master'::app_role) THEN
    RAISE EXCEPTION 'Apenas o perfil Master pode atualizar a avaliação patrimonial';
  END IF;
  IF _tipo NOT IN ('estimado','confirmado') THEN
    RAISE EXCEPTION 'Tipo inválido';
  END IF;
  IF _valor_unitario IS NULL OR _valor_unitario < 0 THEN
    RAISE EXCEPTION 'Valor unitário inválido';
  END IF;
  IF _motivo IS NULL OR btrim(_motivo) = '' THEN
    RAISE EXCEPTION 'Motivo é obrigatório';
  END IF;

  SELECT COALESCE(quantidade, 0) INTO v_qtd_estoque
  FROM public.estoque WHERE produto_id = _produto AND sala_id = _sala;
  v_qtd_estoque := COALESCE(v_qtd_estoque, 0);

  IF v_qtd_estoque <= 0 THEN
    RAISE EXCEPTION 'Estoque atual é zero — não há quantidade para avaliar';
  END IF;

  -- Snapshot da avaliação anterior (média ponderada das camadas ativas)
  SELECT
    CASE WHEN SUM(quantidade_restante) = 0 THEN NULL
         ELSE SUM(quantidade_restante * valor_unitario) / SUM(quantidade_restante) END,
    CASE WHEN bool_or(tipo = 'confirmado') THEN 'confirmado' ELSE 'estimado' END
  INTO v_valor_anterior, v_tipo_anterior
  FROM public.avaliacoes_patrimoniais
  WHERE produto_id = _produto AND sala_id = _sala AND quantidade_restante > 0;

  -- Zera camadas ativas anteriores (não apaga histórico da tabela)
  UPDATE public.avaliacoes_patrimoniais
     SET quantidade_restante = 0, updated_at = now()
   WHERE produto_id = _produto AND sala_id = _sala AND quantidade_restante > 0;

  -- Cria nova camada cobrindo toda a quantidade atual em estoque
  INSERT INTO public.avaliacoes_patrimoniais
    (produto_id, sala_id, quantidade_avaliada, quantidade_restante, valor_unitario, tipo, responsavel_id, observacao, motivo)
  VALUES
    (_produto, _sala, v_qtd_estoque, v_qtd_estoque, _valor_unitario, _tipo, auth.uid(), _motivo, _motivo)
  RETURNING id INTO v_new_id;

  SELECT nome INTO v_nome FROM public.profiles WHERE id = auth.uid();

  INSERT INTO public.avaliacoes_patrimoniais_historico
    (produto_id, sala_id, quantidade, valor_anterior, valor_novo, tipo_anterior, tipo_novo, motivo, responsavel_id, responsavel_nome)
  VALUES
    (_produto, _sala, v_qtd_estoque, v_valor_anterior, _valor_unitario, v_tipo_anterior, _tipo, _motivo, auth.uid(), v_nome);

  RETURN v_new_id;
END;
$$;

-- 5) Histórico completo por produto/sala
CREATE OR REPLACE FUNCTION public.listar_historico_avaliacao_produto(_produto uuid, _sala uuid)
RETURNS TABLE(
  id uuid,
  created_at timestamptz,
  quantidade integer,
  valor_anterior numeric,
  valor_novo numeric,
  tipo_anterior text,
  tipo_novo text,
  motivo text,
  responsavel_nome text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, created_at, quantidade, valor_anterior, valor_novo, tipo_anterior, tipo_novo, motivo,
         COALESCE(responsavel_nome, (SELECT nome FROM public.profiles WHERE id = responsavel_id))
  FROM public.avaliacoes_patrimoniais_historico
  WHERE produto_id = _produto AND sala_id = _sala
  ORDER BY created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.resumo_avaliacao_produto(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.atualizar_avaliacao_patrimonial_produto(uuid, uuid, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_historico_avaliacao_produto(uuid, uuid) TO authenticated;
