-- Run as a privileged database user after migration 0004. All writes roll back.
begin;

do $$
declare
  analyst_id uuid;
  viewer_id uuid;
  leadership_id uuid;
  client_a_id text;
  client_b_id text;
begin
  select id into analyst_id from public.profiles
    where email = 'analyst.a@demo.test' and active
      and role = 'analyst' and 'Client A' = any(clients)
      and not ('Client B' = any(clients));
  select id into viewer_id from public.profiles
    where email = 'viewer@demo.test' and active and role = 'viewer';
  select id into leadership_id from public.profiles
    where email = 'leadership@demo.test' and active and role = 'leadership';
  select id into client_a_id from public.deals where client = 'Client A' limit 1;
  select id into client_b_id from public.deals where client = 'Client B' limit 1;
  if analyst_id is null or viewer_id is null or leadership_id is null
    or client_a_id is null or client_b_id is null then
    raise exception 'RLS test requires active demo users, analyst.a scoped only to Client A, and Client A/B deals.';
  end if;
  perform set_config('test.analyst_id', analyst_id::text, true);
  perform set_config('test.viewer_id', viewer_id::text, true);
  perform set_config('test.leadership_id', leadership_id::text, true);
  perform set_config('test.client_a_id', client_a_id, true);
  perform set_config('test.client_b_id', client_b_id, true);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.analyst_id'), true);
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('test.analyst_id'), 'role', 'authenticated')::text,
  true
);

do $$
declare
  affected integer;
begin
  update public.deals
  set stage = case when stage = 'On Hold' then 'Sourcing'::public.deal_stage
                   else 'On Hold'::public.deal_stage end
  where id = current_setting('test.client_a_id');
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Analyst could not update Client A stage'; end if;

  update public.deals set stage = 'On Hold'
  where id = current_setting('test.client_b_id');
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Analyst updated Client B'; end if;

  begin
    update public.deals set needs_review = true
    where id = current_setting('test.client_a_id');
    raise exception 'Analyst updated needs_review';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.deals set review_reasons = array['RLS test']
    where id = current_setting('test.client_a_id');
    raise exception 'Analyst updated review_reasons';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('test.viewer_id'), true);
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('test.viewer_id'), 'role', 'authenticated')::text,
  true
);
do $$
declare
  affected integer;
begin
  update public.deals set stage = 'On Hold'
  where id = current_setting('test.client_a_id');
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Viewer updated a deal'; end if;
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('test.leadership_id'), true);
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('test.leadership_id'), 'role', 'authenticated')::text,
  true
);
do $$
declare
  affected integer;
begin
  insert into public.weekly_snapshots (week_start, created_by, data)
  select day::date, current_setting('test.leadership_id')::uuid, '{}'::jsonb
  from generate_series('1800-01-01'::date, '1800-12-31'::date, interval '1 day') as day
  where not exists (
    select 1 from public.weekly_snapshots where week_start = day::date
  )
  limit 1;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Leadership could not insert a snapshot'; end if;
end;
$$;

rollback;
