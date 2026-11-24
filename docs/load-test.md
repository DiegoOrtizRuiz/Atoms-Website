# Load Test Report

- **Date (UTC):** 2026-11-24T01:35:19.545Z
- **Target:** `https://atoms-website-three.vercel.app`
- **Commit:** `e1d6305`
- **Tool:** `autocannon` via `e2e/load.mjs`
- **Profile:** 25 concurrent authenticated sessions alternating `GET /deals` and `GET /weekly` for 60s

## Summary Metrics

| Metric | Value |
|---|---:|
| Total requests | 1817 |
| Throughput (avg req/s) | 30.29 |
| HTTP 2xx responses | 1817 |
| Non-2xx responses | 0 |
| Socket errors / timeouts | 0 / 0 |
| **Error rate** | **0.00%** |
| Latency avg | 819.2 ms |
| Latency p50 | 776 ms |
| **Latency p95 (p97.5 upper bound)** | **1523 ms** |
| Latency p99 | 2541 ms |
| Latency max | 3320 ms |

## Interpretation

- All 25 concurrent authenticated sessions hit live SSR routes (`/deals` and `/weekly`) backed by production Supabase Postgres and Vercel serverless functions.
- Observed error rate: **0.00%** (0 errors/non-2xx out of 1817 requests); p95 latency upper bound: **1523 ms**.
