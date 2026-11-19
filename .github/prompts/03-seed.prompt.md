---
mode: agent
description: Phase 3 — seed data, users and realistic activity
---
Write `scripts/seed.py` (supabase-py, uses SUPABASE_SERVICE_ROLE_KEY from env) that is idempotent (upsert by id):

1. Upsert `vertical_config` for food / av / catering with columns:
   - Food: none extra (core only)
   - Autonomous Vehicle: zoning, clear_height_ft, dock_high_doors, power_amps, property_type, listing_status, days_on_market
   - Airline Catering: zoning, miles_from_airport, clear_height_ft, dock_high_doors, grade_level_doors, power_amps, rent_per_sf, property_type, listing_status, days_on_market
2. Upsert every deal from `out/deals.json` (and `out/deals_enriched.json` if it exists — enriched wins). Map assumed_fields -> field_provenance {"<field>":"assumed"}.
   Set `show_in_weekly` default: stage in (Pre LOI, Negotiating LOI, Negotiating PSA, In Contract) OR it is the first Sourcing row of its (vertical, market).
   Backdate `stage_entered_at` deterministically from attributes.days_on_market if present, else import time (log this assumption).
3. Upsert contacts from `out/contacts.json`.
4. Create 25 auth users via admin API with password from env DEMO_PASSWORD and matching profiles:
   1 admin, 3 leadership, 4 acq_lead (split across the 3 verticals), 10 analyst (each assigned 1–2 clients), 7 viewer.
   Always include these demo accounts: admin@demo.test, leadership@demo.test, lead.food@demo.test, analyst.a@demo.test (client "Client A"), viewer@demo.test.
5. Generate 30 days of plausible activity_log rows (logins weighted to weekdays/mornings, page views, ~40 deal edits written through deal_history with realistic stage moves).
6. Print a reconciliation summary: deals in json vs deals in DB, users created, activity rows.

Fail loudly if counts don't match. Then add `npm run seed` -> `python scripts/seed.py`.
