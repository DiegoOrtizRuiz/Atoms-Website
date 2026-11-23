-- Phase 15: in-app workbook import runs, private Storage bucket, deal_history detail,
-- and transactional apply_import RPC.

create table public.import_runs (
  id bigserial primary key,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  applied_by uuid references public.profiles (id) on delete set null,
  file_name text not null,
  file_sha256 text not null,
  storage_path text,
  status text not null
    check (status in ('previewed', 'applied', 'discarded', 'failed')),
  error_message text,
  summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(summary) = 'object'),
  diff jsonb not null default '{}'::jsonb
    check (jsonb_typeof(diff) = 'object')
);

create index import_runs_created_at_idx
  on public.import_runs (created_at desc, id desc);
create index import_runs_status_created_idx
  on public.import_runs (status, created_at desc);
create index import_runs_sha256_idx
  on public.import_runs (file_sha256);

alter table public.import_runs enable row level security;

create policy "admins manage import runs"
on public.import_runs for all
to authenticated
using (public.app_role() = 'admin')
with check (public.app_role() = 'admin');

comment on policy "admins manage import runs" on public.import_runs is
  'Only active administrators can view, preview, discard, or apply workbook import runs.';

grant select, insert, update, delete on table public.import_runs to authenticated;
grant usage, select on sequence public.import_runs_id_seq to authenticated;

-- Track import metadata on deal_history rows without duplicating trigger writes.
alter table public.deal_history
  add column if not exists detail jsonb;

comment on column public.deal_history.detail is
  'Optional change metadata, e.g. {"source": "import", "run_id": 12} for workbook imports.';

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
        'price_per_sf', 'price_per_lot_sf', 'created_at'
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

-- Private Supabase Storage bucket for reproducible workbook uploads (admin-only policies).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'imports',
  'imports',
  false,
  10485760,
  array[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream'
  ]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "admins read import files" on storage.objects;
create policy "admins read import files"
on storage.objects for select
to authenticated
using (bucket_id = 'imports' and public.app_role() = 'admin');

drop policy if exists "admins insert import files" on storage.objects;
create policy "admins insert import files"
on storage.objects for insert
to authenticated
with check (bucket_id = 'imports' and public.app_role() = 'admin');

drop policy if exists "admins update import files" on storage.objects;
create policy "admins update import files"
on storage.objects for update
to authenticated
using (bucket_id = 'imports' and public.app_role() = 'admin')
with check (bucket_id = 'imports' and public.app_role() = 'admin');

drop policy if exists "admins delete import files" on storage.objects;
create policy "admins delete import files"
on storage.objects for delete
to authenticated
using (bucket_id = 'imports' and public.app_role() = 'admin');

