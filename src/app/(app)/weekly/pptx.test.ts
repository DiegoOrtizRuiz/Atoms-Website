import { beforeEach, expect, it, vi } from "vitest";
import type { WeeklyModel, WeeklyRow } from "@/lib/weekly";

const mocks = vi.hoisted(() => ({ addTable: vi.fn() }));
vi.mock("pptxgenjs", () => ({
  default: class {
    ShapeType = { roundedRect: "roundedRect", line: "line" };
    addSlide() {
      return {
        addText: vi.fn(),
        addShape: vi.fn(),
        addTable: mocks.addTable,
      };
    }
    writeFile() {
      return Promise.resolve();
    }
  },
}));

import { exportWeeklyPptx } from "./pptx";

beforeEach(() => mocks.addTable.mockClear());

it("italicizes only unconfirmed values, including the displayed notes field", async () => {
  const row: WeeklyRow = {
    id: "deal",
    vertical: "Food",
    market: "Seattle",
    address: "Address",
    location: "",
    stage: "In Contract",
    stageRaw: null,
    listPrice: 100,
    buildingSf: 10,
    pricePerSf: 10,
    lotSf: 20,
    notes: "Source note",
    notesField: "notes",
    fieldProvenance: {
      market: "assumed",
      address: "confirmed",
      stage: "llm_suggested",
      list_price: "confirmed",
      bldg_sf: "assumed",
      lot_sf: "confirmed",
      notes: "assumed",
      weekly_note: "confirmed",
    },
    showInWeekly: true,
    needsReview: false,
    updatedAt: "2026-11-19T00:00:00Z",
  };
  const model: WeeklyModel = {
    weekStart: "2026-11-16",
    sections: [{ vertical: "Food", rows: [row], counts: {} }],
    attention: [],
    allRows: [row],
  };

  await exportWeeklyPptx(model);
  const table = mocks.addTable.mock.calls[0][0];
  const cells = table[1];
  expect(cells.map((cell: { options?: { italic: boolean } }) => cell.options?.italic)).toEqual([
    true, false, true, false, true, undefined, false, true,
  ]);
});
