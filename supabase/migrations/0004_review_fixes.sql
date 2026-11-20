alter table public.deals
  add column created_at timestamptz not null default now();

alter table public.deals disable trigger deals_before_update;
alter table public.deals disable trigger deals_provenance_before_update;
alter table public.deals disable trigger deals_after_update;

update public.deals as deal
set created_at = coalesce(
  (
    select min(history.changed_at)
    from public.deal_history as history
    where history.deal_id = deal.id
  ),
  deal.stage_entered_at
);

alter table public.deals enable trigger deals_before_update;
alter table public.deals enable trigger deals_provenance_before_update;
alter table public.deals enable trigger deals_after_update;

alter function public.current_role() rename to app_role;

create or replace function public.enforce_provenance_permissions()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  provenance_key text;
  new_status text;
  old_status text;
begin
  if new.field_provenance is not distinct from old.field_provenance then
    return new;
  end if;

  for provenance_key, new_status in
    select key, value from jsonb_each_text(new.field_provenance)
  loop
    if new_status not in ('assumed', 'llm_suggested', 'confirmed') then
      raise exception using
        errcode = '22023',
        message = 'Field provenance must be assumed, llm_suggested, or confirmed.';
    end if;
    old_status := old.field_provenance ->> provenance_key;
    if new_status = 'confirmed' and old_status is distinct from 'confirmed' then
      if public.app_role() not in ('admin', 'acq_lead') then
        raise exception using
          errcode = '42501',
          message = 'This role cannot confirm assumptions.';
      end if;
      if public.app_role() = 'acq_lead'
        and not (new.vertical = any ((public.current_profile()).verticals))
      then
        raise exception using
          errcode = '42501',
          message = 'Acquisition leads can only confirm deals in their verticals.';
      end if;
    end if;
  end loop;
  return new;
end;
$$;

drop policy "admins write vertical config" on public.vertical_config;
create policy "admins write vertical config" on public.vertical_config for all
to authenticated using (public.app_role() = 'admin')
with check (public.app_role() = 'admin');

drop policy "permitted roles update deals" on public.deals;
create policy "permitted roles update deals" on public.deals for update
to authenticated
using (
  public.current_user_active() and (
    public.app_role() = 'admin'
    or (public.app_role() = 'acq_lead' and vertical = any ((public.current_profile()).verticals))
    or (public.app_role() = 'analyst' and client = any ((public.current_profile()).clients))
  )
)
with check (
  public.current_user_active() and (
    public.app_role() = 'admin'
    or (public.app_role() = 'acq_lead' and vertical = any ((public.current_profile()).verticals))
    or (public.app_role() = 'analyst' and client = any ((public.current_profile()).clients))
  )
);

drop policy "admins insert deals" on public.deals;
create policy "admins insert deals" on public.deals for insert
to authenticated with check (public.app_role() = 'admin');

drop policy "admins delete deals" on public.deals;
create policy "admins delete deals" on public.deals for delete
to authenticated using (public.app_role() = 'admin');

drop policy "admins write contacts" on public.contacts;
create policy "admins write contacts" on public.contacts for all
to authenticated using (public.app_role() = 'admin')
with check (public.app_role() = 'admin');

drop policy "users read own profile" on public.profiles;
create policy "users read own profile" on public.profiles for select
to authenticated using (
  (id = auth.uid() and public.current_user_active())
  or public.app_role() = 'admin'
);

drop policy "admins write profiles" on public.profiles;
create policy "admins write profiles" on public.profiles for all
to authenticated using (public.app_role() = 'admin')
with check (public.app_role() = 'admin');

drop policy "admins read all activity" on public.activity_log;
create policy "admins read all activity" on public.activity_log for select
to authenticated using (public.app_role() = 'admin');

revoke update on public.deals from authenticated;
grant update (
  stage, bldg_sf, list_price, lot_sf, broker, broker_phone, notes, weekly_note,
  show_in_weekly, attributes, field_provenance
) on public.deals to authenticated;

drop policy if exists "admins write weekly snapshots"
  on public.weekly_snapshots;

create policy "admin and leadership insert weekly snapshots"
on public.weekly_snapshots for insert
to authenticated
with check (
  public.current_user_active()
  and public.app_role() in ('admin', 'leadership')
);

create policy "admin and leadership update weekly snapshots"
on public.weekly_snapshots for update
to authenticated
using (
  public.current_user_active()
  and public.app_role() in ('admin', 'leadership')
)
with check (
  public.current_user_active()
  and public.app_role() in ('admin', 'leadership')
);

create policy "admins delete weekly snapshots"
on public.weekly_snapshots for delete
to authenticated
using (
  public.current_user_active()
  and public.app_role() = 'admin'
);

comment on policy "admin and leadership insert weekly snapshots"
  on public.weekly_snapshots is
  'Active administrators and leadership can save weekly snapshots.';
comment on policy "admin and leadership update weekly snapshots"
  on public.weekly_snapshots is
  'Active administrators and leadership can update weekly snapshots.';
comment on policy "admins delete weekly snapshots"
  on public.weekly_snapshots is
  'Only active administrators can delete weekly snapshots.';

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
begin
  for changed_field in
    select key
    from jsonb_each(new_json)
    where value is distinct from old_json -> key
      and key not in (
        'version', 'updated_at', 'updated_by', 'stage_entered_at',
        'price_per_sf', 'price_per_lot_sf', 'created_at'
      )
  loop
    insert into public.deal_history (
      deal_id, changed_by, changed_at, field, old_value, new_value
    )
    values (
      new.id, auth.uid(), new.updated_at, changed_field.key,
      old_json -> changed_field.key, new_json -> changed_field.key
    );
  end loop;

  return null;
end;
$$;

create view public.profile_names
with (security_invoker = false)
as
select id, full_name, role
from public.profiles
where active and public.current_user_active();

alter view public.profile_names owner to postgres;
revoke all on public.profile_names from public, anon, authenticated;
grant select on public.profile_names to authenticated;
