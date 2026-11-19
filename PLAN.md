# Implementation plan — VS Code + GitHub Copilot

Goal: **one cloud-hosted website**, one Supabase dataset, three views (Operations, Weekly Review, User logs & Permissions). Time box 3–5 h, so work in priority tiers (see §5).

---

## 1. Requirements traceability (every line of the brief → where it's covered → how to verify)

| # | Brief requirement | Where in the build | Verify |
|---|---|---|---|
| R1 | "single working **cloud hosted** website" / submit "a link" | Vercel (app) + Supabase cloud (DB, Auth, Realtime), live from phase 1; CI + preview deploys; `/api/health`; keep-alive job | Private window → production URL → log in as each demo role; `/api/health` → `ok:true` |
| R2 | Operational view: filterable by client, vertical, market, funnel stage | `/deals` filters synced to URL, stage counts in funnel order | Filter Food + Negotiating PSA → only 2 Hialeah + Chicago deals |
| R3 | …**editable** table across all deals | Inline edit, server actions, optimistic locking, deal_history | Edit stage → history row; two tabs → conflict message |
| R4 | Funnel Sourcing → … → Closed / On Hold | `deal_stage` enum (+ Needs review) | All 13 raw spellings map (pytest) |
| R5 | "replacement for scrolling through **170 tabs**" | Config-driven verticals (`vertical_config`), header-name mapping, in-app import (phase 9) | Adding a vertical = 1 config row, no code |
| R6 | Weekly view grouped by vertical, mirrors target_weekly_view, **generated automatically** | `/weekly` from the same table, `show_in_weekly`, `weekly_note` | Rows/columns match target_weekly_view for the same deals |
| R7 | "no one should ever manually retype a row into a slide" | One-click PPTX export + presentation mode | PPTX rows == screen rows |
| R8 | Usable by **non-technical partner in a live meeting** | Needs-attention strip (e.g. Seattle closes 11/25), $11.0M formatting, "—" blanks, big-type present mode, live updates, iPad-friendly | Demo script §7 |
| R9 | Usage & logins **by person** | Admin usage dashboard (per-user logins/edits/last seen), Online now (Presence), `/me` My activity | Your own test logins appear |
| R10 | Permission sets by users | 5 roles + per-user verticals/clients, enforced by **RLS**; permission matrix card; View-as | Analyst can't edit Client B even via direct API call |
| R11 | ">20 distinct users **at once**, different roles" | 25 seeded users, optimistic locking, Realtime updates, Presence, invite-only auth | Two browsers editing simultaneously; online list shows both |
| R12 | "whatever else a website of this nature should include" | Audit log + CSV export, password reset, data-health page, import with dry-run diff, security headers, disabled public sign-up | Checklist in §6 |
| R13 | Inconsistent statuses, blanks, mixed notes | `normalize.py` + 25 tests; LLM suggestions only for notes | `pytest` 25 passed |
| R14 | Colored text = **assumption** vs trusted data | `field_provenance` per field; assumed styling + legend; **Mark as assumption** + **Confirm** | Confirm 400A on 635 Angier Ave → styling gone, history row |
| R15 | Both views from same dataset — two tools = FAIL | Single `deals` table; no copies | Edit in /deals shows live in /weekly |
| S1 | Stretch: rollup by stage, days in stage, contact_tracker cross-ref | `/rollup`, `v_stage_rollup`, phone-match links | James Ford ↔ 635 Angier Ave |
| S2 | Stretch: Google Map, hover → demographics & site info | Census geocoding + ACS tract demographics, Maps JS | Hover a pin |
| D1–D5 | Link · flowchart · process log · AI conversation · next steps | §8 checklist | — |

---

## 2. Cloud architecture

```
Browser ──HTTPS──> Vercel (Next.js: pages, server actions, /api/health, PPTX in browser)
                     │  supabase-js (anon key + user JWT)        GitHub ── push ──> CI (pytest, lint, tsc, build)
                     ▼                                                    └──> Vercel preview (PR) / production (main)
               Supabase cloud: Postgres (RLS) · Auth · Realtime/Presence
                     ▲
       scripts/ (seed, LLM enrich, geocode) — run locally with service key; phase 9 moves import into the app
```

Hosting decisions to state in your log:
- **Region:** put Supabase and Vercel functions in the same region (e.g. `us-east-1` / `iad1`) to keep latency low.
- **Free-tier risks and fixes:** Supabase free projects pause after about a week idle, so `keepalive.yml` pings daily (set the repo variable `APP_URL`). Vercel preview URLs sit behind Vercel login by default, so send reviewers the **production** URL.
- **Auth:** turn off public sign-ups in Supabase Auth settings. The seed creates users with email already confirmed.
- **Secrets:** the service role key lives only in Vercel env vars and your local `.env.local`, never in client code or chat.
- **Google Maps (stretch):** needs a billing-enabled key restricted to your production domain.

