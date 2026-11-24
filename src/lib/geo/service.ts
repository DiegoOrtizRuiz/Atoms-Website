import "server-only";

import type { Deal } from "@/lib/deals";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchTractDemographics,
  isDemographicsStale,
  parseTractGeoid,
} from "./acs";
import { geocodeAddress, normalizeGeoAddress, type GeocodeResult } from "./geocode";

type CachedGeoEntry = {
  lat: number;
  lng: number;
  tractGeoid: string | null;
  source: string | null;
};

export type DemographicsBatchSummary = {
  checked: number;
  refreshed: number;
  cached: number;
  failed: number;
};

export type GeocodeBatchSummary = {
  processed: number;
  ok: number;
  no_address: number;
  not_found: number;
  error: number;
  cached: number;
  tractGeoids: string[];
  demographics?: DemographicsBatchSummary;
};

export async function ensureTractDemographics(
  geoids: (string | null | undefined)[],
  options: { force?: boolean } = {},
): Promise<DemographicsBatchSummary> {
  const uniqueGeoids = [
    ...new Set(
      geoids.filter((geoid): geoid is string => Boolean(parseTractGeoid(geoid))),
    ),
  ];

  const summary: DemographicsBatchSummary = {
    checked: uniqueGeoids.length,
    refreshed: 0,
    cached: 0,
    failed: 0,
  };
  if (uniqueGeoids.length === 0) return summary;

  const admin = createAdminClient();
  const { data: existingRows, error } = await admin
    .from("tract_demographics")
    .select("geoid, fetched_at")
    .in("geoid", uniqueGeoids);
  if (error) throw new Error(error.message);

  const existingByGeoid = new Map(
    (existingRows ?? []).map((row) => [row.geoid, row.fetched_at]),
  );

  for (const geoid of uniqueGeoids) {
    const existingFetchedAt = existingByGeoid.get(geoid);
    if (!options.force && existingFetchedAt && !isDemographicsStale(existingFetchedAt)) {
      summary.cached += 1;
      continue;
    }

    const fetched = await fetchTractDemographics(geoid);
    if (!fetched) {
      summary.failed += 1;
      continue;
    }

    const { error: upsertError } = await admin
      .from("tract_demographics")
      .upsert(fetched, { onConflict: "geoid" });
    if (upsertError) {
      summary.failed += 1;
      continue;
    }
    summary.refreshed += 1;
  }

  return summary;
}

export async function geocodeDealById(
  dealId: string,
  options: { force?: boolean } = {},
): Promise<Deal> {
  const admin = createAdminClient();
  const { data: deal, error: readError } = await admin
    .from("deals")
    .select("*")
    .eq("id", dealId)
    .single();
  if (readError || !deal) {
    throw new Error(readError?.message ?? `Deal ${dealId} not found.`);
  }

  const normalized = normalizeGeoAddress(deal.address, deal.city, deal.state);

  if (
    !options.force &&
    normalized &&
    deal.geocode_status === "ok" &&
    deal.geocoded_address === normalized &&
    deal.lat !== null &&
    deal.lng !== null
  ) {
    if (deal.census_tract_geoid) {
      try {
        await ensureTractDemographics([deal.census_tract_geoid]);
      } catch (demoError) {
        console.error(`Unable to refresh demographics for tract ${deal.census_tract_geoid}.`, demoError);
      }
    }
    return deal;
  }

  let result: GeocodeResult;
  if (!normalized) {
    result = {
      status: "no_address",
      lat: null,
      lng: null,
      source: null,
      tractGeoid: null,
      normalizedAddress: null,
    };
  } else {
    // Cache lookup by normalized address across already-geocoded deals
    const { data: cached } = await admin
      .from("deals")
      .select("lat, lng, census_tract_geoid, geocode_source")
      .eq("geocoded_address", normalized)
      .eq("geocode_status", "ok")
      .not("lat", "is", null)
      .not("lng", "is", null)
      .neq("id", dealId)
      .limit(1)
      .maybeSingle();

    if (cached && cached.lat !== null && cached.lng !== null) {
      result = {
        status: "ok",
        lat: cached.lat,
        lng: cached.lng,
        source: cached.geocode_source ?? "census",
        tractGeoid: cached.census_tract_geoid,
        normalizedAddress: normalized,
      };
    } else {
      result = await geocodeAddress(deal.address, deal.city, deal.state);
    }
  }

  const { data: updated, error: updateError } = await admin
    .from("deals")
    .update({
      lat: result.lat,
      lng: result.lng,
      geocode_status: result.status,
      geocode_source: result.source,
      geocoded_at: new Date().toISOString(),
      census_tract_geoid: result.tractGeoid,
      geocoded_address: result.normalizedAddress,
    })
    .eq("id", dealId)
    .select("*")
    .single();

  if (updateError || !updated) {
    throw new Error(updateError?.message ?? `Unable to save geocode for ${dealId}.`);
  }

  if (updated.census_tract_geoid) {
    try {
      await ensureTractDemographics([updated.census_tract_geoid]);
    } catch (demoError) {
      console.error(`Unable to fetch demographics for tract ${updated.census_tract_geoid}.`, demoError);
    }
  }

  return updated;
}

