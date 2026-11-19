---
mode: agent
description: Phase 6 — Weekly Review view + presentation mode + PPTX export
---
Build `/weekly` for a NON-TECHNICAL partner in a live meeting. Same `deals` table as /deals — no separate data.

Layout (mirrors the sheet's target_weekly_view tab: grouped by Vertical, columns Market, Address, Status, $, SF, $/SF, Lot Size, Notes; blanks shown as "—"):
1. Header: "Pipeline Review — week of <date>", last-updated timestamp ("as of 20:31"), Export PPTX, Present buttons.
2. Summary strip: per vertical, a small funnel of counts by stage (only non-zero stages).
3. "Needs attention this week": deals with a key date in the next 14 days (from notes_extracted.key_dates), deals that changed stage in the last 7 days (deal_history), and new deals. Each item one line.
4. One section per vertical in vertical_config.sort_order; inside, rows sorted by stage (most advanced first), then market. Only `show_in_weekly = true`. Notes column uses weekly_note, falling back to notes.
   Money as $11.0M / $285/SF style; blanks "—"; assumed values styled with a legend at the bottom.
5. Toggle "Show all deals" for when a partner asks "what else is in the pipeline?".

Responsive: must read well on a laptop projected on a screen AND on an iPad. Live-updates via Realtime (no manual refresh mid-meeting), with the "as of" timestamp updating.

Presentation mode: full-screen, large type, one vertical per screen, arrow keys/space to advance, Esc to exit.

Export: pptxgenjs, client-side, 16:9. Slide 1 title + summary counts; slide 2 "Needs attention"; one slide per vertical (table, auto-split at 8 rows per slide); assumed values in italic with footnote. Filename `pipeline-review-YYYY-MM-DD.pptx`. Rows must equal what is on screen.

Also a "Save snapshot" button (admin/leadership) writing the current rendered data to weekly_snapshots, and a "Compare to last snapshot" toggle that marks new / moved / removed rows.
Optional (if LLM env set): "Draft summary" button that sends the week's deal_history to a server route and returns 3–4 bullets.
