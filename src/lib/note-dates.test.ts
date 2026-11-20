import { describe, expect, it } from "vitest";
import { extractNoteDates } from "./note-dates";

describe("extractNoteDates", () => {
  const reference = new Date("2026-11-19T00:00:00.000Z");

  it("extracts labeled dates and resolves yearless dates to their next occurrence", () => {
    expect(
      extractNoteDates(
        "closing 11/25, DD date 9/18, PSA 11/25/27",
        reference,
      ),
    ).toEqual([
      { label: "closing", date_text: "11/25", iso_guess: "2026-11-25" },
      { label: "DD", date_text: "9/18", iso_guess: "2027-09-18" },
      { label: "PSA", date_text: "11/25/27", iso_guess: "2027-11-25" },
    ]);
  });

  it("ignores unlabeled, malformed, and missing notes", () => {
    expect(extractNoteDates("Follow up 11/25; closing 13/40", reference)).toEqual(
      [],
    );
    expect(extractNoteDates(null, reference)).toEqual([]);
  });
});