export async function geocodeMissingDeals(options: {
  dealIds?: string[];
  retryErrors?: boolean;
} = {}): Promise<GeocodeBatchSummary> {
  const admin = createAdminClient();
  const retryErrors = options.retryErrors ?? true;

  let query = admin
    .from("deals")
    .select("id, address, city, state, geocode_status, geocoded_address, lat, lng, census_tract_geoid, geocode_source");
  if (options.dealIds?.length) {
    query = query.in("id", options.dealIds);
  }

  const { data: allDeals, error } = await query;
  if (error) throw new Error(error.message);

  // Build normalized-address cache from already-geocoded deals
  const cache = new Map<string, CachedGeoEntry>();
  for (const row of allDeals ?? []) {
    if (
      row.geocode_status === "ok" &&
      row.geocoded_address &&
      row.lat !== null &&
      row.lng !== null
    ) {
      cache.set(row.geocoded_address, {
        lat: row.lat,
        lng: row.lng,
        tractGeoid: row.census_tract_geoid,
        source: row.geocode_source,
      });
    }
  }

  const targets = (allDeals ?? []).filter((row) => {
    const normalized = normalizeGeoAddress(row.address, row.city, row.state);
    if (!normalized) {
      return row.geocode_status !== "no_address" || row.lat !== null || row.lng !== null;
    }
    if (row.geocode_status === null) return true;
    if (retryErrors && row.geocode_status === "error") return true;
    if (row.geocoded_address !== normalized) return true;
    return false;
  });

  const summary: GeocodeBatchSummary = {
    processed: 0,
    ok: 0,
    no_address: 0,
    not_found: 0,
    error: 0,
    cached: 0,
    tractGeoids: [],
  };
  const geoidSet = new Set<string>();

  for (const deal of targets) {
    const normalized = normalizeGeoAddress(deal.address, deal.city, deal.state);
    let result: GeocodeResult;

    if (!normalized) {
      result = {
        status: "no_address",
        lat: null,
        lng: null,
        source: null,
        tractGeoid: null,
        normalizedAddress: null,
      };
    } else if (cache.has(normalized)) {
      const hit = cache.get(normalized)!;
      summary.cached += 1;
      result = {
        status: "ok",
        lat: hit.lat,
        lng: hit.lng,
        source: hit.source ?? "census",
        tractGeoid: hit.tractGeoid,
        normalizedAddress: normalized,
      };
    } else {
      result = await geocodeAddress(deal.address, deal.city, deal.state);
      if (result.status === "ok" && result.lat !== null && result.lng !== null) {
        cache.set(normalized, {
          lat: result.lat,
          lng: result.lng,
          tractGeoid: result.tractGeoid,
          source: result.source,
        });
      }
    }

    const { error: updateError } = await admin
      .from("deals")
      .update({
        lat: result.lat,
        lng: result.lng,
        geocode_status: result.status,
        geocode_source: result.source,
        geocoded_at: new Date().toISOString(),
        census_tract_geoid: result.tractGeoid,
        geocoded_address: result.normalizedAddress,
      })
      .eq("id", deal.id);

    if (updateError) {
      throw new Error(`Failed to save geocode for ${deal.id}: ${updateError.message}`);
    }

    summary.processed += 1;
    summary[result.status] += 1;
    if (result.tractGeoid) geoidSet.add(result.tractGeoid);
  }

  // Also ensure demographics are cached/fresh for already-geocoded deals
  for (const row of allDeals ?? []) {
    if (row.census_tract_geoid) geoidSet.add(row.census_tract_geoid);
  }

  summary.tractGeoids = [...geoidSet];
  if (summary.tractGeoids.length > 0) {
    try {
      summary.demographics = await ensureTractDemographics(summary.tractGeoids);
    } catch (demoError) {
      console.error("Unable to refresh tract demographics batch.", demoError);
    }
  }
  return summary;
}
