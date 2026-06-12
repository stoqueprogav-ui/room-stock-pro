
-- Fase 1: status de produto por sala
ALTER TABLE public.estoque ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true;

-- Backfill: herda do produto global
UPDATE public.estoque e
SET ativo = COALESCE(p.ativo, true)
FROM public.produtos p
WHERE p.id = e.produto_id;

-- RPC para alternar status de produto em uma sala
CREATE OR REPLACE FUNCTION public.toggle_produto_sala_ativo(
  _produto_id uuid,
  _sala_id uuid,
  _ativo boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _is_master boolean;
  _is_admin boolean;
  _produto_nome text;
  _sala_nome text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT public.has_role(_uid, 'master'::app_role) INTO _is_master;
  SELECT public.has_role(_uid, 'admin'::app_role) INTO _is_admin;

  IF NOT (_is_master OR _is_admin) THEN
    RAISE EXCEPTION 'Sem permissão para alterar status de produto';
  END IF;

  -- Garante a linha em estoque (caso ainda não exista para a sala)
  INSERT INTO public.estoque (produto_id, sala_id, quantidade, ativo)
  VALUES (_produto_id, _sala_id, 0, _ativo)
  ON CONFLICT (produto_id, sala_id) DO UPDATE
    SET ativo = EXCLUDED.ativo,
        updated_at = now();

  SELECT nome INTO _produto_nome FROM public.produtos WHERE id = _produto_id;
  SELECT nome INTO _sala_nome FROM public.salas WHERE id = _sala_id;

  INSERT INTO public.system_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    _uid,
    CASE WHEN _ativo THEN 'produto_sala_ativado' ELSE 'produto_sala_desativado' END,
    'estoque',
    _produto_id,
    jsonb_build_object(
      'produto_nome', _produto_nome,
      'sala_id', _sala_id,
      'sala_nome', _sala_nome,
      'ativo', _ativo
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.toggle_produto_sala_ativo(uuid, uuid, boolean) TO authenticated;
