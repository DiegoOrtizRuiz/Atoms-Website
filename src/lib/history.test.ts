import { describe, expect, it } from "vitest";
import type { DealHistory } from "./deals";
import { expandHistoryEntry } from "./history";

describe("expandHistoryEntry", () => {
  const entry: DealHistory = {
    id: 1,
    deal_id: "deal",
    changed_at: "2026-11-19T00:00:00Z",
    changed_by: null,
    field: "attributes",
    old_value: { zoning: "I-1", doors: 2, nested: { a: 1, b: 2 } },
    new_value: { zoning: "I-2", added: true, nested: { b: 2, a: 1 } },
    seed_source: null,
  };

  it("expands only changed, added, or removed attribute keys", () => {
    expect(expandHistoryEntry(entry).map(({ field, old_value, new_value }) => ({
      field,
      old_value,
      new_value,
    }))).toEqual([
      { field: "attributes.zoning", old_value: "I-1", new_value: "I-2" },
      { field: "attributes.doors", old_value: 2, new_value: null },
      { field: "attributes.added", old_value: null, new_value: true },
    ]);
  });

  it("leaves non-attribute changes intact", () => {
    const stage = { ...entry, field: "stage", old_value: "Sourcing", new_value: "Pre LOI" };
    expect(expandHistoryEntry(stage)).toEqual([stage]);
  });
});
