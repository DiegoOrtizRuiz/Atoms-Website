---
mode: agent
description: Phase 8 (stretch) — Rollup + Map. Only start if phases 1–7 pass verification.
---
A) `/rollup`: from `v_stage_rollup` — matrix vertical × stage with counts; bar of average days in current stage, highlighting deals > 30 days in stage; outreach panel from contacts (emailed / LinkedIn / helpful-reply rates, linked deals).

B) Map tab on `/deals` (toggle Grid | Map): Google Maps JS API (`NEXT_PUBLIC_GOOGLE_MAPS_KEY`, restrict key by HTTP referrer).
- Geocode addresses once in `scripts/geocode.py` (US Census Geocoder, free, no key) and store lat, lng, census tract GEOID in deals. Deals without an address are listed beside the map as "Not mappable" — never placed at a fake location.
- Pins colored by stage; respect the grid's current filters.
- Hover card: address, stage, price, SF, $/SF, key attributes, plus tract demographics fetched server-side from the Census ACS 5-year API (population, median household income, median age) and cached in a `tract_demographics` table.
