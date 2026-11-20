# Process log

Tool: VS Code + GitHub Copilot (Agent mode, Copilot SDK). Project instructions in `.github/copilot-instructions.md`; one reusable prompt per phase in `.github/prompts/`.

## Approach (1 paragraph)
_Audited the workbook first, wrote a deterministic normalizer with tests before any UI, then built the three views on one Supabase table. LLM used only for unstructured notes and unknown labels — always as labeled suggestions a human confirms._

## Data assumptions
- No config tab in the file → recreated vertical mapping from tab prefixes (food/av/catering) and target_weekly_view names.
- `Metro` = client's search market (leadership groups by it); city/state = property location. Mismatches are valid, not errors.
- `Listed` is not a funnel stage (sell-side wording, "market prep") → Needs review, not guessed.
- `Under Contract` → In Contract. `nego PSA` → Negotiating PSA. Raw value always kept.
- Rows with no address (Sourcing) are search efforts and count in the pipeline.
- Blank ≠ 0 (DH Doors 0 means none; blank means unknown).
- $/SF recomputed from inputs; sheet value for 37 S Hudson St ($217.79) disagrees with inputs ($217.77) → flagged.
- Colored text = assumption; tracked per field. Only one in the file (400A power, 635 Angier Ave).
- Food tab has no State → inferred from city, flagged `state_inferred`.
- Clear height `15-51` uninterpretable → kept raw, flagged. Decimal heights assumed to be feet (could be ft-in).
- Year-less note dates resolved to next occurrence after import date.
- Weekly view row selection inferred from target_weekly_view: Pre LOI and later + one Sourcing per market; editable via `show_in_weekly`.
- Days in stage backdated from Days On Market where present, else import time.

## Hosting decisions
- Vercel (Next.js) + Supabase cloud (Postgres/Auth/Realtime), same region. Live from phase 1; every phase ends deployed.
- CI (GitHub Actions): importer tests + lint + typecheck + build on every push/PR; Vercel previews per PR.
- Invite-only auth (public sign-up disabled); service key server-side only; security headers.
- Daily keep-alive ping to `/api/health` so the free-tier DB never pauses during review.

## Phase log
| Phase | Asked Copilot for | What I fixed / redirected by hand | Time |
|---|---|---|---|
| 0 Audit | | | |
| 1 Scaffold | Build the Next.js 15, TypeScript, Tailwind, shadcn, and Supabase app shell with auth, protected navigation, health endpoint, formatting helpers, and security headers. | Kept database-dependent queries non-fatal until schema deployment; used explicit configuration errors during sign-in. | Passed lint, typecheck, and build |
| 2 Schema/RLS | Add the canonical Postgres schema, RLS policies, audit/version triggers, provenance permission checks, stage rollup view, and typed Supabase clients. | Applied the migration to local PostgreSQL, exercised role-scoped updates and triggers, and generated `database.types.ts` from that schema. Production application awaits Supabase credentials. | Passed |
| 3 Seed | Add an idempotent Supabase seed for canonical deal/contact records, 25 confirmed demo users, and 30 days of realistic activity/history. | Applied both migrations manually, fixed npm Python resolution, and seeded the configured project. Reconciliation: 18 deals, 5 contacts, 25 active users, 11 weekly rows, 1 assumption, 1,527 activity rows, and 40 seeded history rows. | Passed on cloud |
| 4 LLM enrich | Add an optional local Anthropic/OpenAI notes-enrichment workflow with strict JSON, exact evidence, caching, and per-field evaluation. | Generated output changes only `notes_extracted`, `weekly_note`, and their `llm_suggested` provenance. Added 18 TODO-verify labels, deterministic year-less date handling after 2026-11-18, and offline tests. No provider model/key is configured, so cloud-quality scoring awaits a real provider run and label verification. | Local validation passed; provider run pending credentials |
| 5 Operations | Build the AG Grid operations workspace with shared URL filters, role-aware editing, optimistic locking, provenance actions, live collaboration, presence, and the deal drawer. | Verified against production Supabase with all 18 rows: filters and drawer render, analyst Client A/Client B edit scope differs correctly, consecutive edits refresh versions, conflicts reload with a toast, and confirm/re-mark preserves the assumption. Added a 5-second RLS-safe live fallback; apply migration 0003 to enable native `deals` Realtime publication. | Passed browser, lint, typecheck, build, and 32 tests |
| 6 Weekly | Build the grouped weekly review, attention strip, live updates, all-deals mode, presentation view, snapshots, comparison markers, and client-side PPTX export. | Screen and PPTX use one shared weekly model. Browser validation showed 11 default rows, 18 with “Show all,” three vertical sections, keyboard presentation, 5 valid PPTX slides, and a snapshot with 18 rows. Live note updates appeared without refresh; generated test changes were restored. | Passed browser, lint, typecheck, build, and 32 tests |
| 7 Admin | | | |
| 8 Stretch | | | |
| 9 Cloud import | | | |
| 10 Review fixes | Fix importer CI, weekly attention dates and new-deal ordering, snapshot permissions, history, deck provenance, typed attributes, and column-level RLS. | Tracked the workbook and removed generated files; added deterministic date extraction and tests; backfilled and preserved deal creation dates; aligned snapshot RLS; added named, quieter history and attribute diffs; unified unconfirmed formatting; validated attribute types and retained provenance; restricted editor columns and renamed the role helper. Applied migration 0004 and reseeded; production RLS and local browser against production data passed. Deployed-site UI verification remains pending: no Vercel login or production URL was available. | Lint, typecheck, 13 web tests, build, and 42 Python tests passed |

## What I'd do next
- Two-way Google Sheets sync during migration, then retire the sheet.
- Scheduled weekly snapshot + email/Slack of the deck to leadership.
- SSO (Google Workspace) instead of passwords; field-level audit export.
- Scale import to 170 tabs: config-driven, LLM-assisted header mapping with human approval.
