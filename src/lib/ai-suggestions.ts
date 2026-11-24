import type { Json } from "@/lib/database.types";
import { jsonObject, provenanceFor, type Deal } from "@/lib/deals";

export type AiSectionKey =
  | "weekly_note"
  | "key_dates"
  | "price_context"
  | "risks"
  | "next_step"
  | "deal_type"
  | "suggested_stage";

export type EvidenceEntry = {
  field: string;
  quote: string;
};

export type ExtractedKeyDate = {
  label: string;
  date_text: string;
  iso_guess: string | null;
};

export type ParsedAiExtraction = {
  key_dates: ExtractedKeyDate[];
  negotiated_price: number | null;
  price_context: string | null;
  risks: string[];
  next_step: string | null;
  deal_type: "buy" | "lease" | "unknown";
  weekly_note: string | null;
  evidence: EvidenceEntry[];
  confidence: number | null;
  suggested_stage: string | null;
  suggested_stage_reason: string | null;
  dismissed: Set<AiSectionKey>;
};

export const AI_SECTION_KEYS: readonly AiSectionKey[] = [
  "weekly_note",
  "key_dates",
  "price_context",
  "risks",
  "next_step",
  "deal_type",
  "suggested_stage",
] as const;

export function parseEvidence(raw: unknown): EvidenceEntry[] {
  if (Array.isArray(raw)) {
    return raw.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const obj = item as { field?: unknown; quote?: unknown };
      if (typeof obj.field === "string" && typeof obj.quote === "string" && obj.quote) {
        return [{ field: obj.field, quote: obj.quote }];
      }
      return [];
    });
  }
  // Backwards compatibility if an older object-shaped evidence record exists
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return Object.entries(raw as Record<string, unknown>).flatMap(([field, quote]) =>
      typeof quote === "string" && quote ? [{ field, quote }] : [],
    );
  }
  return [];
}

export function evidenceQuotesFor(
  evidence: EvidenceEntry[],
  fields: string[],
): string[] {
  const wanted = new Set(fields);
  return [
    ...new Set(
      evidence
        .filter((entry) => wanted.has(entry.field))
        .map((entry) => entry.quote),
    ),
  ];
}

export function parseAiExtraction(deal: Pick<Deal, "notes_extracted" | "weekly_note">): ParsedAiExtraction | null {
  const obj = jsonObject(deal.notes_extracted);
  const hasExtracted = Object.keys(obj).length > 0;
  if (!hasExtracted && !deal.weekly_note) return null;

  const keyDates: ExtractedKeyDate[] = Array.isArray(obj.key_dates)
    ? obj.key_dates.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const rec = item as Record<string, unknown>;
        if (typeof rec.label !== "string" || typeof rec.date_text !== "string") return [];
        return [
          {
            label: rec.label,
            date_text: rec.date_text,
            iso_guess: typeof rec.iso_guess === "string" ? rec.iso_guess : null,
          },
        ];
      })
    : [];

  const risks = Array.isArray(obj.risks)
    ? obj.risks.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];

  const dismissed = new Set<AiSectionKey>(
    Array.isArray(obj._dismissed)
      ? obj._dismissed.filter((item): item is AiSectionKey =>
          typeof item === "string" && (AI_SECTION_KEYS as readonly string[]).includes(item),
        )
      : [],
  );

  const dealType =
    obj.deal_type === "buy" || obj.deal_type === "lease" || obj.deal_type === "unknown"
      ? obj.deal_type
      : "unknown";

  return {
    key_dates: keyDates,
    negotiated_price:
      typeof obj.negotiated_price === "number" && Number.isFinite(obj.negotiated_price)
        ? obj.negotiated_price
        : null,
    price_context: typeof obj.price_context === "string" ? obj.price_context : null,
    risks,
    next_step: typeof obj.next_step === "string" ? obj.next_step : null,
    deal_type: dealType,
    weekly_note:
      deal.weekly_note ?? (typeof obj.weekly_note === "string" ? obj.weekly_note : null),
    evidence: parseEvidence(obj.evidence),
    confidence:
      typeof obj.confidence === "number" && Number.isFinite(obj.confidence)
        ? obj.confidence
        : null,
    suggested_stage:
      typeof obj.suggested_stage === "string" ? obj.suggested_stage : null,
    suggested_stage_reason:
      typeof obj.suggested_stage_reason === "string"
        ? obj.suggested_stage_reason
        : null,
    dismissed,
  };
}

