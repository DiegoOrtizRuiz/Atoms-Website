export type GeocodeStatus = "ok" | "no_address" | "not_found" | "error";

export type GeocodeResult = {
  status: GeocodeStatus;
  lat: number | null;
  lng: number | null;
  source: string | null;
  tractGeoid: string | null;
  normalizedAddress: string | null;
};

export type GeocodeOptions = {
  fetchImpl?: typeof fetch;
  googleApiKey?: string;
  timeoutMs?: number;
};

const CENSUS_ONELINE_URL =
  "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress";
const CENSUS_COORDS_URL =
  "https://geocoding.geo.census.gov/geocoder/geographies/coordinates";
const GOOGLE_GEOCODE_URL =
  "https://maps.googleapis.com/maps/api/geocode/json";

function cleanPart(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

export function buildQueryAddress(
  address: string | null | undefined,
  city: string | null | undefined,
  state: string | null | undefined,
): string | null {
  const street = cleanPart(address);
  if (!street) return null;
  return [street, cleanPart(city), cleanPart(state)].filter(Boolean).join(", ");
}

export function normalizeGeoAddress(
  address: string | null | undefined,
  city: string | null | undefined,
  state: string | null | undefined,
): string | null {
  const query = buildQueryAddress(address, city, state);
  return query ? query.toLowerCase() : null;
}

function extractTractGeoid(geographies: unknown): string | null {
  if (!geographies || typeof geographies !== "object") return null;
  const map = geographies as Record<string, unknown>;
  const candidates = [
    map["Census Tracts"],
    map["2020 Census Tracts"],
    map["2010 Census Tracts"],
  ];
  for (const list of candidates) {
    if (Array.isArray(list) && list.length > 0) {
      const first = list[0] as Record<string, unknown> | undefined;
      if (first && typeof first.GEOID === "string" && /^\d{11}$/.test(first.GEOID)) {
        return first.GEOID;
      }
    }
  }
  return null;
}

function isValidCoordinates(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

async function fetchJsonWithTimeout(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function lookupTractByCoordinates(
  lat: number,
  lng: number,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      x: String(lng),
      y: String(lat),
      benchmark: "Public_AR_Current",
      vintage: "Current_Current",
      format: "json",
    });
    const payload = (await fetchJsonWithTimeout(
      `${CENSUS_COORDS_URL}?${params.toString()}`,
      fetchImpl,
      timeoutMs,
    )) as { result?: { geographies?: unknown } };
    return extractTractGeoid(payload?.result?.geographies);
  } catch {
    return null;
  }
}

export async function geocodeAddress(
  address: string | null | undefined,
  city: string | null | undefined,
  state: string | null | undefined,
  options: GeocodeOptions = {},
): Promise<GeocodeResult> {
  const queryAddress = buildQueryAddress(address, city, state);
  const normalizedAddress = queryAddress ? queryAddress.toLowerCase() : null;

  if (!queryAddress || !normalizedAddress) {
    return {
      status: "no_address",
      lat: null,
      lng: null,
      source: null,
      tractGeoid: null,
      normalizedAddress: null,
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 12_000;
  const googleApiKey =
    options.googleApiKey !== undefined
      ? options.googleApiKey
      : process.env.GOOGLE_GEOCODING_KEY;

  try {
    const censusParams = new URLSearchParams({
      address: queryAddress,
      benchmark: "Public_AR_Current",
      vintage: "Current_Current",
      format: "json",
    });
    const payload = (await fetchJsonWithTimeout(
      `${CENSUS_ONELINE_URL}?${censusParams.toString()}`,
      fetchImpl,
      timeoutMs,
    )) as {
      result?: {
        addressMatches?: Array<{
          coordinates?: { x?: unknown; y?: unknown };
          geographies?: unknown;
        }>;
      };
    };

    const match = payload?.result?.addressMatches?.[0];
    const lat = match?.coordinates?.y;
    const lng = match?.coordinates?.x;

    if (match && isValidCoordinates(lat, lng)) {
      return {
        status: "ok",
        lat,
        lng: lng as number,
        source: "census",
        tractGeoid: extractTractGeoid(match.geographies),
        normalizedAddress,
      };
    }
  } catch {
    if (!googleApiKey) {
      return {
        status: "error",
        lat: null,
        lng: null,
        source: "census",
        tractGeoid: null,
        normalizedAddress,
      };
    }
  }

  if (googleApiKey) {
    try {
      const googleParams = new URLSearchParams({
        address: queryAddress,
        key: googleApiKey,
      });
      const payload = (await fetchJsonWithTimeout(
        `${GOOGLE_GEOCODE_URL}?${googleParams.toString()}`,
        fetchImpl,
        timeoutMs,
      )) as {
        status?: string;
        results?: Array<{
          geometry?: { location?: { lat?: unknown; lng?: unknown } };
        }>;
      };

      const loc = payload?.results?.[0]?.geometry?.location;
      if (
        payload?.status === "OK" &&
        loc &&
        isValidCoordinates(loc.lat, loc.lng)
      ) {
        const tractGeoid = await lookupTractByCoordinates(
          loc.lat,
          loc.lng as number,
          fetchImpl,
          timeoutMs,
        );
        return {
          status: "ok",
          lat: loc.lat,
          lng: loc.lng as number,
          source: "google",
          tractGeoid,
          normalizedAddress,
        };
      }

      if (payload?.status && payload.status !== "ZERO_RESULTS") {
        return {
          status: "error",
          lat: null,
          lng: null,
          source: "google",
          tractGeoid: null,
          normalizedAddress,
        };
      }
    } catch {
      return {
        status: "error",
        lat: null,
        lng: null,
        source: "google",
        tractGeoid: null,
        normalizedAddress,
      };
    }
  }

  return {
    status: "not_found",
    lat: null,
    lng: null,
    source: googleApiKey ? "census+google" : "census",
    tractGeoid: null,
    normalizedAddress,
  };
}
