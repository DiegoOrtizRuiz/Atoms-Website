alter table public.profiles
  add column must_change_password boolean not null default false;

create or replace function public.current_user_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((public.current_profile()).active
    and not (public.current_profile()).must_change_password, false);
$$;

create or replace function public.app_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.current_user_active() then (public.current_profile()).role else null end;
$$;

drop policy "users read own profile" on public.profiles;
create policy "users read own profile" on public.profiles for select
to authenticated using (
  (id = auth.uid() and (public.current_profile()).active)
  or public.app_role() = 'admin'
);

drop policy "users create own activity" on public.activity_log;
create policy "users create own activity" on public.activity_log for insert
to authenticated with check (
  user_id = auth.uid()
  and (public.current_user_active() or (
    (public.current_profile()).active
    and event in ('login', 'password_set')
  ))
);
