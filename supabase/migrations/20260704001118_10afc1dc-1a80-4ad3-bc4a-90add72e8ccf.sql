CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION public._norm_produto_nome(_nome text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(regexp_replace(unaccent(coalesce(trim(_nome), '')), '\s+', ' ', 'g'))
$$;

CREATE TABLE IF NOT EXISTS public.produtos_catalogo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  nome_normalizado text NOT NULL UNIQUE,
  descricao text,
  unidade_padrao text NOT NULL DEFAULT 'Unidade',
  categoria_id uuid REFERENCES public.categorias(id) ON DELETE SET NULL,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.produtos_catalogo TO authenticated;
GRANT ALL ON public.produtos_catalogo TO service_role;

ALTER TABLE public.produtos_catalogo ENABLE ROW LEVEL SECURITY;

CREATE POLICY "catalogo_select_authenticated" ON public.produtos_catalogo
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "catalogo_write_master" ON public.produtos_catalogo
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'master'))
  WITH CHECK (public.has_role(auth.uid(), 'master'));

CREATE TRIGGER trg_produtos_catalogo_updated
  BEFORE UPDATE ON public.produtos_catalogo
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public._tg_catalogo_normaliza()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.nome_normalizado := public._norm_produto_nome(NEW.nome);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_catalogo_normaliza
  BEFORE INSERT OR UPDATE OF nome ON public.produtos_catalogo
  FOR EACH ROW EXECUTE FUNCTION public._tg_catalogo_normaliza();

-- Seed do catálogo (FILTER dentro de array_agg)
INSERT INTO public.produtos_catalogo (nome, nome_normalizado, descricao, unidade_padrao, categoria_id)
SELECT
  (array_agg(nome ORDER BY freq DESC, nome))[1] AS nome,
  norm,
  (array_agg(descricao ORDER BY created_at DESC) FILTER (WHERE descricao IS NOT NULL))[1] AS descricao,
  COALESCE((array_agg(unidade ORDER BY freq_u DESC, unidade))[1], 'Unidade') AS unidade_padrao,
  (array_agg(categoria_id ORDER BY created_at DESC) FILTER (WHERE categoria_id IS NOT NULL))[1] AS categoria_id
FROM (
  SELECT
    public._norm_produto_nome(p.nome) AS norm,
    p.nome, p.descricao, p.unidade, p.categoria_id, p.created_at,
    COUNT(*) OVER (PARTITION BY public._norm_produto_nome(p.nome), p.nome) AS freq,
    COUNT(*) OVER (PARTITION BY public._norm_produto_nome(p.nome), p.unidade) AS freq_u
  FROM public.produtos p
  WHERE public._norm_produto_nome(p.nome) <> ''
) src
GROUP BY norm
ON CONFLICT (nome_normalizado) DO NOTHING;

ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS catalogo_id uuid REFERENCES public.produtos_catalogo(id) ON DELETE RESTRICT;

UPDATE public.produtos p
   SET catalogo_id = c.id
  FROM public.produtos_catalogo c
 WHERE c.nome_normalizado = public._norm_produto_nome(p.nome)
   AND p.catalogo_id IS NULL;

-- Se sobrou alguém sem catálogo (nome vazio?), evitar quebrar migração
DELETE FROM public.produtos WHERE catalogo_id IS NULL AND public._norm_produto_nome(nome) = '';

ALTER TABLE public.produtos ALTER COLUMN catalogo_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_produtos_catalogo_sala
  ON public.produtos (catalogo_id, sala_id);
CREATE INDEX IF NOT EXISTS idx_produtos_catalogo_id ON public.produtos (catalogo_id);

CREATE OR REPLACE FUNCTION public._tg_produto_auto_catalogo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_norm text;
  v_cat  uuid;
BEGIN
  v_norm := public._norm_produto_nome(NEW.nome);
  IF v_norm = '' THEN RAISE EXCEPTION 'nome do produto obrigatório'; END IF;
  IF NEW.catalogo_id IS NULL THEN
    SELECT id INTO v_cat FROM public.produtos_catalogo WHERE nome_normalizado = v_norm;
    IF v_cat IS NULL THEN
      INSERT INTO public.produtos_catalogo (nome, nome_normalizado, descricao, unidade_padrao, categoria_id)
      VALUES (trim(NEW.nome), v_norm, NEW.descricao, COALESCE(NEW.unidade, 'Unidade'), NEW.categoria_id)
      RETURNING id INTO v_cat;
    END IF;
    NEW.catalogo_id := v_cat;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_produto_auto_catalogo ON public.produtos;
CREATE TRIGGER trg_produto_auto_catalogo
  BEFORE INSERT OR UPDATE OF nome, catalogo_id ON public.produtos
  FOR EACH ROW EXECUTE FUNCTION public._tg_produto_auto_catalogo();

CREATE OR REPLACE FUNCTION public._tg_catalogo_sync_produtos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.nome IS DISTINCT FROM OLD.nome THEN
    UPDATE public.produtos SET nome = NEW.nome WHERE catalogo_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_catalogo_sync_produtos
  AFTER UPDATE OF nome ON public.produtos_catalogo
  FOR EACH ROW EXECUTE FUNCTION public._tg_catalogo_sync_produtos();

-- RPC de disponibilidade
CREATE OR REPLACE FUNCTION public.catalogo_disponibilidade(
  _catalogo uuid,
  _quantidade integer DEFAULT 1,
  _excluir_sala uuid DEFAULT NULL
)
RETURNS TABLE (
  sala_id uuid, sala_nome text, produto_id uuid, unidade text,
  custo_unitario numeric, quantidade_disponivel integer,
  atende_pct integer, atende_total boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT
    s.id, s.nome, p.id, p.unidade,
    COALESCE(p.custo_unitario, 0),
    GREATEST(COALESCE(e.quantidade,0) - COALESCE(e.quantidade_reservada,0), 0)::int,
    CASE WHEN _quantidade <= 0 THEN 0 ELSE
      LEAST(100, FLOOR(
        (GREATEST(COALESCE(e.quantidade,0) - COALESCE(e.quantidade_reservada,0), 0)::numeric
         / NULLIF(_quantidade,0)) * 100)::int)
    END,
    (GREATEST(COALESCE(e.quantidade,0) - COALESCE(e.quantidade_reservada,0), 0) >= _quantidade)
  FROM public.produtos p
  JOIN public.salas s ON s.id = p.sala_id
  LEFT JOIN public.estoque e ON e.produto_id = p.id AND e.sala_id = p.sala_id
  WHERE p.catalogo_id = _catalogo
    AND p.ativo = true
    AND (_excluir_sala IS NULL OR p.sala_id <> _excluir_sala)
  ORDER BY 8 DESC, 7 DESC, s.nome ASC;
$$;

GRANT EXECUTE ON FUNCTION public.catalogo_disponibilidade(uuid, integer, uuid) TO authenticated;