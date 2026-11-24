-- Phase 16: Server-side geocoding columns on deals and cached Census ACS tract demographics.

alter table public.deals
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists geocode_status text
    check (geocode_status in ('ok', 'no_address', 'not_found', 'error')),
  add column if not exists geocode_source text,
  add column if not exists geocoded_at timestamptz,
  add column if not exists census_tract_geoid text,
  add column if not exists geocoded_address text;

create index if not exists deals_geocoded_address_idx
  on public.deals (geocoded_address)
  where geocode_status = 'ok' and geocoded_address is not null;

create index if not exists deals_census_tract_geoid_idx
  on public.deals (census_tract_geoid)
  where census_tract_geoid is not null;

-- Allow permitted roles (per existing RLS) to edit address, city, and state.
-- Geocode columns remain strictly non-updatable by authenticated (service role writes only).
grant update (address, city, state) on public.deals to authenticated;

-- Allow service-role-only geocode column updates without bumping version or updated_by,
-- preventing false optimistic-lock conflicts for users editing other deal fields.
create or replace function public.prepare_deal_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  geo_cols constant text[] := array[
    'lat',
    'lng',
    'geocode_status',
    'geocode_source',
    'geocoded_at',
    'census_tract_geoid',
    'geocoded_address'
  ];
begin
  if new.version is distinct from old.version then
    raise exception using
      errcode = 'P0001',
      message = 'Deal version is managed by the database.';
  end if;

  if auth.uid() is null
    and (to_jsonb(new) - geo_cols) is not distinct from (to_jsonb(old) - geo_cols)
  then
    new.version := old.version;
    new.updated_at := old.updated_at;
    new.updated_by := old.updated_by;
    new.stage_entered_at := old.stage_entered_at;
    return new;
  end if;

  new.version := old.version + 1;
  new.updated_at := now();
  new.updated_by := auth.uid();

  if new.stage is distinct from old.stage then
    new.stage_entered_at := now();
  end if;

  return new;
end;
$$;

-- Ignore geocode cache columns in deal_history alongside derived/system columns.
create or replace function public.record_deal_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_json jsonb := to_jsonb(old);
  new_json jsonb := to_jsonb(new);
  changed_field record;
  import_run_id_text text := nullif(current_setting('app.import_run_id', true), '');
  history_detail jsonb := null;
begin
  if import_run_id_text is not null then
    history_detail := jsonb_build_object(
      'source', 'import',
      'run_id', import_run_id_text::bigint
    );
  end if;

  for changed_field in
    select key
    from jsonb_each(new_json)
    where value is distinct from old_json -> key
      and key not in (
        'version', 'updated_at', 'updated_by', 'stage_entered_at',
        'price_per_sf', 'price_per_lot_sf', 'created_at',
        'lat', 'lng', 'geocode_status', 'geocode_source',
        'geocoded_at', 'census_tract_geoid', 'geocoded_address'
      )
  loop
    insert into public.deal_history (
      deal_id, changed_by, changed_at, field, old_value, new_value, detail
    )
    values (
      new.id, auth.uid(), new.updated_at, changed_field.key,
      old_json -> changed_field.key, new_json -> changed_field.key, history_detail
    );
  end loop;

  return null;
end;
$$;

-- Cached Census ACS 5-year tract demographics (active users read, service role writes only).
create table if not exists public.tract_demographics (
  geoid text primary key,
  fetched_at timestamptz not null default now(),
  population integer,
  median_household_income integer,
  median_age numeric,
  households integer,
  pct_bachelors numeric,
  source text not null
);

alter table public.tract_demographics enable row level security;

drop policy if exists "active users read tract demographics" on public.tract_demographics;
create policy "active users read tract demographics"
on public.tract_demographics for select
to authenticated
using (public.current_user_active());

comment on policy "active users read tract demographics" on public.tract_demographics is
  'Every active authenticated user can read cached Census ACS tract demographics; writes are service role only.';

revoke all on table public.tract_demographics from public, anon, authenticated;
grant select on table public.tract_demographics to authenticated;
grant all on table public.tract_demographics to service_role;
