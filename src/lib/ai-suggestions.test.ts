import { describe, expect, it } from "vitest";
import {
  evidenceQuotesFor,
  hasPendingAiSuggestions,
  parseAiExtraction,
  parseEvidence,
  pendingAiSections,
  withUpdatedSectionProvenance,
} from "./ai-suggestions";

describe("ai-suggestions helpers", () => {
  it("parses both strict-mode {field, quote} evidence arrays and legacy maps", () => {
    const fromArray = parseEvidence([
      { field: "key_dates", quote: "closing 11/25" },
      { field: "weekly_note", quote: "closing 11/25, deposit $250,000" },
    ]);
    expect(fromArray).toHaveLength(2);
    expect(evidenceQuotesFor(fromArray, ["key_dates"])).toEqual(["closing 11/25"]);

    const fromLegacy = parseEvidence({ price_context: "deposit $250,000" });
    expect(evidenceQuotesFor(fromLegacy, ["price_context"])).toEqual([
      "deposit $250,000",
    ]);
  });

  it("identifies pending AI suggestions and updates provenance when accepted or dismissed", () => {
    const deal = {
      weekly_note: "Closing scheduled for November 25; $250,000 deposit noted.",
      notes_extracted: {
        key_dates: [{ label: "Closing", date_text: "11/25", iso_guess: "2026-11-25" }],
        negotiated_price: null,
        price_context: null,
        risks: [],
        next_step: null,
        deal_type: "unknown",
        weekly_note: "Closing scheduled for November 25; $250,000 deposit noted.",
        evidence: [{ field: "key_dates", quote: "closing 11/25" }],
        confidence: 0.95,
        suggested_stage: null,
        suggested_stage_reason: null,
      },
      field_provenance: {
        weekly_note: "llm_suggested",
        notes_extracted: "llm_suggested",
      },
    };

    const parsed = parseAiExtraction(deal);
    expect(parsed?.confidence).toBe(0.95);
    expect(pendingAiSections(deal)).toEqual(["weekly_note", "key_dates"]);
    expect(hasPendingAiSuggestions(deal)).toBe(true);

    // Accept key_dates -> marks ai:key_dates AND notes_extracted confirmed (since key_dates was the only non-weekly active section)
    const afterKeyDates = withUpdatedSectionProvenance(
      deal.field_provenance,
      deal,
      "key_dates",
      "confirmed",
    );
    expect(afterKeyDates["ai:key_dates"]).toBe("confirmed");
    expect(afterKeyDates.notes_extracted).toBe("confirmed");
    expect(afterKeyDates.weekly_note).toBe("llm_suggested");

    // Accept weekly_note -> no pending AI suggestions remain
    const afterAll = withUpdatedSectionProvenance(
      afterKeyDates,
      deal,
      "weekly_note",
      "confirmed",
    );
    expect(
      hasPendingAiSuggestions({ ...deal, field_provenance: afterAll }),
    ).toBe(false);
  });
});
