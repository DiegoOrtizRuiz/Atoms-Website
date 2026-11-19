---
mode: agent
description: Phase 7 — Admin: users, permissions, usage logs
---
Build `/admin` (admin only — enforce in middleware AND RLS) with tabs:

0. **Online now**: who is logged in right now (Realtime Presence) with current page; plus active sessions in last 15 min from activity_log.
1. **Usage dashboard**: KPI cards (active users today / 7d, logins 7d, edits 7d, deals needing review). Chart of logins per day (30d). Table per user: name, role, last login, logins 7d, edits 7d, most-visited page. Filter by role.
2. **Users & permissions**: table of profiles with inline editing of role, verticals (multi-select from vertical_config), clients (multi-select from distinct deals.client), active toggle. Invite user (admin API via server action using service role key — server-only). A read-only "Permission matrix" card rendering the role table from copilot-instructions.md so reviewers see the model.
3. **Activity log**: paginated, filter by user/event/date; edits link to the deal drawer.
4. **Data health**: last import time, reconciliation (source rows vs deals), needs-review list with reasons, unmapped status values, assumed cells count, LLM suggestions pending confirmation.
5. **View as role** (admin only, dev/demo aid): switch effective role in UI to preview what each role sees. Clearly bannered. It must not bypass RLS for writes.

6. **CSV export** of the activity log and of the permission assignments (audits).

Also for ALL users: `/me` page — "My activity" (my logins, my edits, my role and what I can do), and a password-reset flow via Supabase.

Every admin change writes to activity_log with detail jsonb.
