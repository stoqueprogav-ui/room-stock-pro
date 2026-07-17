
-- PARTE 1: correção de dados
do $$
declare
  r record;
  v_correto uuid;
  v_ref produtos%rowtype;
begin
  for r in
    select e.produto_id, e.sala_id, e.quantidade
    from estoque e
    join produtos p on p.id = e.produto_id
    where p.sala_id <> e.sala_id
  loop
    select * into v_ref from produtos where id = r.produto_id;

    select id into v_correto
      from produtos
     where catalogo_id = v_ref.catalogo_id and sala_id = r.sala_id
     limit 1;

    if v_correto is null then
      insert into produtos (nome, descricao, unidade, estoque_minimo, custo_unitario, categoria_id, sala_id, catalogo_id, ativo)
      values (v_ref.nome, v_ref.descricao, v_ref.unidade, v_ref.estoque_minimo, v_ref.custo_unitario, v_ref.categoria_id, r.sala_id, v_ref.catalogo_id, true)
      returning id into v_correto;
    end if;

    update movimentacoes
       set produto_id = v_correto
     where produto_id = r.produto_id
       and sala_id    = r.sala_id;

    if exists (select 1 from estoque where produto_id = v_correto and sala_id = r.sala_id) then
      update estoque dst
         set quantidade = dst.quantidade + r.quantidade
       where dst.produto_id = v_correto
         and dst.sala_id    = r.sala_id;
      delete from estoque
       where produto_id = r.produto_id
         and sala_id    = r.sala_id;
    else
      update estoque
         set produto_id = v_correto
       where produto_id = r.produto_id
         and sala_id    = r.sala_id;
    end if;

    perform public._recalc_estoque_valor(v_correto, r.sala_id);
  end loop;
end $$;

-- PARTE 2: blindagem estrutural
alter table public.produtos
  add constraint produtos_id_sala_uk unique (id, sala_id);

alter table public.estoque
  drop constraint if exists estoque_produto_id_fkey;

alter table public.estoque
  add constraint estoque_produto_sala_fk
  foreign key (produto_id, sala_id)
  references public.produtos (id, sala_id)
  on delete cascade;
