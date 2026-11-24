# LLM Note Enrichment Evaluation

- **Provider / model:** `openai` / `gpt-6-luna`
- **Verified ground-truth deals:** 18
- **Overall field accuracy:** 74.3%

## Per-field accuracy

| Field | Correct | Total | Accuracy |
|---|---:|---:|---:|
| `key_dates` | 18 | 18 | 100.0% |
| `negotiated_price` | 15 | 18 | 83.3% |
| `price_context` | 13 | 18 | 72.2% |
| `risks` | 11 | 18 | 61.1% |
| `next_step` | 5 | 18 | 27.8% |
| `deal_type` | 9 | 18 | 50.0% |
| `suggested_stage` | 18 | 18 | 100.0% |
| `weekly_note quality` | 18 | 18 | 100.0% |

## Misses (notes vs. prediction vs. label)

| Deal ID | Field | Source notes | Prediction | Label |
|---|---|---|---|---|
| `av_clientC_atl:2` | `next_step` | DD date 9/18, kicked off environmental review | `False (None)` | `True` |
| `av_clientC_atl:2` | `deal_type` | DD date 9/18, kicked off environmental review | `unknown` | `buy` |
| `av_clientC_atl:3` | `negotiated_price` | agreed to $3M, negotiating final PSA terms | `null` | `3000000` |
| `av_clientC_atl:3` | `price_context` | agreed to $3M, negotiating final PSA terms | `null` | `agreed to $3M` |
| `av_clientC_atl:3` | `next_step` | agreed to $3M, negotiating final PSA terms | `False (None)` | `True` |
| `av_clientC_atl:3` | `deal_type` | agreed to $3M, negotiating final PSA terms | `unknown` | `buy` |
| `av_clientC_atl:4` | `next_step` | may require conditional use permit, have not toured yet | `False (None)` | `True` |
| `av_clientC_atl:6` | `risks` | no good on-market options, focusing off-market, met with city | `True (['No good on-market options.'])` | `False` |
| `food_clientA_nyc:2` | `next_step` | full cooler, negotiating PSA - 60 day dd, 30 day close | `False (None)` | `True` |
| `food_clientA_nyc:2` | `deal_type` | full cooler, negotiating PSA - 60 day dd, 30 day close | `unknown` | `buy` |
| `food_clientA_nyc:3` | `risks` | partial cooler - 60 day dd, 30 day close | `True (['Partial cooler'])` | `False` |
| `food_clientA_nyc:3` | `next_step` | partial cooler - 60 day dd, 30 day close | `False (None)` | `True` |
| `food_clientA_nyc:3` | `deal_type` | partial cooler - 60 day dd, 30 day close | `unknown` | `buy` |
| `food_clientA_nyc:4` | `risks` | looking for additional options near JFK, no strong candidates yet | `False ([])` | `True` |
| `food_clientA_nyc:5` | `negotiated_price` | partial cooler, toured, countered at $3.25M, we responded at $3.05M | `3250000` | `3050000` |
| `food_clientA_nyc:5` | `price_context` | partial cooler, toured, countered at $3.25M, we responded at $3.05M | `Countered at $3.25M; response was $3.05M.` | `countered at $3.25M, we responded at $3.05M` |
| `food_clientA_nyc:5` | `next_step` | partial cooler, toured, countered at $3.25M, we responded at $3.05M | `False (None)` | `True` |
| `food_clientA_nyc:5` | `deal_type` | partial cooler, toured, countered at $3.25M, we responded at $3.05M | `unknown` | `buy` |
| `food_clientA_nyc:6` | `price_context` | closing 11/25, deposit $250,000 | `null` | `deposit $250,000` |
| `food_clientA_nyc:6` | `next_step` | closing 11/25, deposit $250,000 | `False (None)` | `True` |
| `food_clientA_nyc:6` | `deal_type` | closing 11/25, deposit $250,000 | `unknown` | `buy` |
| `food_clientA_nyc:7` | `risks` | backburner, focused on NY for now | `False ([])` | `True` |
| `food_clientA_nyc:8` | `risks` | market prep | `False ([])` | `True` |
| `food_clientA_nyc:8` | `next_step` | market prep | `False (None)` | `True` |
| `food_clientA_nyc:9` | `price_context` | received lease draft, $4M/yr rent, 90 day DD, 12 months free rent | `$4M/yr rent; 12 months free rent` | `$4M/yr rent, 12 months free rent` |
| `food_clientA_nyc:9` | `risks` | received lease draft, $4M/yr rent, 90 day DD, 12 months free rent | `False ([])` | `True` |
| `food_clientA_nyc:9` | `next_step` | received lease draft, $4M/yr rent, 90 day DD, 12 months free rent | `False (None)` | `True` |
| `catering_clientB_jfk:2` | `negotiated_price` | best and final $5.75M, trading LOIs | `null` | `5750000` |
| `catering_clientB_jfk:2` | `price_context` | best and final $5.75M, trading LOIs | `Best and final amount` | `best and final $5.75M` |
| `catering_clientB_jfk:2` | `next_step` | best and final $5.75M, trading LOIs | `False (None)` | `True` |
| `catering_clientB_jfk:2` | `deal_type` | best and final $5.75M, trading LOIs | `unknown` | `buy` |
| `catering_clientB_jfk:3` | `next_step` | currently a food processing building | `False (None)` | `True` |
| `catering_clientB_jfk:3` | `deal_type` | currently a food processing building | `unknown` | `buy` |
| `catering_clientB_jfk:4` | `risks` | aerospace mfr, 7 buildings total 4 left, heavy power each | `False ([])` | `True` |
| `catering_clientB_jfk:4` | `next_step` | aerospace mfr, 7 buildings total 4 left, heavy power each | `False (None)` | `True` |
| `catering_clientB_jfk:4` | `deal_type` | aerospace mfr, 7 buildings total 4 left, heavy power each | `unknown` | `buy` |
| `catering_clientB_jfk:5` | `next_step` | emailed, awaiting reply | `False (None)` | `True` |

## Conclusion

Across all 18 verified deals, the `openai/gpt-6-luna` extractor achieved **74.3% overall accuracy** with strict verbatim evidence validation. It is reliable as a suggestion engine for high-precision fields (key_dates, suggested_stage, weekly_note quality) and for drafting concise partner-ready weekly summaries, while fields with higher interpretive ambiguity (negotiated_price, price_context, risks, next_step, deal_type)—such as whether relative durations count as calendar dates, whether descriptive remarks imply a buy transaction, or what rises to an actionable risk/next step—cannot be trusted blindly. Keeping every extraction labelled `llm_suggested` with verbatim source quotes ensures human reviewers (admin / acquisition leads) confirm or edit suggestions before they become authoritative.
