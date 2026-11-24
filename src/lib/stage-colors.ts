import type { DealStage } from "@/lib/deals";

export type StageStyle = {
  badgeClass: string;
  pinHex: string;
  pinBorderHex: string;
};

export const STAGE_STYLES: Readonly<Record<DealStage, StageStyle>> = {
  Sourcing: {
    badgeClass: "bg-slate-100 text-slate-700",
    pinHex: "#64748b",
    pinBorderHex: "#334155",
  },
  "In Pipeline": {
    badgeClass: "bg-sky-100 text-sky-800",
    pinHex: "#0284c7",
    pinBorderHex: "#075985",
  },
  "Pre LOI": {
    badgeClass: "bg-cyan-100 text-cyan-800",
    pinHex: "#0891b2",
    pinBorderHex: "#155e75",
  },
  "Negotiating LOI": {
    badgeClass: "bg-indigo-100 text-indigo-800",
    pinHex: "#4f46e5",
    pinBorderHex: "#3730a3",
  },
  "Negotiating PSA": {
    badgeClass: "bg-violet-100 text-violet-800",
    pinHex: "#7c3aed",
    pinBorderHex: "#5b21b6",
  },
  "In Contract": {
    badgeClass: "bg-amber-100 text-amber-800",
    pinHex: "#d97706",
    pinBorderHex: "#92400e",
  },
  Closed: {
    badgeClass: "bg-emerald-100 text-emerald-800",
    pinHex: "#059669",
    pinBorderHex: "#065f46",
  },
  "On Hold": {
    badgeClass: "bg-zinc-200 text-zinc-700",
    pinHex: "#71717a",
    pinBorderHex: "#3f3f46",
  },
  "Needs review": {
    badgeClass: "bg-red-100 text-red-800",
    pinHex: "#dc2626",
    pinBorderHex: "#991b1b",
  },
};

export function stageStyleFor(stage: string | null | undefined): StageStyle {
  if (stage && Object.hasOwn(STAGE_STYLES, stage)) {
    return STAGE_STYLES[stage as DealStage];
  }
  return STAGE_STYLES["Needs review"];
}
