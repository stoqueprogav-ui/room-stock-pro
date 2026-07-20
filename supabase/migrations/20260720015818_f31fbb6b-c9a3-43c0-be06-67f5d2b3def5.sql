CREATE OR REPLACE FUNCTION public.lotes_por_validade(_sala uuid DEFAULT NULL::uuid, _regiao uuid DEFAULT NULL::uuid, _dias integer DEFAULT NULL::integer)
 RETURNS TABLE(lote_id uuid, produto_id uuid, produto_nome text, categoria_nome text, sala_id uuid, sala_nome text, regiao_nome text, quantidade integer, validade date, dias_para_vencer integer, faixa text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select l.id, p.id, p.nome, c.nome, s.id, s.nome, r.nome,
         l.quantidade, l.validade,
         (l.validade - current_date) as dias_para_vencer,
         case
           when l.validade is null then 'sem_validade'
           when l.validade < current_date then 'vencido'
           when l.validade <= current_date + 30 then 'semana'
           when l.validade <= current_date + 50 then 'mes'
           when l.validade <= current_date + 90 then 'trimestre'
           else 'ok'
         end as faixa
  from public.lotes l
  join public.produtos p on p.id = l.produto_id
  left join public.categorias c on c.id = p.categoria_id
  join public.salas s on s.id = l.sala_id
  left join public.regioes r on r.id = s.regiao_id
  where l.quantidade > 0
    and public.user_has_sala_access(auth.uid(), l.sala_id)
    and (_sala is null or l.sala_id = _sala)
    and (_regiao is null or s.regiao_id = _regiao)
    and (_dias is null or (l.validade is not null and l.validade <= current_date + _dias))
  order by l.validade nulls last, s.nome, p.nome;
$function$;

CREATE OR REPLACE FUNCTION public.alertar_validades()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record;
begin
  for r in
    select l.id, l.produto_id, l.sala_id, l.validade, p.nome as prod, s.nome as sala
    from public.lotes l
    join public.produtos p on p.id=l.produto_id
    join public.salas s on s.id=l.sala_id
    where l.quantidade > 0 and l.validade is not null and l.validade <= current_date + 30
      and not exists (
        select 1 from public.notifications n
        where n.entity_type='lote' and n.entity_id=l.id
          and n.created_at::date = current_date
      )
  loop
    perform public._notify_masters(
      'validade',
      'validade.alerta',
      case when r.validade < current_date then 'Produto VENCIDO' else 'Produto perto do vencimento' end,
      r.prod || ' em ' || r.sala || ' — validade ' || to_char(r.validade,'DD/MM/YYYY') ||
        case when r.validade < current_date then ' (vencido)'
             else ' (vence em ' || (r.validade - current_date) || ' dia(s))' end,
      '/app/validades',
      'lote',
      r.id,
      r.sala_id,
      null
    );
  end loop;
end $function$;