export function sectionProvenanceKey(section: AiSectionKey): string {
  return section === "weekly_note" ? "weekly_note" : `ai:${section}`;
}

export function activeSuggestionSections(
  deal: Pick<Deal, "notes_extracted" | "weekly_note">,
): AiSectionKey[] {
  const parsed = parseAiExtraction(deal);
  if (!parsed) return [];
  const sections: AiSectionKey[] = [];
  if (parsed.weekly_note && !parsed.dismissed.has("weekly_note")) {
    sections.push("weekly_note");
  }
  if (parsed.key_dates.length > 0 && !parsed.dismissed.has("key_dates")) {
    sections.push("key_dates");
  }
  if (
    (parsed.negotiated_price !== null || parsed.price_context !== null) &&
    !parsed.dismissed.has("price_context")
  ) {
    sections.push("price_context");
  }
  if (parsed.risks.length > 0 && !parsed.dismissed.has("risks")) {
    sections.push("risks");
  }
  if (parsed.next_step && !parsed.dismissed.has("next_step")) {
    sections.push("next_step");
  }
  if (parsed.deal_type !== "unknown" && !parsed.dismissed.has("deal_type")) {
    sections.push("deal_type");
  }
  if (parsed.suggested_stage && !parsed.dismissed.has("suggested_stage")) {
    sections.push("suggested_stage");
  }
  return sections;
}

export function sectionStatus(
  deal: Pick<Deal, "field_provenance">,
  section: AiSectionKey,
): "llm_suggested" | "confirmed" | undefined {
  const prov = jsonObject(deal.field_provenance);
  if (section === "weekly_note") {
    const val = prov.weekly_note;
    return val === "confirmed" || val === "llm_suggested" ? val : undefined;
  }
  const direct = prov[`ai:${section}`];
  if (direct === "confirmed" || direct === "llm_suggested") return direct;
  const overall = prov.notes_extracted;
  return overall === "confirmed" || overall === "llm_suggested" ? overall : undefined;
}

export function pendingAiSections(
  deal: Pick<Deal, "notes_extracted" | "weekly_note" | "field_provenance">,
): AiSectionKey[] {
  const active = activeSuggestionSections(deal);
  return active.filter((section) => sectionStatus(deal, section) === "llm_suggested");
}

export function hasPendingAiSuggestions(
  deal: Pick<Deal, "notes_extracted" | "weekly_note" | "field_provenance">,
): boolean {
  if (pendingAiSections(deal).length > 0) return true;
  const prov = jsonObject(deal.field_provenance);
  return (
    (prov.weekly_note === "llm_suggested" && Boolean(deal.weekly_note)) ||
    (prov.notes_extracted === "llm_suggested" &&
      activeSuggestionSections(deal).some((s) => s !== "weekly_note"))
  );
}

export function withUpdatedSectionProvenance(
  existingProvenance: Json | null | undefined,
  deal: Pick<Deal, "notes_extracted" | "weekly_note">,
  section: AiSectionKey,
  nextStatus: "confirmed" | "dismissed",
): Record<string, Json> {
  const next: Record<string, Json> = {
    ...(jsonObject(existingProvenance) as Record<string, Json>),
  };
  const key = sectionProvenanceKey(section);
  if (nextStatus === "confirmed") {
    next[key] = "confirmed";
  } else {
    delete next[key];
  }

  // If all non-weekly_note active sections are confirmed (or none left), mark notes_extracted confirmed/cleared
  const parsed = parseAiExtraction(deal);
  if (parsed && section !== "weekly_note") {
    const remainingNonWeekly = activeSuggestionSections(deal).filter(
      (item) => item !== "weekly_note" && !(nextStatus === "dismissed" && item === section),
    );
    const allResolved = remainingNonWeekly.every(
      (item) => next[sectionProvenanceKey(item)] === "confirmed",
    );
    if (remainingNonWeekly.length === 0) {
      delete next.notes_extracted;
    } else if (allResolved) {
      next.notes_extracted = "confirmed";
    }
  }
  return next;
}

export function isWeeklyNoteAiDrafted(
  deal: Pick<Deal, "weekly_note" | "field_provenance">,
): boolean {
  return Boolean(deal.weekly_note) && provenanceFor(deal as Deal, "weekly_note") === "llm_suggested";
}
