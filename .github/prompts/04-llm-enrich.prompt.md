---
mode: agent
description: Phase 4 — LLM enrichment of notes (suggestions only)
---
Write `scripts/llm_enrich.py` that reads `out/deals.json` and writes `out/deals_enriched.json`.

Rules (from #file:../copilot-instructions.md): the LLM only SUGGESTS. Never touch numeric source fields or known status mappings.

For each deal with non-empty notes, call the LLM once with a strict JSON schema (tool/function calling or JSON mode) returning:
```
{
  "key_dates": [{"label": str, "date_text": str, "iso_guess": str|null}],
  "negotiated_price": number|null,     // only if notes state an agreed/counter price
  "price_context": str|null,           // e.g. "counter $3.25M, we responded $3.05M"
  "risks": [str],
  "next_step": str|null,
  "deal_type": "buy"|"lease"|"unknown",
  "weekly_note": str,                  // <= 12 words, partner-friendly, no stage words already shown in Status
  "evidence": {"<field>": "<exact quote from notes>"},
  "confidence": number                 // 0..1
}
```
- For deals whose stage is "Needs review", also ask for `suggested_stage` (one of the 8 stages or null) with reason.
- Store result in `notes_extracted`, set `weekly_note`, and add `field_provenance` entries `"weekly_note":"llm_suggested"`, `"notes_extracted":"llm_suggested"`.
- Year-less dates: resolve to the next occurrence after 2026-11-18 in iso_guess and keep date_text.
- Cache by sha256(notes + prompt version) in `out/llm_cache.json` so re-runs cost nothing.
- Provider via env: LLM_PROVIDER=anthropic|openai, model via LLM_MODEL. Keys from env only.
- Add `scripts/eval_llm.py` with hand labels for the 18 rows in `scripts/llm_labels.json` (I will fill them) that prints per-field accuracy. Create the labels file pre-filled with my best guesses marked "TODO verify".
