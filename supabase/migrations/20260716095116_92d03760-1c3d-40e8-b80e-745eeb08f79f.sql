
-- desabilita gatilhos de proteção só durante o seed idempotente
set local session_replication_role = 'replica';

do $$
declare v_id uuid; v_reg uuid;
begin
  select id into v_id from public.profiles where lower(btrim(email)) = 'thiagosahy@gmail.com' limit 1;
  select id into v_reg from public.regioes where nome = 'Gramado e Canela' limit 1;
  if v_id is not null then
    insert into public.user_roles (user_id, role) values (v_id, 'master')       on conflict do nothing;
    insert into public.user_roles (user_id, role) values (v_id, 'super_master') on conflict do nothing;
    if v_reg is not null then
      insert into public.master_regioes (user_id, regiao_id) values (v_id, v_reg) on conflict do nothing;
    end if;
  end if;
end $$;

set local session_replication_role = 'origin';

create or replace function public.set_user_role(_user uuid, _role public.app_role)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_era_super boolean;
begin
  if _user is null or _role is null then raise exception 'parâmetros inválidos'; end if;

  if not public.master_ve_usuario(auth.uid(), _user) then
    raise exception 'sem permissão para alterar o cargo deste usuário';
  end if;

  if _role in ('master','super_master') and not public.is_super_master(auth.uid()) then
    raise exception 'apenas o Super Master concede os cargos master/super_master';
  end if;

  select exists(select 1 from public.user_roles where user_id = _user and role = 'super_master') into v_era_super;

  if v_era_super and _role <> 'super_master'
     and (select count(*) from public.user_roles where role = 'super_master') <= 1 then
    raise exception 'não é possível remover o último Super Master do sistema';
  end if;

  delete from public.user_roles where user_id = _user;
  insert into public.user_roles (user_id, role) values (_user, _role);

  if v_era_super and _role = 'master' then
    insert into public.user_roles (user_id, role) values (_user, 'super_master') on conflict do nothing;
  end if;
end $$;
