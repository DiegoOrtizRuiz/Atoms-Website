import type { DealStage } from "@/lib/deals";

export const STAGES = [
  "Sourcing",
  "In Pipeline",
  "Pre LOI",
  "Negotiating LOI",
  "Negotiating PSA",
  "In Contract",
  "Closed",
  "On Hold",
] as const satisfies readonly DealStage[];

export const STATUS_MAP: Readonly<Record<string, DealStage>> = {
  sourcing: "Sourcing",
  "in pipeline": "In Pipeline",
  pipeline: "In Pipeline",
  "pre loi": "Pre LOI",
  "pre-loi": "Pre LOI",
  "negotiating loi": "Negotiating LOI",
  "nego loi": "Negotiating LOI",
  "negotiating psa": "Negotiating PSA",
  "nego psa": "Negotiating PSA",
  "in contract": "In Contract",
  "under contract": "In Contract",
  closed: "Closed",
  "on hold": "On Hold",
  // Deliberately NOT mapped: "listed" (sell-side wording, not in the acquisition funnel)
};

export function normalizeStatus(raw: string | null): DealStage | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return STATUS_MAP[key] ?? null;
}
