# Project: Site Pipeline (S&P RE case study)

A cloud-hosted app that replaces a messy multi-tab Google Sheet + a hand-built weekly slide deck.
ONE dataset (Supabase Postgres) powers THREE views: Operations grid, Weekly Review, Admin (users/permissions/logs).
Two disconnected data sources is a FAIL condition. Never duplicate deal data into a second store.

## Cloud hosting (a deliverable, not an afterthought)
- Production = Vercel (Next.js app) + Supabase cloud (Postgres, Auth, Realtime). Deployed from the FIRST phase; every phase ends deployed.
- `main` branch auto-deploys to production; PRs get Vercel preview URLs. CI in `.github/workflows/ci.yml` must pass (pytest importer tests, lint, typecheck, build).
- Public sign-up is disabled; users are created by admin (invite) or the seed script. Seeded users are created with email already confirmed.
- `/api/health` returns `{ok, db: true|false, deals: <count>, version: <git sha>}` for uptime checks.
- Free-tier Supabase pauses after ~7 days idle: `.github/workflows/keepalive.yml` pings `/api/health` daily so reviewers never hit a paused project.

## Stack (do not deviate without asking)
- Next.js 15 App Router, TypeScript strict, Tailwind, shadcn/ui
- Supabase: Postgres + Auth (email/password) + Row Level Security. Use `@supabase/ssr`.
- AG Grid Community for the operations table
- pptxgenjs for weekly deck export (client-side)
- Python 3.11 scripts in `/scripts` for import + LLM enrichment (run locally, not in the web app)
- Deploy: Vercel. Secrets only in env vars (`.env.local`, Vercel settings). Never hardcode keys.

## Domain rules (critical)
- Funnel stages, in order: Sourcing, In Pipeline, Pre LOI, Negotiating LOI, Negotiating PSA, In Contract, Closed, On Hold.
  Plus `Needs review` for anything unmapped. Store as Postgres enum `deal_stage`.
- Always keep raw values next to normalized ones (`stage_raw`, `attributes_raw`). Never overwrite source data.
- `market` = the client's search metro (what leadership groups by). `city`/`state` = where the property actually is. They often differ; that is valid.
- Blank means unknown. Render blanks as "—". Never coerce null to 0. Never show `null`, `NaN`, `undefined`, `$0` for missing.
- Derived numbers ($/SF, $/Lot SF) are computed from inputs (generated columns), never typed in.
- Vertical-specific columns (zoning, clear height, doors, power, miles from airport, rent/SF…) live in `attributes jsonb`. Which ones show per vertical comes from `vertical_config.columns`. No per-vertical tables, no per-vertical components.
- Provenance per field in `field_provenance jsonb`: `{ "<field>": "assumed" | "llm_suggested" | "confirmed" }`. Absent = from source.
  Assumed = was colored text in the sheet. Render assumed/llm_suggested values distinctly (italic + colored dot + tooltip) and offer "Confirm" to permitted roles.
- Provenance works BOTH ways: editors can mark a value they enter as "assumed" (the old "colored text" habit) and permitted roles can later confirm it.
- Concurrency (>20 users at once): optimistic locking on `deals.version`, Supabase Realtime subscription on `deals` so open grids/weekly views update live, and Realtime Presence to show who is online / viewing.
- LLM output never overwrites source fields. It goes into `notes_extracted jsonb` and `weekly_note` with provenance `llm_suggested`.

## Roles & permissions (enforced by RLS, not just UI)
| role | read deals | edit deals | confirm assumptions | weekly view | admin pages |
|---|---|---|---|---|---|
| admin | all | all | yes | yes | yes |
| leadership | all | no | no | yes (default landing) | no |
| acq_lead | all | deals in `profiles.verticals` | yes (own verticals) | yes | no |
| analyst | all | deals whose `client` in `profiles.clients` | no | yes | no |
| viewer | all | no | no | yes | no |

Every deal edit writes a `deal_history` row (trigger). Every login and page view writes an `activity_log` row.

## Conventions
- Server components for data reads; server actions for mutations. Validate with zod.
- Generate DB types with `supabase gen types typescript` into `src/lib/database.types.ts` and use them.
- Formatting helpers in `src/lib/format.ts` (`fmtMoney`, `fmtNumber`, `fmtOrDash`). Use them everywhere.
- Small focused files. No dead code. No mock data in the app; data comes from Supabase.
- After any change touching the DB, update `supabase/migrations/` (new numbered file) — never edit an applied migration.
- When unsure about a data decision, stop and ask instead of guessing. Data decisions get logged in PROCESS_LOG.md.
