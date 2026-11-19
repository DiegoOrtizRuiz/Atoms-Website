---
mode: agent
description: Phase 9 (priority after core, before stretch) — in-app workbook import so the cloud app owns ingestion
---
Today the importer runs locally in Python. Make ingestion part of the hosted app so a non-technical operator can re-import without a terminal.

1. Port `scripts/normalize.py` to `src/lib/import/normalize.ts` using **exceljs** (it reads font colors; SheetJS community does not). Same rules, same output shape as `out/deals.json`.
2. Parity test (Vitest): run the TS port on `data/src.xlsx` and assert deep-equal to `out/deals.json` produced by the Python version (the Python output is the golden file). Add to CI.
3. Admin → **Data import** tab: upload .xlsx → server action parses → shows a **dry-run diff** (new deals, changed fields, rows flagged, rows that exist in DB but not in file — never auto-delete these, mark them) → "Apply" upserts and writes deal_history with `changed_by` = admin and detail `{source:'import'}`.
4. Imports must not overwrite values that were edited or confirmed in the app after the last import; show those as conflicts for the admin to choose.
5. Log every import to activity_log with the reconciliation numbers.
