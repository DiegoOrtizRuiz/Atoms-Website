import { describe, expect, it, vi } from "vitest";
import { geocodeAddress, normalizeGeoAddress } from "./geocode";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("normalizeGeoAddress", () => {
  it("returns null when street address is missing or blank", () => {
    expect(normalizeGeoAddress(null, "Atlanta", "GA")).toBeNull();
    expect(normalizeGeoAddress("   ", "Miami", "FL")).toBeNull();
  });

  it("normalizes whitespace and casing for caching", () => {
    expect(normalizeGeoAddress("  635  Angier Ave ", " Atlanta", "GA ")).toBe(
      "635 angier ave, atlanta, ga",
    );
  });
});

describe("geocodeAddress", () => {
  it("marks blank addresses as no_address without calling external APIs or faking 0,0", async () => {
    const fetchMock = vi.fn();
    const result = await geocodeAddress(null, "Miami", "FL", {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "no_address",
      lat: null,
      lng: null,
      source: null,
      tractGeoid: null,
      normalizedAddress: null,
    });
  });

  it("parses US Census geographies response (y=lat, x=lng, 11-digit GEOID)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        result: {
          addressMatches: [
            {
              coordinates: { x: -84.3662, y: 33.7647 },
              geographies: {
                "Census Tracts": [{ GEOID: "13121001801" }],
              },
            },
          ],
        },
      }),
    );

    const result = await geocodeAddress("635 Angier Ave", "Atlanta", "GA", {
      fetchImpl: fetchMock as unknown as typeof fetch,
      googleApiKey: "",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("geographies/onelineaddress");
    expect(calledUrl).toContain("benchmark=Public_AR_Current");
    expect(calledUrl).toContain("vintage=Current_Current");
    expect(result).toEqual({
      status: "ok",
      lat: 33.7647,
      lng: -84.3662,
      source: "census",
      tractGeoid: "13121001801",
      normalizedAddress: "635 angier ave, atlanta, ga",
    });
  });

  it("returns not_found when Census misses and no Google key is configured", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ result: { addressMatches: [] } }));

    const result = await geocodeAddress("999 Unknown Way", "Nowhere", "XX", {
      fetchImpl: fetchMock as unknown as typeof fetch,
      googleApiKey: "",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("not_found");
    expect(result.lat).toBeNull();
    expect(result.lng).toBeNull();
  });

  it("falls back to Google Geocoding API when configured and resolves Census tract by coordinates", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ result: { addressMatches: [] } }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: "OK",
          results: [{ geometry: { location: { lat: 25.8221, lng: -80.2815 } } }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          result: {
            geographies: {
              "Census Tracts": [{ GEOID: "12086000705" }],
            },
          },
        }),
      );

    const result = await geocodeAddress("7500 NW 25th St", "Hialeah", "FL", {
      fetchImpl: fetchMock as unknown as typeof fetch,
      googleApiKey: "test-google-key",
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      "maps.googleapis.com/maps/api/geocode/json",
    );
    expect(String(fetchMock.mock.calls[2][0])).toContain(
      "geographies/coordinates",
    );
    expect(result).toEqual({
      status: "ok",
      lat: 25.8221,
      lng: -80.2815,
      source: "google",
      tractGeoid: "12086000705",
      normalizedAddress: "7500 nw 25th st, hialeah, fl",
    });
  });

  it("returns status error on network failure without throwing", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("timeout"));

    const result = await geocodeAddress("37 S Hudson St", "Seattle", "WA", {
      fetchImpl: fetchMock as unknown as typeof fetch,
      googleApiKey: "",
    });

    expect(result.status).toBe("error");
    expect(result.lat).toBeNull();
    expect(result.lng).toBeNull();
  });
});
