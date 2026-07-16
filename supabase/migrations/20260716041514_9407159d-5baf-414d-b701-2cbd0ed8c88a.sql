-- =====================================================================
--  Estoque Pro — Segurança + Notificações de estoque
-- =====================================================================

-- (A.1) Consumo interno: apenas Master.
CREATE OR REPLACE FUNCTION public.registrar_consumo_interno(
  _sala uuid, _produto uuid, _quantidade integer,
  _motivo motivo_consumo, _observacao text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_sala uuid;
  v_saldo integer;
  v_cmp numeric;
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'não autenticado'; END IF;
  IF NOT public.has_role(v_user, 'master') THEN
    RAISE EXCEPTION 'apenas master pode registrar consumo interno';
  END IF;
  IF _quantidade IS NULL OR _quantidade <= 0 THEN RAISE EXCEPTION 'quantidade inválida'; END IF;

  v_sala := _sala;
  IF v_sala IS NULL THEN RAISE EXCEPTION 'sala inválida'; END IF;

  SELECT custo_medio INTO v_cmp FROM public.estoque
    WHERE produto_id = _produto AND sala_id = v_sala;

  UPDATE public.estoque SET quantidade = quantidade - _quantidade
   WHERE produto_id = _produto AND sala_id = v_sala
   RETURNING quantidade INTO v_saldo;
  IF v_saldo IS NULL THEN RAISE EXCEPTION 'produto não encontrado no estoque da sala'; END IF;
  IF v_saldo < 0 THEN RAISE EXCEPTION 'estoque insuficiente'; END IF;
  PERFORM public._recalc_estoque_valor(_produto, v_sala);

  INSERT INTO public.consumos_internos (sala_id, produto_id, usuario_id, quantidade, motivo, observacao)
  VALUES (v_sala, _produto, v_user, _quantidade, _motivo, _observacao)
  RETURNING id INTO v_id;

  INSERT INTO public.movimentacoes
    (produto_id, sala_id, usuario_id, tipo, quantidade, saldo_apos, observacao,
     referencia_tipo, referencia_id, custo_unitario_aplicado, valor_financeiro)
  VALUES (_produto, v_sala, v_user, 'saida', -_quantidade, v_saldo,
          concat('Consumo interno: ', _motivo, coalesce(' — ' || _observacao, '')),
          'consumo_interno', v_id, coalesce(v_cmp,0), coalesce(v_cmp,0) * _quantidade);

  RETURN v_id;
END;
$$;

-- (A.2) Toggle produto na sala: apenas Master.
CREATE OR REPLACE FUNCTION public.toggle_produto_sala_ativo(
  _produto_id uuid, _sala_id uuid, _ativo boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _produto_nome text;
  _sala_nome text;
  _status_anterior boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.has_role(_uid, 'master') THEN
    RAISE EXCEPTION 'apenas master pode alterar status de produto';
  END IF;

  SELECT ativo INTO _status_anterior
  FROM public.estoque WHERE produto_id = _produto_id AND sala_id = _sala_id;

  IF _ativo THEN
    UPDATE public.produtos SET ativo = true, updated_at = now()
     WHERE id = _produto_id AND ativo = false;
  END IF;

  INSERT INTO public.estoque (produto_id, sala_id, quantidade, ativo)
  VALUES (_produto_id, _sala_id, 0, _ativo)
  ON CONFLICT (produto_id, sala_id) DO UPDATE
    SET ativo = EXCLUDED.ativo, updated_at = now();

  SELECT nome INTO _produto_nome FROM public.produtos WHERE id = _produto_id;
  SELECT nome INTO _sala_nome    FROM public.salas    WHERE id = _sala_id;

  PERFORM public.log_event(
    CASE WHEN _ativo THEN 'produto_sala_ativado' ELSE 'produto_sala_desativado' END,
    CASE WHEN _ativo THEN 'Produto reativado na sala' ELSE 'Produto desativado na sala' END,
    'estoque', _sala_id, 'estoque', _produto_id,
    jsonb_build_object('produto_id', _produto_id, 'produto_nome', _produto_nome,
      'sala_id', _sala_id, 'sala_nome', _sala_nome,
      'status_anterior', COALESCE(_status_anterior, false), 'status_novo', _ativo));
END;
$$;

-- (A.3) handle_new_user sem escalonamento por metadados.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (id, nome, email, sala_id, must_change_password)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nome', split_part(NEW.email, '@', 1)),
    NEW.email,
    NULLIF(NEW.raw_user_meta_data->>'sala_id', '')::uuid,
    COALESCE((NEW.raw_user_meta_data->>'must_change_password')::boolean, true)
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Blindagem: master/admin só pelo service_role ou por um Master já existente.
CREATE OR REPLACE FUNCTION public._tg_guard_user_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IN ('master','admin')
     AND current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
     AND NOT public.has_role(auth.uid(), 'master') THEN
    RAISE EXCEPTION 'cargo % só pode ser concedido pelo Master', NEW.role;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_user_roles ON public.user_roles;
CREATE TRIGGER trg_guard_user_roles
  BEFORE INSERT OR UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public._tg_guard_user_roles();

-- (B) Produto zerado -> desativa; volta a ter estoque -> reativa.
CREATE OR REPLACE FUNCTION public._tg_estoque_auto_ativo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.quantidade <= 0 AND COALESCE(OLD.quantidade, 1) > 0 THEN
    NEW.ativo := false;
  ELSIF NEW.quantidade > 0 AND COALESCE(OLD.quantidade, 0) <= 0 THEN
    NEW.ativo := true;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_estoque_auto_desativa ON public.estoque;
DROP TRIGGER IF EXISTS trg_estoque_auto_ativo ON public.estoque;
CREATE TRIGGER trg_estoque_auto_ativo
  BEFORE UPDATE OF quantidade ON public.estoque
  FOR EACH ROW EXECUTE FUNCTION public._tg_estoque_auto_ativo();

CREATE OR REPLACE FUNCTION public._tg_notif_estoque_zerado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_prod text; v_sala text;
BEGIN
  IF NEW.quantidade <= 0 AND COALESCE(OLD.quantidade, 1) > 0 THEN
    SELECT nome INTO v_prod FROM public.produtos WHERE id = NEW.produto_id;
    SELECT nome INTO v_sala FROM public.salas    WHERE id = NEW.sala_id;
    PERFORM public._notify_masters(
      'estoque', 'estoque.zerado',
      'Produto zerado e desativado',
      COALESCE(v_prod,'Produto') || ' em ' || COALESCE(v_sala,'sala')
        || ' chegou a zero e foi desativado automaticamente. Reative quando repor o estoque.',
      '/app/estoque',
      'estoque', NEW.produto_id, NEW.sala_id, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notif_estoque_zerado ON public.estoque;
CREATE TRIGGER trg_notif_estoque_zerado
  AFTER UPDATE OF quantidade ON public.estoque
  FOR EACH ROW EXECUTE FUNCTION public._tg_notif_estoque_zerado();

-- (C) Movimentação manual do Master notifica a sala afetada.
CREATE OR REPLACE FUNCTION public._tg_notif_mov_estoque()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_prod text; v_label text; v_body text;
BEGIN
  IF NEW.tipo IN ('entrada','saida','ajuste')
     AND NEW.usuario_id IS NOT NULL
     AND public.has_role(NEW.usuario_id, 'master') THEN

    SELECT nome INTO v_prod FROM public.produtos WHERE id = NEW.produto_id;
    v_label := CASE NEW.tipo
                 WHEN 'entrada' THEN 'Entrada'
                 WHEN 'saida'   THEN 'Saída'
                 ELSE 'Ajuste' END;
    v_body := v_label || ' de estoque em "' || COALESCE(v_prod,'produto')
              || '" · saldo atual: ' || NEW.saldo_apos || '.'
              || COALESCE(E'\n' || NEW.observacao, '');

    PERFORM public._notify_sala(
      NEW.sala_id, 'estoque', 'estoque.movimentacao',
      v_label || ' de estoque pelo Master',
      v_body, '/app/movimentacoes',
      'estoque', NEW.produto_id, NEW.usuario_id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notif_mov_estoque ON public.movimentacoes;
CREATE TRIGGER trg_notif_mov_estoque
  AFTER INSERT ON public.movimentacoes
  FOR EACH ROW EXECUTE FUNCTION public._tg_notif_mov_estoque();