-- 1) Consolidar catálogos duplicados por chave forte
do $$
declare r record; v_keep uuid;
begin
  for r in
    select regexp_replace(lower(unaccent(nome)), '[^a-z0-9]', '', 'g') as k,
           array_agg(id order by (select count(*) from produtos p where p.catalogo_id = c.id) desc, id) as ids
    from produtos_catalogo c
    group by 1
    having count(*) > 1
  loop
    v_keep := r.ids[1];
    update produtos p set catalogo_id = v_keep
     where p.catalogo_id = any(r.ids[2:])
       and not exists (select 1 from produtos p2 where p2.catalogo_id = v_keep and p2.sala_id = p.sala_id);
    delete from produtos_catalogo c2
     where c2.id = any(r.ids[2:])
       and not exists (select 1 from produtos p where p.catalogo_id = c2.id);
  end loop;
end $$;

-- 2) Recriar catalogo_disponibilidade escopando por região do solicitante
CREATE OR REPLACE FUNCTION public.catalogo_disponibilidade(_catalogo uuid, _quantidade integer DEFAULT 1, _excluir_sala uuid DEFAULT NULL::uuid)
 RETURNS TABLE(sala_id uuid, sala_nome text, produto_id uuid, unidade text, custo_unitario numeric, quantidade_disponivel integer, atende_pct integer, atende_total boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    AND (_excluir_sala IS NULL OR s.regiao_id = public.sala_regiao(_excluir_sala))
  ORDER BY 8 DESC, 7 DESC, s.nome ASC;
$function$;