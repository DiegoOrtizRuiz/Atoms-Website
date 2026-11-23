import { describe, expect, it } from "vitest";
import type { Deal } from "./deals";
import { buildWeeklyModel } from "./weekly";

function makeDeal(overrides: Partial<Deal>): Deal {
  return {
    address: null,
    attributes: {},
    attributes_raw: {},
    bldg_sf: null,
    broker: null,
    broker_phone: null,
    city: null,
    client: null,
    created_at: "2026-11-19T00:00:00.000Z",
    field_provenance: {},
    id: "deal-1",
    list_price: null,
    lot_sf: null,
    market: null,
    needs_review: false,
    notes: null,
    notes_extracted: { key_dates: [] },
    price_per_lot_sf: null,
    price_per_sf: null,
    review_reasons: [],
    show_in_weekly: true,
    source_row: null,
    source_tab: null,
    stage: "In Contract",
    stage_entered_at: "2026-11-01T00:00:00.000Z",
    stage_raw: null,
    state: null,
    state_inferred: false,
    updated_at: "2026-11-19T00:00:00.000Z",
    updated_by: null,
    version: 2,
    vertical: "Industrial",
    weekly_note: null,
    ...overrides,
  };
}

describe("buildWeeklyModel attention dates", () => {
  it("uses configured order and omits inactive verticals from weekly output", () => {
    const model = buildWeeklyModel(
      [
        makeDeal({ id: "inactive", vertical: "Hidden", address: "Hidden deal" }),
        makeDeal({ id: "second", vertical: "Second", address: "Second deal" }),
        makeDeal({ id: "first", vertical: "First", address: "First deal" }),
      ],
      [
        {
          active: true,
          columns: [],
          description: null,
          sort_order: 20,
          tab_prefix: "second",
          updated_at: "2026-11-19T00:00:00.000Z",
          updated_by: null,
          vertical: "Second",
        },
        {
          active: false,
          columns: [],
          description: null,
          sort_order: 10,
          tab_prefix: "hidden",
          updated_at: "2026-11-19T00:00:00.000Z",
          updated_by: null,
          vertical: "Hidden",
        },
        {
          active: true,
          columns: [],
          description: null,
          sort_order: 30,
          tab_prefix: "first",
          updated_at: "2026-11-19T00:00:00.000Z",
          updated_by: null,
          vertical: "First",
        },
      ],
      [],
      true,
      new Date("2026-11-19T00:00:00.000Z"),
    );

    expect(model.sections.map((section) => section.vertical)).toEqual([
      "Second",
      "First",
    ]);
    expect(model.allRows.map((row) => row.vertical)).toEqual(["Second", "First"]);
  });

  it("uses LLM iso_guess, supports legacy dates, and ignores null guesses", () => {
    const deal = makeDeal({
      created_at: "2026-11-01T00:00:00.000Z",
      notes_extracted: {
        key_dates: [
          { label: "Closing", date_text: "11/25", iso_guess: "2026-11-25" },
          { label: "Deadline", date: "2026-11-26" },
          { label: "Unknown", date: "2026-11-27", iso_guess: null },
        ],
      },
    });
    const model = buildWeeklyModel(
      [deal], [], [], true, new Date("2026-11-19T00:00:00.000Z"),
    );
    expect(model.attention.map((item) => item.label)).toEqual([
      "Closing: Nov 25",
      "Deadline: Nov 26",
    ]);
  });

  it("shows Seattle closing dates, tolerates null notes, and rolls past dates forward", () => {
    const model = buildWeeklyModel(
      [
        makeDeal({
          id: "seattle",
          address: "37 S Hudson St",
          created_at: "2026-11-01T00:00:00.000Z",
          notes: "closing 11/25, deposit $250,000",
        }),
        makeDeal({
          id: "no-notes",
          address: "No notes",
          created_at: "2026-11-01T00:00:00.000Z",
          notes: null,
        }),
        makeDeal({
          id: "past-yearless",
          address: "Past yearless date",
          created_at: "2026-11-01T00:00:00.000Z",
          notes: "DD date 9/18",
        }),
      ],
      [],
      [],
      true,
      new Date("2026-11-19T00:00:00.000Z"),
    );

    expect(model.attention).toEqual([
      expect.objectContaining({
        kind: "key_date",
        detail: "37 S Hudson St",
        label: "closing: Nov 25",
      }),
    ]);
  });

  it("uses created_at for new deals and prioritizes key dates and stage changes", () => {
    const keyDeal = makeDeal({
      id: "key",
      address: "Key deal",
      created_at: "2026-11-01T00:00:00.000Z",
      notes_extracted: {
        key_dates: [
          { label: "Closing", date_text: "11/28", iso_guess: "2026-11-28" },
          { label: "Closing", date_text: "11/25", iso_guess: "2026-11-25" },
        ],
      },
    });
    const stageDeals = [
      makeDeal({
        id: "stage-old",
        address: "Older stage change",
        created_at: "2026-11-01T00:00:00.000Z",
      }),
      makeDeal({
        id: "stage-new",
        address: "Newer stage change",
        created_at: "2026-11-01T00:00:00.000Z",
      }),
    ];
    const newDeal = makeDeal({
      id: "new",
      address: "New deal",
      created_at: "2026-11-18T00:00:00.000Z",
    });
    const history = stageDeals.map((deal, index) => ({
      changed_at: `2026-11-${index === 0 ? "17" : "18"}T12:00:00.000Z`,
      changed_by: null,
      deal_id: deal.id,
      field: "stage",
      id: index + 1,
      new_value: "In Contract",
      old_value: "Pre LOI",
      seed_source: null,
    }));

    const model = buildWeeklyModel(
      [keyDeal, ...stageDeals, newDeal],
      [],
      history,
      true,
      new Date("2026-11-19T00:00:00.000Z"),
    );

    expect(model.attention.map((item) => item.kind)).toEqual([
      "key_date",
      "key_date",
      "stage_change",
      "stage_change",
      "new",
    ]);
    expect(model.attention.slice(0, 2).map((item) => item.label)).toEqual([
      "Closing: Nov 25",
      "Closing: Nov 28",
    ]);
    expect(model.attention[2].detail).toBe("Newer stage change");
    const capped = buildWeeklyModel(
      [
        makeDeal({
          notes_extracted: {
            key_dates: Array.from({ length: 13 }, () => ({
              label: "Closing",
              date_text: "11/25",
              iso_guess: "2026-11-25",
            })),
          },
        }),
        newDeal,
      ],
      [],
      history,
      true,
      new Date("2026-11-19T00:00:00.000Z"),
    );
    expect(capped.attention).toHaveLength(12);
    expect(capped.attention.every((item) => item.kind === "key_date")).toBe(true);
    expect(
      buildWeeklyModel(
        [makeDeal({ version: 5, created_at: "2026-11-10T00:00:00.000Z" })],
        [],
        [],
        true,
        new Date("2026-11-19T00:00:00.000Z"),
      ).attention,
    ).toEqual([]);
  });
});