---

## 3. Setup (15 min)

1. `mkdir site-pipeline && cd site-pipeline && git init`, then unzip this kit into it.
2. Put the workbook at `data/src.xlsx` (fictional data, safe to commit, and CI needs it). Then run:
   ```bash
   pip install openpyxl pytest supabase anthropic
   python scripts/normalize.py data/src.xlsx out
   WORKBOOK=data/src.xlsx pytest -q scripts/test_import.py    # 25 passed -> screenshot
   ```
3. Create the Supabase project (pick the region) and turn off public sign-ups. Put the URL and keys in `.env.local`.
4. Create the GitHub repo, push, import it into Vercel, and add the env vars in Vercel. Set the repo variable `APP_URL` after the first deploy.
5. In VS Code: open Copilot Chat in **Agent** mode with the strongest model available, and check that instruction files are enabled (`github.copilot.chat.codeGeneration.useInstructionFiles`). Optional: the Supabase MCP server.

## 4. Copilot workflow rules

- Start a **new chat per phase** and run the prompt by typing `/01-scaffold`, `/02-schema`…
- **Push after every phase that passes its check.** CI runs and production redeploys, so the cloud link always works.
- If Copilot drifts, `git restore .` and run the prompt again with a correction. Write the correction in PROCESS_LOG.
- Read every diff before you click Keep. Reject mock data, hardcoded rows, and nulls turned into 0.
- Reference files with `#file:`. Use `#codebase` only when Copilot needs to search.
- Export each chat (Command Palette → *Chat: Export…*) for the AI-conversation deliverable.

## 5. Phases, priority tiers and gates

**Tier 1, the core (must ship, about 4 h):**

| # | Prompt | Time | Gate |
|---|---|---|---|
| 1 | `/01-scaffold` + first deploy | 30 min | Production URL live; `/login` works; `/api/health` responds; CI green |
| 2 | `/02-schema` | 35 min | Migration applied; RLS on for every table; types generated |
| 3 | `/03-seed` | 25 min | `18 json = 18 db`; 25 users; demo logins work on production |
| 5 | `/05-operations` | 60 min | R2, R3, R10, R14 checks pass on production |
| 6 | `/06-weekly` | 50 min | R6–R8, R15 checks pass; PPTX matches screen |
| 7 | `/07-admin` | 35 min | R9, R11, R12 checks pass; viewer gets 403 on /admin |

**Tier 2 (adds judgment points, about 45 min):** `/04-llm-enrich`, limited to notes extraction and weekly note. Report the accuracy number in the log.

**Tier 3 (only if Tier 1 is solid):** `/09-cloud-import` (moves ingestion into the hosted app), then `/08-stretch` (rollup first, then the map).

If you fall behind, cut in this order: map, then cloud import, then rollup, then LLM, then admin extras (Data health, CSV export). **Never cut:** the importer tests, the single dataset, PPTX export, RLS, or the production URL.

## 6. Verification on production (10 min, after Tier 1)

1. **analyst.a** edits the Client A Chicago stage: it saves. A Client B row is read-only, and a forced request is rejected by RLS.
2. **admin** confirms 400A on 635 Angier Ave: the assumed styling disappears and a history row is written. **lead.food** marks a new value as an assumption: the styling appears.
3. **leadership** on /weekly, open in a second browser: the Chicago change shows up live under "Changed this week". Export the PPTX and compare it to the screen.
4. Data checks: no null, NaN or $0; Seattle shows $217.77 with a review badge; Listed shows as Needs review.
5. **admin** /admin: "Online now" shows both browsers; your logins appear in the usage dashboard; CSV export works.
6. Same cell edited in two tabs: the second save shows the conflict message.
7. `/api/health` returns `ok:true`; a private window gets redirected to login; signing up as a new user is impossible.

## 7. Two-minute demo script

1. Show the import report: 18 rows in, 18 deals out, 13 status spellings, 4 flagged, nothing dropped, and one $/SF error caught.
2. Operations: filter, edit, open the drawer (history, LLM risks with quotes), then confirm an assumption.
3. Weekly Review: point to "Seattle closes 11/25", start presentation mode, export the PPTX. "Nobody retypes this again."
4. Admin: Online now, the per-user usage table, then View-as analyst to show permissions.
5. Close: "One cloud database behind every view. CI-tested import. The colored-text habit became a confirm workflow. Here's what I'd do next."

## 8. Deliverables checklist

- [ ] **Production URL** plus demo credentials for each role (README and submission)
- [ ] Flowchart: `docs/flowchart.mmd` → mermaid.live → PNG
- [ ] PROCESS_LOG.md (assumptions + phase table + hosting decisions + next steps)
- [ ] Exported Copilot chats plus a half-page summary
- [ ] Screenshots: green CI run, 25 tests passed, import reconciliation
- [ ] Optional: 2-minute Loom
