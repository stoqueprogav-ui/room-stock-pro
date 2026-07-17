-- Fase 3: Troca de lotes entre salas (rodízio de validade), neutra em valor

create or replace function public.sugerir_troca_validade(_sala_atende uuid, _produto uuid, _qtd integer)
returns table(sala_id uuid, sala_nome text, lote_id uuid, validade date, dias integer, quantidade integer)
language sql stable security definer set search_path=public as $$
  select s.id, s.nome, l.id, l.validade, (l.validade - current_date), l.quantidade
  from public.lotes l
  join public.salas s on s.id = l.sala_id
  where l.produto_id = _produto
    and l.quantidade > 0
    and l.validade is not null
    and l.validade <= current_date + 15
    and l.sala_id <> _sala_atende
    and s.regiao_id = (select regiao_id from public.salas where id = _sala_atende)
    and public.user_has_sala_access(auth.uid(), l.sala_id)
  order by l.validade asc
  limit 10;
$$;

grant execute on function public.sugerir_troca_validade(uuid, uuid, integer) to authenticated, service_role;

create or replace function public.trocar_lotes(_lote_curto uuid, _sala_atende uuid, _qtd integer)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_curto record; v_sala_origem uuid; v_produto uuid;
  v_val_origem_antes numeric; v_val_atende_antes numeric;
  r record; v_rest integer; v_tira integer;
begin
  if _qtd <= 0 then raise exception 'quantidade inválida'; end if;
  select * into v_curto from public.lotes where id = _lote_curto;
  if v_curto is null then raise exception 'lote não encontrado'; end if;
  v_sala_origem := v_curto.sala_id; v_produto := v_curto.produto_id;
  if v_sala_origem = _sala_atende then raise exception 'salas iguais'; end if;

  if (select regiao_id from salas where id=v_sala_origem) is distinct from (select regiao_id from salas where id=_sala_atende) then
    raise exception 'troca só entre salas da mesma região';
  end if;

  if not (public.master_scope_sala(auth.uid(), v_sala_origem) and public.master_scope_sala(auth.uid(), _sala_atende))
     and not (public.user_has_sala_access(auth.uid(), v_sala_origem) and public.user_has_sala_access(auth.uid(), _sala_atende)) then
    raise exception 'sem permissão nas duas salas';
  end if;

  if _qtd > v_curto.quantidade then raise exception 'lote curto não tem essa quantidade'; end if;

  if _qtd > coalesce((select sum(quantidade) from lotes where produto_id=v_produto and sala_id=_sala_atende
                      and (validade is null or validade > current_date + 15)),0) then
    raise exception 'sala que atende não tem quantidade de validade longa suficiente para a troca';
  end if;

  v_val_origem_antes := coalesce((select valor_total from estoque where produto_id=v_produto and sala_id=v_sala_origem),0);
  v_val_atende_antes := coalesce((select valor_total from estoque where produto_id=v_produto and sala_id=_sala_atende),0);

  -- 1) move _qtd do lote curto: origem -> atende
  update public.lotes set quantidade = quantidade - _qtd where id = _lote_curto;
  insert into public.lotes (produto_id, sala_id, quantidade, validade, referencia_tipo, referencia_id)
  values (v_produto, _sala_atende, _qtd, v_curto.validade, 'troca', _lote_curto);

  -- 2) move _qtd de lotes LONGOS: atende -> origem
  v_rest := _qtd;
  for r in select id, quantidade, validade from public.lotes
           where produto_id=v_produto and sala_id=_sala_atende and quantidade>0
             and (validade is null or validade > current_date + 15)
             and not (referencia_tipo='troca' and referencia_id=_lote_curto)
           order by validade desc nulls first, entrada_em desc
  loop
    exit when v_rest<=0;
    v_tira := least(r.quantidade, v_rest);
    update public.lotes set quantidade = quantidade - v_tira where id = r.id;
    insert into public.lotes (produto_id, sala_id, quantidade, validade, referencia_tipo, referencia_id)
    values (v_produto, v_sala_origem, v_tira, r.validade, 'troca', _lote_curto);
    v_rest := v_rest - v_tira;
  end loop;

  delete from public.lotes where produto_id=v_produto and quantidade=0;

  -- 3) Sincroniza estoque a partir dos lotes e neutraliza valor
  perform public._sync_estoque_from_lotes(v_produto, v_sala_origem);
  perform public._sync_estoque_from_lotes(v_produto, _sala_atende);

  update estoque set valor_total = v_val_origem_antes,
         custo_medio = case when quantidade>0 then round(v_val_origem_antes/quantidade,4) else custo_medio end
   where produto_id=v_produto and sala_id=v_sala_origem;
  update estoque set valor_total = v_val_atende_antes,
         custo_medio = case when quantidade>0 then round(v_val_atende_antes/quantidade,4) else custo_medio end
   where produto_id=v_produto and sala_id=_sala_atende;

  perform public.log_event('lote.troca','Troca de lotes (rodízio de validade)','estoque', v_sala_origem, 'lote', _lote_curto,
    jsonb_build_object('sala_atende', _sala_atende, 'produto', v_produto, 'quantidade', _qtd, 'validade_curta', v_curto.validade));
end $$;

grant execute on function public.trocar_lotes(uuid, uuid, integer) to authenticated, service_role;