create or replace view public.v_user_usage
with (security_invoker = true)
as
select
  profile.id as user_id,
  max(activity.created_at) filter (
    where activity.event in ('login', 'page_view')
  ) as last_active,
  max(activity.created_at) filter (where activity.event = 'login') as last_login,
  count(*) filter (
    where activity.event = 'login'
      and activity.created_at >= now() - interval '7 days'
  )::bigint as logins_7d,
  count(*) filter (
    where activity.event = 'login'
      and activity.created_at >= now() - interval '30 days'
  )::bigint as logins_30d,
  (
    select count(*)::bigint
    from public.deal_history as history
    where history.changed_by = profile.id
      and history.changed_at >= now() - interval '7 days'
  ) as edits_7d,
  count(*) filter (
    where activity.event = 'page_view'
      and activity.created_at >= now() - interval '7 days'
  )::bigint as page_views_7d,
  (
    select page_activity.path
    from public.activity_log as page_activity
    where page_activity.user_id = profile.id
      and page_activity.event = 'page_view'
      and page_activity.created_at >= now() - interval '7 days'
      and page_activity.path is not null
    group by page_activity.path
    order by count(*) desc, page_activity.path
    limit 1
  ) as top_page
from public.profiles as profile
left join public.activity_log as activity on activity.user_id = profile.id
group by profile.id;

grant select on public.v_user_usage to authenticated;

create or replace function public.admin_logins_per_day(days integer)
returns table(day date, login_count bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if public.app_role() is distinct from 'admin' then
    raise exception using
      errcode = '42501',
      message = 'Only administrators can view login activity.';
  end if;

  if days is null or days < 1 or days > 365 then
    raise exception using
      errcode = '22023',
      message = 'Days must be between 1 and 365.';
  end if;

  return query
  select calendar.day::date, count(activity.id)::bigint
  from generate_series(
    current_date - (days - 1),
    current_date,
    interval '1 day'
  ) as calendar(day)
  left join public.activity_log as activity
    on activity.event = 'login'
    and activity.created_at >= calendar.day
    and activity.created_at < calendar.day + interval '1 day'
  group by calendar.day
  order by calendar.day;
end;
$$;

revoke all on function public.admin_logins_per_day(integer) from public;
grant execute on function public.admin_logins_per_day(integer) to authenticated;
