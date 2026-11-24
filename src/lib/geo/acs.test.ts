import { describe, expect, it, vi } from "vitest";
import {
  computePctBachelorsPlus,
  fetchTractDemographics,
  isDemographicsStale,
  parseCensusNumber,
  parseTractGeoid,
} from "./acs";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Census ACS helpers", () => {
  it("parses valid 11-digit Census tract GEOIDs and rejects malformed ones", () => {
    expect(parseTractGeoid("13121001801")).toEqual({
      state: "13",
      county: "121",
      tract: "001801",
    });
    expect(parseTractGeoid("13121")).toBeNull();
    expect(parseTractGeoid("1312100180A")).toBeNull();
    expect(parseTractGeoid(null)).toBeNull();
  });

  it("treats negative Census sentinel values as null", () => {
    expect(parseCensusNumber("4520")).toBe(4520);
    expect(parseCensusNumber("0")).toBe(0);
    expect(parseCensusNumber("36.4")).toBe(36.4);
    expect(parseCensusNumber("-666666666")).toBeNull();
    expect(parseCensusNumber("-888888888")).toBeNull();
    expect(parseCensusNumber("-999999999")).toBeNull();
    expect(parseCensusNumber("-1")).toBeNull();
    expect(parseCensusNumber("")).toBeNull();
    expect(parseCensusNumber(null)).toBeNull();
  });

  it("checks 180-day cache staleness accurately", () => {
    const now = new Date("2026-11-24T00:00:00Z");
    expect(isDemographicsStale("2026-10-01T00:00:00Z", now)).toBe(false);
    expect(isDemographicsStale("2026-06-01T00:00:00Z", now)).toBe(false);
    expect(isDemographicsStale("2026-05-01T00:00:00Z", now)).toBe(true);
  });

  it("computes % bachelor's+ cleanly and returns null when denominator is zero/missing", () => {
    expect(
      computePctBachelorsPlus({
        total25Plus: 1000,
        bachelors: 320,
        masters: 140,
        professional: 25,
        doctorate: 15,
      }),
    ).toBe(50);
    expect(
      computePctBachelorsPlus({ total25Plus: 0, bachelors: 10 }),
    ).toBeNull();
    expect(
      computePctBachelorsPlus({ total25Plus: 500, bachelors: null }),
    ).toBeNull();
  });
});

describe("fetchTractDemographics", () => {
  it("parses ACS 5-year tract variables and includes optional key only when configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse([
        [
          "B01003_001E",
          "B19013_001E",
          "B01002_001E",
          "B11001_001E",
          "B15003_001E",
          "B15003_022E",
          "B15003_023E",
          "B15003_024E",
          "B15003_025E",
          "state",
          "county",
          "tract",
        ],
        [
          "4812",
          "92450",
          "33.7",
          "2410",
          "3600",
          "1350",
          "620",
          "110",
          "80",
          "13",
          "121",
          "001801",
        ],
      ]),
    );

    const row = await fetchTractDemographics("13121001801", {
      year: "2023",
      apiKey: "",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("https://api.census.gov/data/2023/acs/acs5?");
    expect(url).toContain("for=tract%3A001801");
    expect(url).toContain("in=state%3A13+county%3A121");
    expect(url).not.toContain("key=");

    expect(row).toMatchObject({
      geoid: "13121001801",
      population: 4812,
      median_household_income: 92450,
      median_age: 33.7,
      households: 2410,
      pct_bachelors: 60,
      source: "Census ACS 5-yr (2023)",
    });

    // With API key configured
    await fetchTractDemographics("13121001801", {
      year: "2022",
      apiKey: "secret-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(String(fetchMock.mock.calls[1][0])).toContain("key=secret-key");
    expect(String(fetchMock.mock.calls[1][0])).toContain("/data/2022/acs/acs5");
  });

  it("converts negative sentinels in ACS response to null", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse([
        [
          "B01003_001E",
          "B19013_001E",
          "B01002_001E",
          "B11001_001E",
          "B15003_001E",
          "B15003_022E",
          "B15003_023E",
          "B15003_024E",
          "B15003_025E",
        ],
        [
          "120",
          "-666666666",
          "-666666666",
          "45",
          "90",
          "-666666666",
          "0",
          "0",
          "0",
        ],
      ]),
    );

    const row = await fetchTractDemographics("12086000705", {
      fetchImpl: fetchMock as unknown as typeof fetch,
      apiKey: "",
    });

    expect(row).toMatchObject({
      geoid: "12086000705",
      population: 120,
      median_household_income: null,
      median_age: null,
      households: 45,
      pct_bachelors: null,
    });
  });

  it("returns null gracefully when Census ACS API fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("error", { status: 503 }));
    const row = await fetchTractDemographics("13121001801", {
      fetchImpl: fetchMock as unknown as typeof fetch,
      apiKey: "",
    });
    expect(row).toBeNull();
  });
});
