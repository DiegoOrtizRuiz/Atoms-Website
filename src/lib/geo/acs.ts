import type { Database } from "@/lib/database.types";

export type TractDemographicsRow =
  Database["public"]["Tables"]["tract_demographics"]["Row"];
export type TractDemographicsInsert =
  Database["public"]["Tables"]["tract_demographics"]["Insert"];

export const DEFAULT_ACS_YEAR = "2023";
export const DEMOGRAPHICS_TTL_DAYS = 180;

const ACS_VARIABLES = [
  "B01003_001E", // Total population
  "B19013_001E", // Median household income
  "B01002_001E", // Median age
  "B11001_001E", // Total households
  "B15003_001E", // Population 25+ (educational attainment denominator)
  "B15003_022E", // Bachelor's degree
  "B15003_023E", // Master's degree
  "B15003_024E", // Professional school degree
  "B15003_025E", // Doctorate degree
] as const;

export type AcsFetchOptions = {
  year?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export function parseTractGeoid(
  geoid: string | null | undefined,
): { state: string; county: string; tract: string } | null {
  if (!geoid || !/^\d{11}$/.test(geoid)) return null;
  return {
    state: geoid.slice(0, 2),
    county: geoid.slice(2, 5),
    tract: geoid.slice(5, 11),
  };
}

/**
 * Parses a Census ACS numeric field. Any negative sentinel (e.g. -666666666,
 * -888888888, -999999999), null, empty string, or non-finite value becomes null.
 */
export function parseCensusNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!text || text.toLowerCase() === "null") return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

export function isDemographicsStale(
  fetchedAt: string | Date,
  now: Date = new Date(),
  maxAgeDays = DEMOGRAPHICS_TTL_DAYS,
): boolean {
  const fetchedMs =
    fetchedAt instanceof Date ? fetchedAt.getTime() : new Date(fetchedAt).getTime();
  if (!Number.isFinite(fetchedMs)) return true;
  return now.getTime() - fetchedMs > maxAgeDays * 86_400_000;
}

export function computePctBachelorsPlus(values: {
  total25Plus: number | null;
  bachelors: number | null;
  masters?: number | null;
  professional?: number | null;
  doctorate?: number | null;
}): number | null {
  if (values.total25Plus === null || values.total25Plus <= 0) return null;
  if (values.bachelors === null) return null;
  const numerator =
    values.bachelors +
    (values.masters ?? 0) +
    (values.professional ?? 0) +
    (values.doctorate ?? 0);
  const pct = (numerator / values.total25Plus) * 100;
  if (!Number.isFinite(pct) || pct < 0) return null;
  return Math.round(pct * 10) / 10;
}

export async function fetchTractDemographics(
  geoid: string,
  options: AcsFetchOptions = {},
): Promise<TractDemographicsInsert | null> {
  const parts = parseTractGeoid(geoid);
  if (!parts) return null;

  const year = (options.year ?? process.env.CENSUS_ACS_YEAR ?? DEFAULT_ACS_YEAR).trim();
  const apiKey =
    options.apiKey !== undefined ? options.apiKey : (process.env.CENSUS_API_KEY ?? "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 12_000;

  const params = new URLSearchParams({
    get: ACS_VARIABLES.join(","),
    for: `tract:${parts.tract}`,
    in: `state:${parts.state} county:${parts.county}`,
  });
  if (apiKey.trim()) {
    params.set("key", apiKey.trim());
  }

  const url = `https://api.census.gov/data/${encodeURIComponent(year)}/acs/acs5?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload) || payload.length < 2) return null;
    const headers = payload[0];
    const row = payload[1];
    if (!Array.isArray(headers) || !Array.isArray(row)) return null;

    const byKey = new Map<string, unknown>();
    headers.forEach((header, index) => {
      if (typeof header === "string") {
        byKey.set(header, row[index]);
      }
    });

    const populationRaw = parseCensusNumber(byKey.get("B01003_001E"));
    const incomeRaw = parseCensusNumber(byKey.get("B19013_001E"));
    const medianAgeRaw = parseCensusNumber(byKey.get("B01002_001E"));
    const householdsRaw = parseCensusNumber(byKey.get("B11001_001E"));
    const pctBachelors = computePctBachelorsPlus({
      total25Plus: parseCensusNumber(byKey.get("B15003_001E")),
      bachelors: parseCensusNumber(byKey.get("B15003_022E")),
      masters: parseCensusNumber(byKey.get("B15003_023E")),
      professional: parseCensusNumber(byKey.get("B15003_024E")),
      doctorate: parseCensusNumber(byKey.get("B15003_025E")),
    });

    return {
      geoid,
      fetched_at: new Date().toISOString(),
      population: populationRaw !== null ? Math.round(populationRaw) : null,
      median_household_income: incomeRaw !== null ? Math.round(incomeRaw) : null,
      median_age:
        medianAgeRaw !== null ? Math.round(medianAgeRaw * 10) / 10 : null,
      households: householdsRaw !== null ? Math.round(householdsRaw) : null,
      pct_bachelors: pctBachelors,
      source: `Census ACS 5-yr (${year})`,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
