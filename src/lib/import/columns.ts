export const DEFAULT_VERTICAL_CONFIG: Readonly<Record<string, string>> = {
  food: "Food",
  av: "Autonomous Vehicle",
  catering: "Airline Catering",
};

export const VERTICAL_ORDER = [
  "Food",
  "Autonomous Vehicle",
  "Airline Catering",
] as const;

export const NON_DEAL_TABS = new Set(["contact_tracker", "target_weekly_view"]);

export const CORE_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  client: ["client name", "client"],
  market: ["metro", "market"],
  city: ["city"],
  state: ["state"],
  address: ["address"],
  stage_raw: ["status"],
  bldg_sf: ["bldg sf", "building sf", "sf"],
  list_price: ["list price", "$"],
  price_per_sf_sheet: ["list price/sf", "$/sf"],
  lot_sf: ["lot sf", "lot size"],
  price_per_lot_sf_sheet: ["list price/lot sf"],
  broker: ["broker"],
  broker_phone: ["phone #", "phone"],
  notes: ["notes"],
};

export const ATTRIBUTE_ALIASES: Readonly<Record<string, string>> = {
  zoning: "zoning",
  "clear height": "clear_height_ft",
  "dh doors": "dock_high_doors",
  "gl doors": "grade_level_doors",
  power: "power_amps",
  "property type": "property_type",
  "sale status": "listing_status",
  "days on market": "days_on_market",
  "miles from airport": "miles_from_airport",
  "rent/sf": "rent_per_sf",
};

export const NUMERIC_ATTRIBUTES = new Set([
  "dock_high_doors",
  "grade_level_doors",
  "days_on_market",
  "miles_from_airport",
  "rent_per_sf",
]);

export const CITY_STATE: Readonly<Record<string, string>> = {
  hialeah: "FL",
  miami: "FL",
  chicago: "IL",
  seattle: "WA",
  atlanta: "GA",
  hollis: "NY",
  westbury: "NY",
  "port washington": "NY",
};

export function normHeader(h: unknown): string | null {
  if (h === null || h === undefined) return null;
  return String(h).trim().toLowerCase().replace(/\s+/g, " ");
}

export function slugifyHeader(h: string): string {
  return h.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function cleanStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s === "-" || s === "—" || s === "n/a" || s === "N/A") {
    return null;
  }
  return s;
}

export function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || typeof v === "boolean") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[$,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseAmps(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const match = /^\s*([\d,]+(?:\.\d+)?)\s*A?\s*$/.exec(String(v));
  if (!match) return null;
  const n = Number(match[1].replaceAll(",", ""));
  return Number.isFinite(n) ? n : null;
}

/** Round half to even (matches Python's built-in round(x, decimals)). */
export function roundHalfToEven(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  const scaled = value * factor;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  let rounded: number;
  if (Math.abs(diff - 0.5) < 1e-12) {
    rounded = floor % 2 === 0 ? floor : floor + 1;
  } else {
    rounded = Math.round(scaled);
  }
  const result = rounded / factor;
  return Object.is(result, -0) ? 0 : result;
}

export function pyFloatStr(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : String(value);
}

export function pyRepr(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "string") {
    if (value.includes("'") && !value.includes('"')) {
      return `"${value}"`;
    }
    return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
  }
  return String(value);
}
