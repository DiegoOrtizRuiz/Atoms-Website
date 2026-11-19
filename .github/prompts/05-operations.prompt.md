---
mode: agent
description: Phase 5 — Operations grid (filterable, editable)
---
Build `/deals` following #file:../copilot-instructions.md

- Server component loads deals + vertical_config + current profile; client component renders AG Grid.
- Filter bar (shadcn selects, multi-select): Client, Vertical, Market, Stage, plus toggles "Needs review only" and "Has assumptions". Filters sync to URL query params so a view can be shared.
- Stage filter shows funnel order and counts per stage.
- Columns: Vertical, Client, Market, Address (— if null, show city/state underneath in muted text), Stage (colored pill; shows stage_raw in tooltip if different), Bldg SF, List Price, $/SF, Lot SF, Broker, Notes (truncate, full in tooltip), Updated.
  When exactly one vertical is selected, append that vertical's attribute columns from vertical_config.columns.
- Editing: inline cell edit only if the user can edit that row (compute `canEdit(profile, deal)` in one shared helper used by UI; RLS is the real guard). Editable: stage (dropdown of enum), bldg_sf, list_price, lot_sf, broker, broker_phone, notes, weekly_note, show_in_weekly, attribute fields.
  Save via server action with optimistic concurrency (`where version = :version`); on conflict show a toast "Someone else edited this deal — reloaded".
- Provenance styling: assumed / llm_suggested cells italic with a colored dot + tooltip ("Assumption — not yet confirmed"). Permitted roles get a "Confirm" item in the cell context menu.
- Editors can toggle "Mark as assumption" on any value they edit (sets provenance 'assumed'), mirroring the team's colored-text habit.
- Realtime: subscribe to `deals` changes (Supabase Realtime); update rows in place and briefly highlight rows changed by someone else. Show avatars of users currently viewing /deals (Realtime Presence).
- Row click opens a side drawer: all fields, raw values, review_reasons, notes_extracted (risks, key dates, price_context with evidence quotes), and the deal_history timeline.
- "Needs review" badge in the page header with count; clicking applies the filter.
- Log a `page_view` to activity_log on load.
Never render null/NaN/0 for blanks — use fmtOrDash.
