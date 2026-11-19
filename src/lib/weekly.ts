import { endOfWeek, isAfter, isBefore, parseISO, startOfWeek, subDays } from "date-fns";
import type { Json } from "@/lib/database.types";
import {
  dealStages,
  jsonObject,
  type Deal,
  type DealHistory,
  type DealStage,
  type VerticalConfig,
} from "@/lib/deals";

export type AttentionItem = {
  id: string;
  kind: "key_date" | "stage_change" | "new";
  label: string;
  detail: string;
};

export type WeeklyRow = {
  id: string;
  vertical: string;
  market: string;
  address: string;
  location: string;
  stage: DealStage;
  stageRaw: string | null;
  listPrice: number | null;
  buildingSf: number | null;
  pricePerSf: number | null;
  lotSf: number | null;
  notes: string | null;
  fieldProvenance: Record<string, Json | undefined>;
  showInWeekly: boolean;
  needsReview: boolean;
  updatedAt: string;
};

export type WeeklySection = {
  vertical: string;
  rows: WeeklyRow[];
  counts: Partial<Record<DealStage, number>>;
};

export type WeeklyModel = {
  weekStart: string;
  sections: WeeklySection[];
  attention: AttentionItem[];
  allRows: WeeklyRow[];
};

export function buildWeeklyRow(deal: Deal): WeeklyRow {
  return {
    id: deal.id,
    vertical: deal.vertical ?? "Unassigned",
    market: deal.market ?? "",
    address: deal.address ?? "",
    location: [deal.city, deal.state].filter(Boolean).join(", "),
    stage: deal.stage,
    stageRaw: deal.stage_raw,
    listPrice: deal.list_price,
    buildingSf: deal.bldg_sf,
    pricePerSf: deal.price_per_sf,
    lotSf: deal.lot_sf,
    notes: deal.weekly_note || deal.notes,
    fieldProvenance: jsonObject(deal.field_provenance),
    showInWeekly: deal.show_in_weekly,
    needsReview: deal.needs_review,
    updatedAt: deal.updated_at,
  };
}

function stageRank(stage: DealStage) {
  if (stage === "Needs review") return dealStages.length;
  if (stage === "On Hold") return dealStages.length - 1;
  return Math.max(0, 7 - dealStages.indexOf(stage));
}

function keyDates(deal: Deal) {
  const notes = jsonObject(deal.notes_extracted);
  return Array.isArray(notes.key_dates) ? notes.key_dates : [];
}

function attentionFor(
  deals: Deal[],
  history: DealHistory[],
  now: Date,
): AttentionItem[] {
  const result: AttentionItem[] = [];
  const inSevenDays = subDays(now, 7);
  const inFourteenDays = new Date(now);
  inFourteenDays.setDate(inFourteenDays.getDate() + 14);

  for (const deal of deals) {
    const title = deal.address || deal.market || deal.vertical || deal.id;
    for (const rawDate of keyDates(deal)) {
      let date: Date | null = null;
      let label = "Key date";
      if (typeof rawDate === "string") {
        const parsed = parseISO(rawDate);
        if (!Number.isNaN(parsed.getTime())) date = parsed;
      } else if (rawDate && typeof rawDate === "object" && !Array.isArray(rawDate)) {
        const value = rawDate as Record<string, unknown>;
        const parsed = typeof value.date === "string" ? parseISO(value.date) : null;
        if (parsed && !Number.isNaN(parsed.getTime())) date = parsed;
        if (typeof value.label === "string") label = value.label;
      }
      if (date && isAfter(date, now) && isBefore(date, inFourteenDays)) {
        result.push({
          id: `date:${deal.id}:${date.toISOString()}`,
          kind: "key_date",
          label: `${label}: ${date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}`,
          detail: title,
        });
      }
    }

    const recentStage = history.find(
      (entry) =>
        entry.deal_id === deal.id &&
        entry.field === "stage" &&
        parseISO(entry.changed_at) >= inSevenDays,
    );
    if (recentStage) {
      result.push({
        id: `stage:${deal.id}:${recentStage.id}`,
        kind: "stage_change",
        label: `Moved to ${String(recentStage.new_value ?? deal.stage)}`,
        detail: title,
      });
    }

    const createdAt = parseISO(deal.updated_at);
    if (deal.version === 1 && createdAt >= inSevenDays) {
      result.push({
        id: `new:${deal.id}`,
        kind: "new",
        label: "New to pipeline",
        detail: title,
      });
    }
  }

  return result.slice(0, 12);
}

export function buildWeeklyModel(
  deals: Deal[],
  configs: VerticalConfig[],
  history: DealHistory[],
  showAll: boolean,
  now = new Date(),
): WeeklyModel {
  const selected = deals.filter((deal) => showAll || deal.show_in_weekly);
  const configOrder = new Map(
    configs.map((config) => [config.vertical, config.sort_order]),
  );
  const verticals = [...new Set(selected.map((deal) => deal.vertical ?? "Unassigned"))].sort(
    (a, b) =>
      (configOrder.get(a) ?? Number.MAX_SAFE_INTEGER) -
      (configOrder.get(b) ?? Number.MAX_SAFE_INTEGER),
  );
  const sections = verticals.map((vertical) => {
    const rows = selected
      .filter((deal) => (deal.vertical ?? "Unassigned") === vertical)
      .sort(
        (a, b) =>
          stageRank(a.stage) - stageRank(b.stage) ||
          (a.market ?? "").localeCompare(b.market ?? ""),
      )
      .map(buildWeeklyRow);
    const counts: Partial<Record<DealStage, number>> = {};
    for (const row of rows) counts[row.stage] = (counts[row.stage] ?? 0) + 1;
    return { vertical, rows, counts };
  });

  return {
    weekStart: startOfWeek(now, { weekStartsOn: 1 }).toISOString().slice(0, 10),
    sections,
    attention: attentionFor(selected, history, now),
    allRows: deals.map(buildWeeklyRow),
  };
}

export function latestWeekDate(value?: string) {
  const date = value ? parseISO(value) : new Date();
  return endOfWeek(date, { weekStartsOn: 1 });
}

export function weeklySnapshotPayload(model: WeeklyModel): Json {
  return {
    weekStart: model.weekStart,
    sections: model.sections.map((section) => ({
      vertical: section.vertical,
      counts: section.counts,
      rows: section.rows.map((row) => ({
        id: row.id,
        stage: row.stage,
        market: row.market,
        address: row.address,
      })),
    })),
    rows: model.allRows.map((row) => ({
      id: row.id,
      stage: row.stage,
      market: row.market,
      address: row.address,
    })),
  } as Json;
}

export function compareSnapshots(
  current: WeeklyModel,
  previous: unknown,
): Record<string, "new" | "moved" | "removed"> {
  if (!previous || typeof previous !== "object" || Array.isArray(previous)) return {};
  const payload = previous as Record<string, unknown>;
  const rawRows = Array.isArray(payload.rows) ? payload.rows : [];
  const previousRows = new Map(
    rawRows
      .filter(
        (row): row is Record<string, unknown> =>
          Boolean(row) && typeof row === "object" && !Array.isArray(row),
      )
      .map((row) => [String(row.id), row]),
  );
  const result: Record<string, "new" | "moved" | "removed"> = {};
  for (const row of current.allRows) {
    const old = previousRows.get(row.id);
    if (!old) result[row.id] = "new";
    else if (old.stage !== row.stage) result[row.id] = "moved";
    previousRows.delete(row.id);
  }
  for (const id of previousRows.keys()) result[id] = "removed";
  return result;
}
