import type { CurrentUser } from "@/lib/auth";
import type { Database, Json } from "@/lib/database.types";

export type Deal = Database["public"]["Tables"]["deals"]["Row"];
export type DealHistory =
  Database["public"]["Tables"]["deal_history"]["Row"];
export type VerticalConfig =
  Database["public"]["Tables"]["vertical_config"]["Row"];
export type DealStage = Database["public"]["Enums"]["deal_stage"];

export const dealStages: DealStage[] = [
  "Sourcing",
  "In Pipeline",
  "Pre LOI",
  "Negotiating LOI",
  "Negotiating PSA",
  "In Contract",
  "Closed",
  "On Hold",
  "Needs review",
];

export const weeklyStages: DealStage[] = [
  "Pre LOI",
  "Negotiating LOI",
  "Negotiating PSA",
  "In Contract",
];

export function canEditDeal(user: CurrentUser, deal: Deal) {
  if (user.role === "admin") return true;
  if (user.role === "acq_lead") {
    return Boolean(deal.vertical && user.verticals.includes(deal.vertical));
  }
  if (user.role === "analyst") {
    return Boolean(deal.client && user.clients.includes(deal.client));
  }
  return false;
}

export function canConfirmDeal(user: CurrentUser, deal: Deal) {
  return (
    user.role === "admin" ||
    (user.role === "acq_lead" &&
      Boolean(deal.vertical && user.verticals.includes(deal.vertical)))
  );
}

export function jsonObject(value: Json | null | undefined) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

export function isUnconfirmed(status: unknown): boolean {
  return status === "assumed" || status === "llm_suggested";
}

export function provenanceFor(
  deal: Deal,
  field: string,
): "assumed" | "llm_suggested" | "confirmed" | undefined {
  const status = jsonObject(deal.field_provenance)[field];
  return status === "assumed" ||
    status === "llm_suggested" ||
    status === "confirmed"
    ? status
    : undefined;
}

export function dealFieldValue(deal: Deal, field: string): unknown {
  if (field.startsWith("attributes.")) {
    return jsonObject(deal.attributes)[field.slice("attributes.".length)];
  }
  return deal[field as keyof Deal];
}
