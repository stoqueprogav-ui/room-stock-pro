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