-- Atomic workbook import application inside one Postgres transaction.
create or replace function public.apply_import(
  run_id bigint,
  decisions jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_run public.import_runs%rowtype;
  v_decisions jsonb := coalesce(decisions, '{}'::jsonb);
  v_history_detail jsonb;
  v_item jsonb;
  v_incoming jsonb;
  v_deal_id text;
  v_kind text;
  v_existing public.deals%rowtype;
  v_change jsonb;
  v_field text;
  v_is_conflict boolean;
  v_choice text;
  v_missing_choice text;
  v_attr_key text;
  v_has_applied_change boolean;

  -- Working columns for deal inserts/updates
  v_source_tab text;
  v_source_row integer;
  v_vertical text;
  v_client text;
  v_market text;
  v_city text;
  v_state text;
  v_state_inferred boolean;
  v_address text;
  v_stage public.deal_stage;
  v_stage_raw text;
  v_bldg_sf numeric;
  v_list_price numeric;
  v_lot_sf numeric;
  v_broker text;
  v_broker_phone text;
  v_notes text;
  v_needs_review boolean;
  v_review_reasons text[];
  v_attributes jsonb;
  v_attributes_raw jsonb;
  v_provenance jsonb;
  v_assumed_fields text[];
  v_show_in_weekly boolean;
  v_stage_entered_at timestamptz;
  v_days_on_market numeric;

  -- Contacts and source_tabs loop vars
  v_contact jsonb;
  v_tab jsonb;
  v_tab_name text;
  v_tab_prefix text;
  v_tab_rows integer;

  -- Counters
  v_inserted integer := 0;
  v_updated integer := 0;
  v_marked_on_hold integer := 0;
  v_skipped_conflicts integer := 0;
  v_contacts_upserted integer := 0;
  v_result jsonb;
begin
  if public.app_role() is distinct from 'admin' or v_actor is null then
    raise exception using
      errcode = '42501',
      message = 'Only administrators can apply imports.';
  end if;

  if jsonb_typeof(v_decisions) is distinct from 'object' then
    raise exception using
      errcode = '22023',
      message = 'Import decisions must be a JSON object.';
  end if;

  select *
  into v_run
  from public.import_runs
  where id = run_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = format('Import run #%s was not found.', run_id);
  end if;

  if v_run.status is distinct from 'previewed' then
    raise exception using
      errcode = '22023',
      message = format('Import run #%s cannot be applied because its status is %s.', run_id, v_run.status);
  end if;

  v_history_detail := jsonb_build_object('source', 'import', 'run_id', run_id);
  perform set_config('app.import_run_id', run_id::text, true);

  for v_item in
    select value
    from jsonb_array_elements(coalesce(v_run.diff -> 'deals', '[]'::jsonb))
  loop
    v_deal_id := v_item ->> 'id';
    v_kind := v_item ->> 'kind';
    v_incoming := v_item -> 'incoming';

    if v_kind = 'new' then
      if exists (select 1 from public.deals where id = v_deal_id) then
        raise exception using
          errcode = '40001',
          message = format('Deal %s already exists; refresh the preview before applying.', v_deal_id);
      end if;

      v_stage := (v_incoming ->> 'stage')::public.deal_stage;
      v_vertical := v_incoming ->> 'vertical';
      v_market := v_incoming ->> 'market';

      v_show_in_weekly := (
        v_stage in ('Pre LOI', 'Negotiating LOI', 'Negotiating PSA', 'In Contract')
        or (
          v_stage = 'Sourcing'
          and not exists (
            select 1
            from public.deals as existing
            where existing.stage = 'Sourcing'
              and existing.show_in_weekly
              and existing.vertical is not distinct from v_vertical
              and existing.market is not distinct from v_market
          )
        )
      );

      v_stage_entered_at := now();
      if jsonb_typeof(v_incoming -> 'attributes' -> 'days_on_market') = 'number' then
        v_days_on_market := (v_incoming -> 'attributes' ->> 'days_on_market')::numeric;
        if v_days_on_market >= 0 then
          v_stage_entered_at := now() - make_interval(days => floor(v_days_on_market)::integer);
        end if;
      end if;

      v_provenance := coalesce(
        (
          select jsonb_object_agg(field_name, 'assumed')
          from jsonb_array_elements_text(coalesce(v_incoming -> 'assumed_fields', '[]'::jsonb)) as field_name
        ),
        '{}'::jsonb
      );

      v_review_reasons := coalesce(
        array(
          select jsonb_array_elements_text(coalesce(v_incoming -> 'review_reasons', '[]'::jsonb))
        ),
        '{}'::text[]
      );

      insert into public.deals (
        id,
        source_tab,
        source_row,
        vertical,
        client,
        market,
        city,
        state,
        state_inferred,
        address,
        stage,
        stage_raw,
        stage_entered_at,
        bldg_sf,
        list_price,
        lot_sf,
        broker,
        broker_phone,
        notes,
        show_in_weekly,
        attributes,
        attributes_raw,
        field_provenance,
        needs_review,
        review_reasons,
        created_at,
        updated_by
      )
      values (
        v_deal_id,
        v_incoming ->> 'source_tab',
        (v_incoming ->> 'source_row')::integer,
        v_vertical,
        v_incoming ->> 'client',
        v_market,
        v_incoming ->> 'city',
        v_incoming ->> 'state',
        coalesce((v_incoming ->> 'state_inferred')::boolean, false),
        v_incoming ->> 'address',
        v_stage,
        v_incoming ->> 'stage_raw',
        v_stage_entered_at,
        (v_incoming ->> 'bldg_sf')::numeric,
        (v_incoming ->> 'list_price')::numeric,
        (v_incoming ->> 'lot_sf')::numeric,
        v_incoming ->> 'broker',
        v_incoming ->> 'broker_phone',
        v_incoming ->> 'notes',
        v_show_in_weekly,
        coalesce(v_incoming -> 'attributes', '{}'::jsonb),
        coalesce(v_incoming -> 'attributes_raw', '{}'::jsonb),
        v_provenance,
        coalesce((v_incoming ->> 'needs_review')::boolean, false),
        v_review_reasons,
        v_stage_entered_at,
        v_actor
      );

      insert into public.deal_history (
        deal_id,
        changed_by,
        changed_at,
        field,
        old_value,
        new_value,
        detail
      )
      values (
        v_deal_id,
        v_actor,
        now(),
        'import_created',
        null,
        jsonb_build_object(
          'stage', v_stage,
          'source_tab', v_incoming ->> 'source_tab',
          'address', v_incoming ->> 'address'
        ),
        v_history_detail
      );

      v_inserted := v_inserted + 1;

    elsif v_kind = 'changed' then
      select *
      into v_existing
      from public.deals
      where id = v_deal_id
      for update;

      if not found then
        raise exception using
          errcode = '40001',
          message = format('Deal %s was removed after preview; refresh the preview before applying.', v_deal_id);
      end if;

      v_source_tab := v_existing.source_tab;
      v_source_row := v_existing.source_row;
      v_vertical := v_existing.vertical;
      v_client := v_existing.client;
      v_market := v_existing.market;
      v_city := v_existing.city;
      v_state := v_existing.state;
      v_state_inferred := v_existing.state_inferred;
      v_address := v_existing.address;
      v_stage := v_existing.stage;
      v_stage_raw := v_existing.stage_raw;
      v_bldg_sf := v_existing.bldg_sf;
      v_list_price := v_existing.list_price;
      v_lot_sf := v_existing.lot_sf;
      v_broker := v_existing.broker;
      v_broker_phone := v_existing.broker_phone;
      v_notes := v_existing.notes;
      v_needs_review := v_existing.needs_review;
      v_review_reasons := v_existing.review_reasons;
      v_attributes := coalesce(v_existing.attributes, '{}'::jsonb);
      v_attributes_raw := coalesce(v_existing.attributes_raw, '{}'::jsonb);
      v_provenance := coalesce(v_existing.field_provenance, '{}'::jsonb);
      v_assumed_fields := coalesce(
        array(
          select jsonb_array_elements_text(coalesce(v_incoming -> 'assumed_fields', '[]'::jsonb))
        ),
        '{}'::text[]
      );
      v_has_applied_change := false;

      for v_change in
        select value
        from jsonb_array_elements(coalesce(v_item -> 'changes', '[]'::jsonb))
      loop
        v_field := v_change ->> 'field';
        v_is_conflict := coalesce((v_change ->> 'conflict')::boolean, false);

        if v_is_conflict then
          v_choice := coalesce(v_decisions -> 'conflicts' -> v_deal_id ->> v_field, 'keep_app');
          if v_choice not in ('keep_app', 'use_import') then
            raise exception using
              errcode = '22023',
              message = format('Invalid conflict choice %s for %s.%s.', v_choice, v_deal_id, v_field);
          end if;
        else
          v_choice := 'use_import';
        end if;

        if v_choice = 'keep_app' then
          v_skipped_conflicts := v_skipped_conflicts + 1;
          continue;
        end if;

        v_has_applied_change := true;

        if v_field = 'source_tab' then
          v_source_tab := v_incoming ->> 'source_tab';
        elsif v_field = 'source_row' then
          v_source_row := (v_incoming ->> 'source_row')::integer;
        elsif v_field = 'vertical' then
          v_vertical := v_incoming ->> 'vertical';
        elsif v_field = 'client' then
          v_client := v_incoming ->> 'client';
        elsif v_field = 'market' then
          v_market := v_incoming ->> 'market';
        elsif v_field = 'city' then
          v_city := v_incoming ->> 'city';
        elsif v_field = 'state' then
          v_state := v_incoming ->> 'state';
        elsif v_field = 'state_inferred' then
          v_state_inferred := coalesce((v_incoming ->> 'state_inferred')::boolean, false);
        elsif v_field = 'address' then
          v_address := v_incoming ->> 'address';
        elsif v_field = 'stage' then
          v_stage := (v_incoming ->> 'stage')::public.deal_stage;
          v_stage_raw := v_incoming ->> 'stage_raw';
        elsif v_field = 'stage_raw' then
          v_stage_raw := v_incoming ->> 'stage_raw';
        elsif v_field = 'bldg_sf' then
          v_bldg_sf := (v_incoming ->> 'bldg_sf')::numeric;
        elsif v_field = 'list_price' then
          v_list_price := (v_incoming ->> 'list_price')::numeric;
        elsif v_field = 'lot_sf' then
          v_lot_sf := (v_incoming ->> 'lot_sf')::numeric;
        elsif v_field = 'broker' then
          v_broker := v_incoming ->> 'broker';
        elsif v_field = 'broker_phone' then
          v_broker_phone := v_incoming ->> 'broker_phone';
        elsif v_field = 'notes' then
          v_notes := v_incoming ->> 'notes';
        elsif v_field = 'needs_review' then
          v_needs_review := coalesce((v_incoming ->> 'needs_review')::boolean, false);
        elsif v_field = 'review_reasons' then
          v_review_reasons := coalesce(
            array(
              select jsonb_array_elements_text(coalesce(v_incoming -> 'review_reasons', '[]'::jsonb))
            ),
            '{}'::text[]
          );
        elsif v_field like 'attributes.%' then
          v_attr_key := substring(v_field from 12);
          if (v_incoming -> 'attributes') ? v_attr_key then
            v_attributes := jsonb_set(
              v_attributes,
              array[v_attr_key],
              coalesce(v_incoming -> 'attributes' -> v_attr_key, 'null'::jsonb),
              true
            );
          else
            v_attributes := v_attributes - v_attr_key;
          end if;

          if (v_incoming -> 'attributes_raw') ? v_attr_key then
            v_attributes_raw := jsonb_set(
              v_attributes_raw,
              array[v_attr_key],
              coalesce(v_incoming -> 'attributes_raw' -> v_attr_key, 'null'::jsonb),
              true
            );
          else
            v_attributes_raw := v_attributes_raw - v_attr_key;
          end if;

          if v_attr_key = any (v_assumed_fields) then
            v_provenance := jsonb_set(v_provenance, array[v_attr_key], '"assumed"'::jsonb, true);
          else
            v_provenance := v_provenance - v_attr_key;
          end if;
        end if;

        if v_field not like 'attributes.%' then
          if v_field = any (v_assumed_fields) then
            v_provenance := jsonb_set(v_provenance, array[v_field], '"assumed"'::jsonb, true);
          elsif v_provenance ? v_field and v_provenance ->> v_field in ('assumed', 'confirmed') then
            v_provenance := v_provenance - v_field;
          end if;
        end if;
      end loop;

      if v_has_applied_change then
        update public.deals
        set source_tab = v_source_tab,
            source_row = v_source_row,
            vertical = v_vertical,
            client = v_client,
            market = v_market,
            city = v_city,
            state = v_state,
            state_inferred = v_state_inferred,
            address = v_address,
            stage = v_stage,
            stage_raw = v_stage_raw,
            bldg_sf = v_bldg_sf,
            list_price = v_list_price,
            lot_sf = v_lot_sf,
            broker = v_broker,
            broker_phone = v_broker_phone,
            notes = v_notes,
            needs_review = v_needs_review,
            review_reasons = v_review_reasons,
            attributes = v_attributes,
            attributes_raw = v_attributes_raw,
            field_provenance = v_provenance
        where id = v_deal_id;

        v_updated := v_updated + 1;
      end if;

    elsif v_kind = 'missing' then
      v_missing_choice := coalesce(v_decisions -> 'missing' ->> v_deal_id, 'leave');
      if v_missing_choice not in ('leave', 'mark_on_hold') then
        raise exception using
          errcode = '22023',
          message = format('Invalid missing-deal choice %s for %s.', v_missing_choice, v_deal_id);
      end if;

      if v_missing_choice = 'mark_on_hold' then
        update public.deals
        set stage = 'On Hold'
        where id = v_deal_id
          and stage is distinct from 'On Hold';

        if found then
          v_marked_on_hold := v_marked_on_hold + 1;
        end if;
      end if;
    end if;
  end loop;

  -- Upsert parsed contacts when present in the workbook.
  for v_contact in
    select value
    from jsonb_array_elements(coalesce(v_run.diff -> 'contacts', '[]'::jsonb))
  loop
    insert into public.contacts (
      id,
      contact_name,
      company,
      client,
      vertical,
      title,
      office,
      mobile,
      email,
      notes,
      attributes,
      linked_deals
    )
    values (
      v_contact ->> 'id',
      v_contact ->> 'contact_name',
      v_contact ->> 'company',
      v_contact ->> 'client',
      v_contact ->> 'vertical',
      v_contact ->> 'title',
      v_contact ->> 'office',
      v_contact ->> 'mobile',
      v_contact ->> 'email',
      v_contact ->> 'notes',
      coalesce(v_contact -> 'attributes', '{}'::jsonb),
      coalesce(
        array(
          select jsonb_array_elements_text(coalesce(v_contact -> 'linked_deals', '[]'::jsonb))
        ),
        '{}'::text[]
      )
    )
    on conflict (id) do update
    set contact_name = excluded.contact_name,
        company = excluded.company,
        client = excluded.client,
        vertical = excluded.vertical,
        title = excluded.title,
        office = excluded.office,
        mobile = excluded.mobile,
        email = excluded.email,
        notes = excluded.notes,
        attributes = excluded.attributes,
        linked_deals = excluded.linked_deals;

    v_contacts_upserted := v_contacts_upserted + 1;
  end loop;

  -- Update source_tabs metadata (last_imported_at and row_count) for every deal tab.
  for v_tab in
    select value
    from jsonb_array_elements(coalesce(v_run.diff -> 'tabs', '[]'::jsonb))
  loop
    v_tab_name := v_tab ->> 'tab_name';
    v_tab_rows := coalesce((v_tab ->> 'source_rows')::integer, 0);
    v_tab_prefix := nullif(v_tab ->> 'tab_prefix', '');

    if v_tab_prefix is not null and not exists (
      select 1 from public.vertical_config where tab_prefix = v_tab_prefix
    ) then
      v_tab_prefix := null;
    end if;

    insert into public.source_tabs (
      tab_name,
      tab_prefix,
      client,
      market,
      last_imported_at,
      row_count,
      active
    )
    values (
      v_tab_name,
      v_tab_prefix,
      nullif(v_tab ->> 'client', ''),
      nullif(v_tab ->> 'market', ''),
      now(),
      v_tab_rows,
      true
    )
    on conflict (tab_name) do update
    set last_imported_at = now(),
        row_count = excluded.row_count;
  end loop;

  v_result := jsonb_build_object(
    'run_id', run_id,
    'inserted', v_inserted,
    'updated', v_updated,
    'marked_on_hold', v_marked_on_hold,
    'skipped_conflicts', v_skipped_conflicts,
    'contacts_upserted', v_contacts_upserted
  );

  update public.import_runs
  set status = 'applied',
      applied_at = now(),
      applied_by = v_actor,
      summary = v_run.summary || jsonb_build_object('applied', v_result)
  where id = run_id;

  insert into public.activity_log (user_id, event, path, detail)
  values (
    v_actor,
    'import',
    '/admin',
    jsonb_build_object(
      'run_id', run_id,
      'file_name', v_run.file_name,
      'file_sha256', v_run.file_sha256,
      'applied', v_result,
      'summary', v_run.summary
    )
  );

  return v_result;
end;
$$;

revoke all on function public.apply_import(bigint, jsonb) from public;
grant execute on function public.apply_import(bigint, jsonb) to authenticated;
