alter table public.vertical_config
  add column active boolean not null default true,
  add column description text,
  add column updated_at timestamptz not null default now(),
  add column updated_by uuid references public.profiles (id) on delete set null;

update public.vertical_config as config
set columns = (
  select coalesce(
    jsonb_agg(
      case item.value ->> 'type'
        when 'text' then jsonb_set(item.value, '{type}', '"string"'::jsonb)
        when 'money' then jsonb_set(item.value, '{type}', '"number"'::jsonb)
        else item.value
      end
      order by item.ordinality
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(config.columns) with ordinality as item(value, ordinality)
)
where exists (
  select 1
  from jsonb_array_elements(config.columns) as item(value)
  where item.value ->> 'type' in ('text', 'money')
);

create or replace function public.vertical_columns_are_valid(value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  column_definition jsonb;
  column_key text;
  seen_keys text[] := array[]::text[];
begin
  if jsonb_typeof(value) is distinct from 'array' then
    return false;
  end if;

  for column_definition in
    select item.value from jsonb_array_elements(value) as item(value)
  loop
    if jsonb_typeof(column_definition) is distinct from 'object'
      or not (column_definition ?& array['key', 'label', 'type'])
      or column_definition - array['key', 'label', 'type'] <> '{}'::jsonb
      or jsonb_typeof(column_definition -> 'key') is distinct from 'string'
      or jsonb_typeof(column_definition -> 'label') is distinct from 'string'
      or jsonb_typeof(column_definition -> 'type') is distinct from 'string'
    then
      return false;
    end if;

    column_key := column_definition ->> 'key';
    if column_key !~ '^[a-z][a-z0-9_]*$'
      or btrim(column_definition ->> 'label') = ''
      or column_definition ->> 'type' not in ('number', 'string', 'boolean')
      or column_key = any (seen_keys)
    then
      return false;
    end if;

    seen_keys := array_append(seen_keys, column_key);
  end loop;

  return true;
end;
$$;

alter table public.vertical_config
  add constraint vertical_config_columns_valid
  check (public.vertical_columns_are_valid(columns));

create table public.source_tabs (
  tab_name text primary key,
  tab_prefix text references public.vertical_config (tab_prefix),
  client text,
  market text,
  last_imported_at timestamptz,
  row_count integer check (row_count is null or row_count >= 0),
  active boolean not null default true
);

do $$
declare
  conflicting_tab text;
begin
  if exists (
    select 1 from public.deals where source_tab is null
  ) then
    raise exception 'Cannot backfill source_tabs: a deal has no source_tab.';
  end if;

  select deal.source_tab
  into conflicting_tab
  from public.deals as deal
  group by deal.source_tab
  having count(distinct (deal.client, deal.market)) > 1
  limit 1;

  if conflicting_tab is not null then
    raise exception
      'Cannot backfill source_tabs: source tab % has multiple client/market values.',
      conflicting_tab;
  end if;
end;
$$;

insert into public.source_tabs (
  tab_name,
  tab_prefix,
  client,
  market,
  row_count,
  active
)
select
  deal.source_tab,
  config.tab_prefix,
  min(deal.client),
  min(deal.market),
  count(*)::integer,
  true
from public.deals as deal
left join public.vertical_config as config
  on config.tab_prefix = lower(split_part(deal.source_tab, '_', 1))
group by deal.source_tab, config.tab_prefix;

create or replace function public.set_vertical_config_editor()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.updated_at := now();
    new.updated_by := auth.uid();
    return new;
  end if;

  if row(
    new.tab_prefix,
    new.vertical,
    new.sort_order,
    new.columns,
    new.active,
    new.description
  ) is distinct from row(
    old.tab_prefix,
    old.vertical,
    old.sort_order,
    old.columns,
    old.active,
    old.description
  ) then
    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(), old.updated_by);
  else
    new.updated_at := old.updated_at;
    new.updated_by := old.updated_by;
  end if;

  return new;
end;
$$;

create trigger vertical_config_set_editor
before insert or update on public.vertical_config
for each row
execute function public.set_vertical_config_editor();

create or replace function public.audit_vertical_config_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  old_record jsonb;
  new_record jsonb;
begin
  if tg_op <> 'INSERT' then
    old_record := to_jsonb(old);
  end if;
  if tg_op <> 'DELETE' then
    new_record := to_jsonb(new);
  end if;

  if tg_op = 'UPDATE'
    and (old_record - 'updated_at' - 'updated_by')
      is not distinct from (new_record - 'updated_at' - 'updated_by')
  then
    return new;
  end if;

  if actor_id is not null then
    insert into public.activity_log (user_id, event, path, detail)
    values (
      actor_id,
      'config_change',
      '/admin',
      jsonb_build_object(
        'table', tg_table_name,
        'operation', lower(tg_op),
        'old', old_record,
        'new', new_record
      )
    );
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger vertical_config_audit
after insert or update or delete on public.vertical_config
for each row
execute function public.audit_vertical_config_change();

create trigger source_tabs_audit
after insert or update or delete on public.source_tabs
for each row
execute function public.audit_vertical_config_change();

alter table public.source_tabs enable row level security;

create policy "active users read source tabs"
on public.source_tabs for select
to authenticated
using (public.current_user_active());

create policy "admins write source tabs"
on public.source_tabs for all
to authenticated
using (public.app_role() = 'admin')
with check (public.app_role() = 'admin');

grant select, insert, update, delete on public.source_tabs to authenticated;

create or replace function public.admin_rename_vertical(
  old_vertical text,
  new_vertical text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  stable_prefix text;
  old_name text := btrim(old_vertical);
  new_name text := btrim(new_vertical);
begin
  if public.app_role() is distinct from 'admin' then
    raise exception using
      errcode = '42501',
      message = 'Only administrators can rename a vertical.';
  end if;

  if old_name = '' or new_name = '' then
    raise exception using
      errcode = '22023',
      message = 'Vertical names cannot be blank.';
  end if;

  select config.tab_prefix
  into stable_prefix
  from public.vertical_config as config
  where config.vertical = old_name
  for update;

  if stable_prefix is null then
    raise exception using
      errcode = 'P0002',
      message = format('Vertical %s does not exist.', old_name);
  end if;

  if old_name = new_name then
    return;
  end if;

  if exists (
    select 1 from public.vertical_config as config
    where config.vertical = new_name
  ) then
    raise exception using
      errcode = '23505',
      message = format('Vertical %s already exists.', new_name);
  end if;

  update public.vertical_config
  set vertical = new_name
  where tab_prefix = stable_prefix;

  update public.deals
  set vertical = new_name
  where vertical = old_name;

  update public.profiles
  set verticals = array_replace(verticals, old_name, new_name)
  where old_name = any (verticals);

  perform 1
  from public.source_tabs
  where tab_prefix = stable_prefix
  for update;
end;
$$;

revoke all on function public.admin_rename_vertical(text, text) from public;
grant execute on function public.admin_rename_vertical(text, text) to authenticated;

create or replace function public.admin_reorder_verticals(prefixes text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  prefix text;
  order_index integer := 0;
  configured_count integer;
begin
  if public.app_role() is distinct from 'admin' then
    raise exception using
      errcode = '42501',
      message = 'Only administrators can reorder verticals.';
  end if;

  if prefixes is null or cardinality(prefixes) > 1000
    or cardinality(prefixes) <> cardinality(array(select distinct item from unnest(prefixes) as item))
  then
    raise exception using
      errcode = '22023',
      message = 'Provide each configured vertical prefix exactly once.';
  end if;

  select count(*) into configured_count from public.vertical_config;
  if cardinality(prefixes) <> configured_count
    or exists (
      select 1
      from unnest(prefixes) as requested(prefix)
      where not exists (
        select 1 from public.vertical_config as config
        where config.tab_prefix = requested.prefix
      )
    )
  then
    raise exception using
      errcode = '22023',
      message = 'The order must include every configured vertical exactly once.';
  end if;

  foreach prefix in array prefixes
  loop
    order_index := order_index + 1;
    update public.vertical_config
    set sort_order = order_index * 10
    where tab_prefix = prefix;
  end loop;
end;
$$;

revoke all on function public.admin_reorder_verticals(text[]) from public;
grant execute on function public.admin_reorder_verticals(text[]) to authenticated;
