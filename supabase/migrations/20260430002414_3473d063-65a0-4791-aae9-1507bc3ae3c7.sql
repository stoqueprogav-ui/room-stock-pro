-- 1) Novos campos em produtos
ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sala_id uuid NULL REFERENCES public.salas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_produtos_sala_id ON public.produtos(sala_id);
CREATE INDEX IF NOT EXISTS idx_produtos_ativo   ON public.produtos(ativo);

-- 2) Trigger seed estoque on new produto: respeita escopo (global vs sala)
CREATE OR REPLACE FUNCTION public.seed_estoque_for_new_produto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.sala_id IS NULL THEN
    -- Produto global: cria registros zerados para TODAS as salas
    INSERT INTO public.estoque (produto_id, sala_id, quantidade)
    SELECT NEW.id, s.id, 0 FROM public.salas s
    ON CONFLICT DO NOTHING;
  ELSE
    -- Produto restrito a uma sala
    INSERT INTO public.estoque (produto_id, sala_id, quantidade)
    VALUES (NEW.id, NEW.sala_id, 0)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

-- 3) Trigger seed estoque on new sala: só produtos globais
CREATE OR REPLACE FUNCTION public.seed_estoque_for_new_sala()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.estoque (produto_id, sala_id, quantidade)
  SELECT p.id, NEW.id, 0
    FROM public.produtos p
   WHERE p.sala_id IS NULL
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$function$;

-- Garante que os triggers existem (caso tenham sido criados sob outros nomes/locais)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_seed_estoque_new_produto') THEN
    CREATE TRIGGER trg_seed_estoque_new_produto
      AFTER INSERT ON public.produtos
      FOR EACH ROW EXECUTE FUNCTION public.seed_estoque_for_new_produto();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_seed_estoque_new_sala') THEN
    CREATE TRIGGER trg_seed_estoque_new_sala
      AFTER INSERT ON public.salas
      FOR EACH ROW EXECUTE FUNCTION public.seed_estoque_for_new_sala();
  END IF;
END $$;

-- 4) Função para exclusão segura/lógica de produtos
CREATE OR REPLACE FUNCTION public.excluir_produto(_produto uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_tem_mov BOOLEAN;
  v_tem_solic BOOLEAN;
  v_tem_emp BOOLEAN;
  v_tem_estoque BOOLEAN;
BEGIN
  IF NOT public.has_role(v_user, 'master') THEN
    RAISE EXCEPTION 'apenas master pode excluir produtos';
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.movimentacoes WHERE produto_id=_produto) INTO v_tem_mov;
  SELECT EXISTS(SELECT 1 FROM public.solicitacao_itens WHERE produto_id=_produto) INTO v_tem_solic;
  SELECT EXISTS(SELECT 1 FROM public.emprestimo_itens WHERE produto_id=_produto) INTO v_tem_emp;
  SELECT EXISTS(SELECT 1 FROM public.estoque WHERE produto_id=_produto AND quantidade > 0) INTO v_tem_estoque;

  IF v_tem_mov OR v_tem_solic OR v_tem_emp OR v_tem_estoque THEN
    -- Exclusão lógica: mantém histórico
    UPDATE public.produtos SET ativo = false, updated_at = now() WHERE id = _produto;
    RETURN jsonb_build_object('modo', 'desativado', 'mensagem', 'Produto desativado (possui histórico ou estoque). Histórico preservado.');
  ELSE
    -- Sem vínculos: pode remover de fato (e os registros zerados em estoque)
    DELETE FROM public.estoque WHERE produto_id = _produto;
    DELETE FROM public.produtos WHERE id = _produto;
    RETURN jsonb_build_object('modo', 'excluido', 'mensagem', 'Produto excluído permanentemente.');
  END IF;
END;
$function$;

-- 5) Função utilitária: reativar produto
CREATE OR REPLACE FUNCTION public.reativar_produto(_produto uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'master') THEN
    RAISE EXCEPTION 'apenas master';
  END IF;
  UPDATE public.produtos SET ativo = true, updated_at = now() WHERE id = _produto;
END;
$function$;