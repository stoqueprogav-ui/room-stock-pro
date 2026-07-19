CREATE OR REPLACE FUNCTION public.sugerir_troca_validade(_sala_atende uuid, _produto uuid, _qtd integer)
RETURNS TABLE(sala_id uuid, sala_nome text, lote_id uuid, validade date, dias integer, quantidade integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public' AS $$
  WITH cat AS (SELECT catalogo_id FROM public.produtos WHERE id = _produto),
  capacidade AS (
    SELECT COALESCE(SUM(l.quantidade),0) AS qtd_longa
      FROM public.lotes l
      JOIN public.produtos p ON p.id = l.produto_id
     WHERE l.sala_id = _sala_atende
       AND p.catalogo_id = (SELECT catalogo_id FROM cat)
       AND l.quantidade > 0
       AND (l.validade IS NULL OR l.validade > current_date + 15)
  )
  SELECT s.id, s.nome, l.id, l.validade, (l.validade - current_date), l.quantidade
  FROM public.lotes l
  JOIN public.produtos p ON p.id = l.produto_id
  JOIN public.salas s ON s.id = l.sala_id
  WHERE p.catalogo_id IS NOT NULL
    AND p.catalogo_id = (SELECT catalogo_id FROM cat)
    AND l.quantidade > 0
    AND l.validade IS NOT NULL
    AND l.validade <= current_date + 15
    AND l.sala_id <> _sala_atende
    AND s.regiao_id = (SELECT regiao_id FROM public.salas WHERE id = _sala_atende)
    AND public.user_has_sala_access(auth.uid(), l.sala_id)
    AND (SELECT qtd_longa FROM capacidade) >= _qtd
  ORDER BY l.validade ASC
  LIMIT 10;
$$;