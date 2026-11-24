import type { TractDemographicsRow } from "@/lib/geo/acs";
import { jsonObject, provenanceFor, type Deal, type VerticalConfig } from "@/lib/deals";
import { fmtDate, fmtMoney, fmtNumber, fmtOrDash } from "@/lib/format";
import { extractNoteDates, type NoteDate } from "@/lib/note-dates";

export type MappedDeal = Deal & {
  lat: number;
  lng: number;
};

export type UnmappedDeal = {
  deal: Deal;
  reason: string;
};

export type DisplayAttribute = {
  key: string;
  label: string;
  displayValue: string;
  provenance: "assumed" | "llm_suggested" | "confirmed" | undefined;
};

export function hasValidCoordinates(deal: Deal): deal is MappedDeal {
  return (
    deal.geocode_status === "ok" &&
    typeof deal.lat === "number" &&
    typeof deal.lng === "number" &&
    Number.isFinite(deal.lat) &&
    Number.isFinite(deal.lng) &&
    !(deal.lat === 0 && deal.lng === 0)
  );
}

export function unmappedReason(deal: Deal): string {
  if (deal.geocode_status === "no_address" || !deal.address?.trim()) {
    return "No address";
  }
  if (deal.geocode_status === "not_found") {
    return "Address not found";
  }
  if (deal.geocode_status === "error") {
    return "Geocoding error";
  }
  return "Pending geocode";
}

export function partitionDealsForMap(deals: Deal[]): {
  mapped: MappedDeal[];
  unmapped: UnmappedDeal[];
} {
  const mapped: MappedDeal[] = [];
  const unmapped: UnmappedDeal[] = [];
  for (const deal of deals) {
    if (hasValidCoordinates(deal)) {
      mapped.push(deal);
    } else {
      unmapped.push({ deal, reason: unmappedReason(deal) });
    }
  }
  return { mapped, unmapped };
}

export function verticalAttributesForDeal(
  deal: Deal,
  config: VerticalConfig | undefined,
): DisplayAttribute[] {
  const attrs = jsonObject(deal.attributes);
  const rawAttrs = jsonObject(deal.attributes_raw);
  const columns = Array.isArray(config?.columns) ? config.columns : [];

  const rows: DisplayAttribute[] = [];
  for (const col of columns) {
    if (!col || typeof col !== "object" || Array.isArray(col)) continue;
    const def = col as { key?: unknown; label?: unknown; type?: unknown };
    if (typeof def.key !== "string") continue;
    const key = def.key;
    const value = attrs[key];
    const raw = rawAttrs[key];
    if (
      (value === null || value === undefined || value === "") &&
      (raw === null || raw === undefined || raw === "")
    ) {
      continue;
    }

    let displayValue: string;
    if (key === "power_amps" && typeof value === "number") {
      displayValue = `${fmtNumber(value)}A`;
    } else if (def.type === "number" && typeof value === "number") {
      displayValue =
        key === "rent_per_sf"
          ? fmtMoney(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : fmtNumber(value);
    } else if (def.type === "boolean" && typeof value === "boolean") {
      displayValue = value ? "Yes" : "No";
    } else {
      displayValue = fmtOrDash(value ?? raw);
    }

    rows.push({
      key,
      label: typeof def.label === "string" ? def.label : key.replaceAll("_", " "),
      displayValue,
      provenance: provenanceFor(deal, key),
    });
  }
  return rows;
}

export function nextKeyDateForDeal(
  deal: Deal,
  referenceDate: Date = new Date(),
): { label: string; formattedDate: string; iso: string } | null {
  const candidates: NoteDate[] = [];
  const extracted = jsonObject(deal.notes_extracted);
  if (Array.isArray(extracted.key_dates)) {
    for (const item of extracted.key_dates) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const obj = item as { label?: unknown; date_text?: unknown; iso_guess?: unknown };
      if (typeof obj.label === "string" && typeof obj.iso_guess === "string") {
        candidates.push({
          label: obj.label,
          date_text: typeof obj.date_text === "string" ? obj.date_text : obj.iso_guess,
          iso_guess: obj.iso_guess,
        });
      }
    }
  }
  if (candidates.length === 0) {
    candidates.push(...extractNoteDates(deal.notes, referenceDate));
  }
  if (candidates.length === 0) return null;

  const todayIso = referenceDate.toISOString().slice(0, 10);
  const sorted = [...candidates].sort((a, b) => a.iso_guess.localeCompare(b.iso_guess));
  const upcoming = sorted.find((item) => item.iso_guess >= todayIso) ?? sorted[0];

  return {
    label: upcoming.label,
    formattedDate: fmtDate(`${upcoming.iso_guess}T12:00:00Z`, "MMM d, yyyy"),
    iso: upcoming.iso_guess,
  };
}

export function demographicsUnavailableReason(
  geoid: string | null,
  row: TractDemographicsRow | null | undefined,
) {
  if (row?.last_error) return row.last_error;
  if (!row) return geoid ? "Not yet loaded." : "No Census tract is available.";
  return null;
}

export function formatTractDemographics(row: TractDemographicsRow | null | undefined) {
  if (!row) return null;
  return {
    geoid: row.geoid,
    sourceLabel: `Census ACS 5-yr, tract ${row.geoid}`,
    population: row.population !== null ? fmtNumber(row.population) : "—",
    medianIncome:
      row.median_household_income !== null
        ? fmtMoney(row.median_household_income, { maximumFractionDigits: 0 })
        : "—",
    medianAge:
      row.median_age !== null ? `${Number(row.median_age).toFixed(1)} yrs` : "—",
    households: row.households !== null ? fmtNumber(row.households) : "—",
    pctBachelors:
      row.pct_bachelors !== null ? `${Number(row.pct_bachelors).toFixed(1)}%` : "—",
  };
}
