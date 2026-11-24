import { describe, expect, it } from "vitest";
import { dealStages, type Deal, type VerticalConfig } from "@/lib/deals";
import { STAGE_STYLES } from "@/lib/stage-colors";
import type { TractDemographicsRow } from "./acs";
import {
  formatTractDemographics,
  nextKeyDateForDeal,
  partitionDealsForMap,
  verticalAttributesForDeal,
} from "./map-helpers";

function makeDeal(overrides: Partial<Deal>): Deal {
  return {
    id: "av_clientC_atl:2",
    source_tab: "av_clientC_atl",
    source_row: 2,
    vertical: "Autonomous Vehicle",
    client: "Client C",
    market: "Atlanta",
    city: "Atlanta",
    state: "GA",
    state_inferred: false,
    address: "635 Angier Ave",
    stage: "In Contract",
    stage_raw: "In Contract",
    stage_entered_at: "2026-11-01T00:00:00Z",
    bldg_sf: 10000,
    list_price: 2850000,
    lot_sf: 21780,
    price_per_sf: 285,
    price_per_lot_sf: 130.85,
    broker: "Sam Ortiz",
    broker_phone: "404-555-0110",
    notes: "DD date 9/18, kicked off environmental review",
    weekly_note: null,
    show_in_weekly: true,
    attributes: { power_amps: 400, zoning: "I-1" },
    attributes_raw: { power_amps: "400A", zoning: "I-1" },
    field_provenance: { power_amps: "assumed" },
    notes_extracted: null,
    needs_review: false,
    review_reasons: [],
    version: 1,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    updated_by: null,
    lat: 33.7647,
    lng: -84.3662,
    geocode_status: "ok",
    geocode_source: "census",
    geocoded_at: "2026-11-24T00:00:00Z",
    census_tract_geoid: "13121001801",
    geocoded_address: "635 angier ave, atlanta, ga",
    ...overrides,
  };
}

const avConfig: VerticalConfig = {
  tab_prefix: "av",
  vertical: "Autonomous Vehicle",
  sort_order: 20,
  active: true,
  description: null,
  updated_at: "2026-11-01T00:00:00Z",
  updated_by: null,
  columns: [
    { key: "zoning", label: "Zoning", type: "string" },
    { key: "power_amps", label: "Power", type: "number" },
  ],
};

const atlTract: TractDemographicsRow = {
  geoid: "13121001801",
  fetched_at: "2026-11-24T00:00:00Z",
  population: 4812,
  median_household_income: 92450,
  median_age: 33.7,
  households: 2410,
  pct_bachelors: 60.2,
  source: "Census ACS 5-yr (2023)",
};

describe("map-helpers and DealsMap fallback", () => {
  it("keeps no-address and 0,0 deals off the map with explicit reasons", () => {
    const deals = [
      makeDeal({ id: "ok-1" }),
      makeDeal({
        id: "no-addr",
        address: null,
        lat: null,
        lng: null,
        geocode_status: "no_address",
      }),
      makeDeal({
        id: "zero-zero",
        lat: 0,
        lng: 0,
        geocode_status: "ok",
      }),
      makeDeal({
        id: "missed",
        lat: null,
        lng: null,
        geocode_status: "not_found",
      }),
    ];

    const { mapped, unmapped } = partitionDealsForMap(deals);
    expect(mapped.map((d) => d.id)).toEqual(["ok-1"]);
    expect(unmapped.map((u) => [u.deal.id, u.reason])).toEqual([
      ["no-addr", "No address"],
      ["zero-zero", "Pending geocode"],
      ["missed", "Address not found"],
    ]);
  });

  it("formats 635 Angier Ave assumption attribute and tract demographics with GEOID", () => {
    const deal = makeDeal({});
    const attrs = verticalAttributesForDeal(deal, avConfig);
    expect(attrs).toEqual([
      { key: "zoning", label: "Zoning", displayValue: "I-1", provenance: undefined },
      { key: "power_amps", label: "Power", displayValue: "400A", provenance: "assumed" },
    ]);

    const demo = formatTractDemographics(atlTract);
    expect(demo).toEqual({
      geoid: "13121001801",
      sourceLabel: "Census ACS 5-yr, tract 13121001801",
      population: "4,812",
      medianIncome: "$92,450",
      medianAge: "33.7 yrs",
      households: "2,410",
      pctBachelors: "60.2%",
    });

    const missingDemo = formatTractDemographics({
      ...atlTract,
      median_household_income: null,
      pct_bachelors: null,
    });
    expect(missingDemo?.medianIncome).toBe("—");
    expect(missingDemo?.pctBachelors).toBe("—");
  });

  it("extracts next key date from notes", () => {
    const deal = makeDeal({ notes: "closing 11/25, deposit $250,000" });
    const nextDate = nextKeyDateForDeal(deal, new Date("2026-11-19T00:00:00Z"));
    expect(nextDate).toEqual({
      label: "closing",
      formattedDate: "Nov 25, 2026",
      iso: "2026-11-25",
    });
  });

  it("filters Food deals and preserves shared stage colors for map pins and pills", () => {
    const deals = [
      makeDeal({ id: "av-1", vertical: "Autonomous Vehicle" }),
      makeDeal({
        id: "food_clientA_nyc:2",
        vertical: "Food",
        address: "7500 NW 25th St",
        city: "Hialeah",
        state: "FL",
        state_inferred: true,
        lat: 25.8221,
        lng: -80.2815,
      }),
      makeDeal({
        id: "food_clientA_nyc:4",
        vertical: "Food",
        address: null,
        lat: null,
        lng: null,
        geocode_status: "no_address",
      }),
    ];

    const foodOnly = deals.filter((deal) => deal.vertical === "Food");
    const { mapped, unmapped } = partitionDealsForMap(foodOnly);
    expect(mapped.map((deal) => deal.id)).toEqual(["food_clientA_nyc:2"]);
    expect(mapped[0].state_inferred).toBe(true);
    expect(unmapped.map((item) => [item.deal.id, item.reason])).toEqual([
      ["food_clientA_nyc:4", "No address"],
    ]);

    for (const stage of dealStages) {
      expect(STAGE_STYLES[stage].badgeClass).toBeTruthy();
      expect(STAGE_STYLES[stage].pinHex).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
