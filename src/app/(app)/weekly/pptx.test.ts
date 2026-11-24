import { beforeEach, expect, it, vi } from "vitest";
import type { WeeklyModel, WeeklyRow } from "@/lib/weekly";

const mocks = vi.hoisted(() => ({ addTable: vi.fn(), addText: vi.fn() }));
vi.mock("pptxgenjs", () => ({
  default: class {
    ShapeType = { roundedRect: "roundedRect", line: "line" };
    addSlide() {
      return {
        addText: mocks.addText,
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

beforeEach(() => {
  mocks.addTable.mockClear();
  mocks.addText.mockClear();
});

it("italicizes only unconfirmed values and renders AI-drafted note legend", async () => {
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
    notes: "Closing scheduled Nov 25",
    notesField: "weekly_note",
    fieldProvenance: {
      market: "assumed",
      address: "confirmed",
      stage: "llm_suggested",
      list_price: "confirmed",
      bldg_sf: "assumed",
      lot_sf: "confirmed",
      notes: "confirmed",
      weekly_note: "llm_suggested",
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
  expect(cells[7]).toMatchObject({
    text: "● Closing scheduled Nov 25",
    options: { italic: true, color: "7C3AED" },
  });
  const textCalls = mocks.addText.mock.calls.map((call) => String(call[0]));
  expect(textCalls.some((text) => text.includes("AI-drafted note"))).toBe(true);
});
