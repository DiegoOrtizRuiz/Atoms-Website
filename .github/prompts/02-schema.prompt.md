---
mode: agent
description: Phase 2 — Supabase schema, RLS, triggers
---
Create `supabase/migrations/0001_init.sql` following #file:../copilot-instructions.md and the shape of #file:../../out/deals.json

Tables:
- `vertical_config(tab_prefix text pk, vertical text unique, sort_order int, columns jsonb)` — `columns` = ordered list of `{key, label, type}` attribute columns to show for that vertical.
- `deals` — one row per object in deals.json. Columns: id text pk (keep source id like `food_clientA_nyc:2`), source_tab, source_row, vertical, client, market, city, state, state_inferred bool, address, stage deal_stage, stage_raw, stage_entered_at timestamptz default now(), bldg_sf numeric, list_price numeric, lot_sf numeric,
  price_per_sf numeric GENERATED ALWAYS AS (round(list_price / nullif(bldg_sf,0), 2)) STORED,
  price_per_lot_sf numeric GENERATED ALWAYS AS (round(list_price / nullif(lot_sf,0), 2)) STORED,
  broker, broker_phone, notes, weekly_note, show_in_weekly bool, attributes jsonb default '{}', attributes_raw jsonb default '{}', field_provenance jsonb default '{}', notes_extracted jsonb, needs_review bool, review_reasons text[], version int default 1, updated_at, updated_by uuid.
- `deal_history(id bigserial, deal_id, changed_by uuid, changed_at, field text, old_value jsonb, new_value jsonb)`
- `contacts` — from contacts.json, plus `linked_deals text[]`.
- `profiles(id uuid pk references auth.users, full_name, email, role user_role, verticals text[] default '{}', clients text[] default '{}', active bool default true, created_at)`
- `activity_log(id bigserial, user_id uuid, event text, path text, detail jsonb, created_at timestamptz default now())`
- `weekly_snapshots(id bigserial, week_start date unique, created_by uuid, data jsonb, created_at)`

Enums: `deal_stage` (8 stages + 'Needs review'), `user_role` (admin, leadership, acq_lead, analyst, viewer).

Triggers:
- `deals` BEFORE UPDATE: bump version, set updated_at/updated_by = auth.uid(); if stage changed set stage_entered_at = now().
- `deals` AFTER UPDATE: insert one deal_history row per changed column (compare OLD/NEW via jsonb).

RLS (enable on every table):
- helper `current_role()` and `current_profile()` SECURITY DEFINER functions reading profiles for auth.uid(); inactive users get no access.
- deals: SELECT for any active user. UPDATE allowed if admin; or acq_lead and vertical = any(verticals); or analyst and client = any(clients). Leadership/viewer: no UPDATE.
- A separate check so only admin/acq_lead can change `field_provenance` values to 'confirmed' (implement via trigger that raises if role not permitted).
- profiles: users read their own; admin reads/writes all.
- activity_log: insert own rows; admin reads all.
- deal_history, contacts, vertical_config, weekly_snapshots: read for active users; writes admin only (history written by trigger as definer).

Also add a view `v_stage_rollup` (vertical, market, stage, count, avg days in stage).
Then generate TS types into `src/lib/database.types.ts`. Explain each RLS policy in one line at the end.
