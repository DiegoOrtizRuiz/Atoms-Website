alter table public.deal_history
  add column seed_source text;

create index deal_history_seed_source_idx
  on public.deal_history (seed_source)
  where seed_source is not null;

comment on column public.deal_history.seed_source is
  'Marks reproducible generated history rows so repeatable seed runs can replace them safely.';
