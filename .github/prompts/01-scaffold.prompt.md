---
mode: agent
description: Phase 1 — scaffold Next.js + Supabase app shell
---
Scaffold the app in the current repo following #file:../copilot-instructions.md

1. Create a Next.js 15 App Router project (TypeScript, Tailwind, ESLint, `src/` dir) in place.
2. Install: @supabase/supabase-js @supabase/ssr ag-grid-community ag-grid-react pptxgenjs zod date-fns lucide-react. Init shadcn/ui and add: button, card, badge, table, tabs, select, dialog, dropdown-menu, input, tooltip, sonner.
3. Supabase clients: `src/lib/supabase/server.ts`, `client.ts`, and `middleware.ts` that refreshes the session and redirects unauthenticated users to `/login`.
4. `/login` page (email + password). On successful sign-in, call a server action that inserts `{event:'login'}` into `activity_log`.
5. App layout with a left nav: Operations (`/deals`), Weekly Review (`/weekly`), Rollup (`/rollup`), Admin (`/admin`, only visible to admin). Top-right: user name, role badge, sign out.
6. `src/lib/format.ts` with fmtMoney, fmtNumber, fmtOrDash, fmtDate — all return "—" for null/undefined.
7. `.env.example` with NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.

8. `src/app/api/health/route.ts` returning `{ok, db, deals, version}` (version from `VERCEL_GIT_COMMIT_SHA`; db/deals false/0 until tables exist — must not throw).
9. Security headers in `next.config` (X-Frame-Options DENY, Referrer-Policy, X-Content-Type-Options).

Do not create database tables yet. Stop after `npm run build` passes and list the files you created.
Then I will push to GitHub and connect Vercel so production is live from phase 1.
