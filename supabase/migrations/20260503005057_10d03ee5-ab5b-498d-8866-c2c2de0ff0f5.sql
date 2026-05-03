CREATE OR REPLACE FUNCTION public.disponibilidade_produtos(_produto_ids uuid[])
RETURNS TABLE (
  sala_id uuid,
  sala_nome text,
  produto_id uuid,
  nivel text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_user_sala uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'não autenticado';
  END IF;
  v_user_sala := public.get_user_sala(v_user);

  RETURN QUERY
  SELECT
    s.id AS sala_id,
    s.nome AS sala_nome,
    p.id AS produto_id,
    CASE
      WHEN COALESCE(e.quantidade, 0) <= 0 THEN 'vermelho'
      WHEN COALESCE(e.quantidade, 0) <= COALESCE(p.estoque_minimo, 0) THEN 'amarelo'
      ELSE 'verde'
    END AS nivel
  FROM public.salas s
  CROSS JOIN public.produtos p
  LEFT JOIN public.estoque e ON e.sala_id = s.id AND e.produto_id = p.id
  WHERE p.id = ANY(_produto_ids)
    AND p.ativo = true
    AND (v_user_sala IS NULL OR s.id <> v_user_sala)
    AND (p.sala_id IS NULL OR p.sala_id = s.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.disponibilidade_produtos(uuid[]) TO authenticated;