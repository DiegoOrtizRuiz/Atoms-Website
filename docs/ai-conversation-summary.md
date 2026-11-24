# AI conversation summary

## Tools and roles

| Phase(s) | Tool | Role and evidence |
|---|---|---|
| Planning, workbook audit, phase prompts, and inter-phase reviews | Claude (claude.ai) | Claude directly covered planning and review work: interpreting the workbook and operating assumptions, shaping the shared project rules and numbered phase prompts, and providing inter-phase direction. It does not appear in the implementation exports as the tool that drove a code phase; the linked share page did not expose enough transcript text to attribute more specific implementation turns. |
| 1–7 | GitHub Copilot Agent mode in VS Code | The workflow used `.github/copilot-instructions.md` and numbered phase prompts. The Copilot export records early setup, schema, seed, and enrichment discussions; prompts 01–07 are checked in. |
| 8–14 | Unknown / not recoverable from the available exports | The repository contains commits for these implementation and hardening phases, but neither the local Copilot export nor the Antigravity export identifies which assistant executed them. I should not infer a tool attribution from commit authorship alone. |
| 15–18 | Google Antigravity | The exported conversation contains the in-app importer, map, LLM evaluation/review, and E2E acceptance prompts, with repeated approval gates. The same project rules and phase requirements were supplied. |

The workflow stayed consistent across tools: one shared instruction file, a prompt for each phase, a review/check gate before moving on, and a phase commit. Python importer tests and CI were the shared safety net, with TypeScript/Python parity added when the hosted importer arrived. Later acceptance tests also checked production behavior and restored shared data after mutations.

## Corrections and recoveries

These are cases visible in the exports and repository history. Some are implementation defects; others are missing setup guidance or a test that exposed an AI-built behavior that did not meet the stated requirement.

1. **Copilot · setup / Supabase keys.** Copilot initially pointed to the old “anon public” and “service_role” labels. I replied, “I do not see any anon public key nor service-role key.” The follow-up recognized the renamed **Publishable** and **Secret** keys and mapped them to the existing environment variable names. This kept the secret server-side and avoided asking me to expose it in chat.
2. **Copilot · seed runner.** The generated `npm run seed` path did not work in my activated `.venv`; I supplied the terminal error ending in `ModuleNotFoundError: No module named 'apt_pkg'`. The failure was Python resolution through Ubuntu’s command-not-found handler, so the runner was changed to select the project virtualenv Python deterministically before falling back to `python3`.
3. **Copilot · Supabase initialization.** After credentials were verified, I asked, “But how is the Supabase project be configured?” The previous setup answer had not yet covered the database schema step. I prompted for the missing prerequisite, and the response then gave the ordered SQL Editor migration steps before seeding.
4. **Antigravity · Phase 17 schema.** The enrichment output needed to satisfy OpenAI strict structured-output rules. The phase prompt corrected the shape explicitly: “Make `JSON_SCHEMA` OpenAI strict-mode compatible (`evidence` array of `{field, quote}`).” The schema, provider tests, and evidence handling were updated before reporting the measured evaluation.
5. **Antigravity · Phase 18 onboarding.** The acceptance prompt required a temporary-password user to be forced to `/auth/set-password` and blocked from `/deals` until changing it. The E2E run exposed an incorrect sign-in redirect; the fix routed `must_change_password` users to the set-password page, and the test verifies the full path.
6. **Antigravity · Phase 18 live freshness.** The prompt required a second browser to see the changed weekly note “within 10 s without reload, and the ‘as of’ time updates.” The automated check exposed that the timestamp precision could conceal a same-minute update. The timestamp was changed to include seconds and the cross-browser check then passed.

The Antigravity export also records two tool-operation errors: an exact-text edit target was not found in Phase 16, and a referenced file was missing in Phase 18. Those were execution failures rather than product decisions; the conversation continued after the user prompts “Proceed with part B” and “Continue,” and the final commits and checks are recorded in the phase log.

## What each tool contributed

The exports show Copilot working through the early scaffold, schema, seed, and first product phases using short follow-up questions and repository prompts; its main friction in this record was environment-specific setup. Antigravity handled the longer, multi-part late phases with explicit acceptance criteria and production-oriented checks, though the export also records occasional failed file operations. Claude was strongest as a planning and framing partner for the data decisions and phase boundaries, while Claude's implementation contribution cannot be established because the shared transcript was unreadable. For 8–14, the source evidence is insufficient to rank or compare a tool fairly.

## What I'd prompt differently next time

I would put environment discovery and acceptance evidence at the start of each phase: verify which keys and runtimes the current UI actually exposes, inspect existing migrations before naming the next one, run the smallest test early, and make the final gate include a real user-visible check as well as a build. I would also ask for AI-written claims to be separated from measured results, especially for provider quality and production behavior. Personally, I would give every implementation prompt explicit stop conditions, restore requirements for shared production data, and a single evidence artifact to update at completion; that would make late changes easier to audit and prevent an apparently green CI run from standing in for role, RLS, or browser acceptance.

## Source material

I reviewed the local Copilot and Antigravity conversation exports, the numbered
phase prompts, and the repository commit/acceptance history. The raw exports
contain credential-like material, so they are kept outside version control
and are not part of this submission package. The Claude share link is
[available here](https://claude.ai/share/28a513f6-54b3-485f-9520-b0ed075f7f3f),
but did not expose readable transcript text during this review.
