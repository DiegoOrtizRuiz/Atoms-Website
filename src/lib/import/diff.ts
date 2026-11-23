import type { Json } from "@/lib/database.types";
import { jsonObject, type Deal, type DealHistory, type DealStage } from "@/lib/deals";
import { expandHistoryEntry } from "@/lib/history";
import type {
  ImportReport,
  NormalizedContact,
  NormalizedDeal,
} from "./normalize";

export type ConflictReason = "edited_in_app" | "confirmed_in_app";
export type ConflictChoice = "keep_app" | "use_import";
export type MissingChoice = "leave" | "mark_on_hold";

export type FieldChange = {
  field: string;
  old_value: Json;
  new_value: Json;
  conflict: boolean;
  conflict_reason?: ConflictReason;
  default_choice: ConflictChoice;
};

export type DealDiffKind = "new" | "changed" | "unchanged" | "missing";

export type DealDiffItem = {
  id: string;
  kind: DealDiffKind;
  source_tab: string | null;
  source_row: number | null;
  vertical: string | null;
  client: string | null;
  market: string | null;
  address: string | null;
  stage: DealStage;
  incoming?: NormalizedDeal;
  changes: FieldChange[];
  needs_review: boolean;
  review_reasons: string[];
  assumed_fields: string[];
};

export type PreparedContact = {
  id: string;
  contact_name: string | null;
  company: string | null;
  client: string | null;
  vertical: string | null;
  title: string | null;
  office: string | null;
  mobile: string | null;
  email: string | null;
  notes: string | null;
  attributes: Record<string, Json>;
  linked_deals: string[];
};

export type TabReconciliation = {
  tab_name: string;
  tab_prefix: string | null;
  vertical: string | null;
  client: string | null;
  market: string | null;
  source_rows: number;
  deals: number;
  unconfigured: boolean;
  unknown_columns: string[];
  missing_core_columns: string[];
};

export type ImportSummary = {
  source: string;
  tabs_found: number;
  rows_in: number;
  deals_out: number;
  flagged: number;
  assumed_cells: number;
  unknown_statuses: string[];
  unknown_columns: { tab: string; columns: string[] }[];
  unconfigured_tabs: string[];
  formula_warnings: { tab: string; row: number; field: string; message: string }[];
  counts: {
    new: number;
    changed: number;
    unchanged: number;
    missing: number;
    conflicts: number;
    conflict_deals: number;
  };
  identical_to_last_applied: boolean;
  last_applied_run_id: number | null;
  has_changes: boolean;
};

export type ImportDiffPayload = {
  deals: DealDiffItem[];
  contacts: PreparedContact[];
  tabs: TabReconciliation[];
};

export type ComputeDiffInput = {
  normalizedDeals: NormalizedDeal[];
  normalizedContacts: NormalizedContact[];
  report: ImportReport;
  existingDeals: Deal[];
  dealHistory: DealHistory[];
  sourceTabs: Readonly<Record<string, string | null>>;
  fileSha256: string;
  lastAppliedRun: { id: number; created_at: string; file_sha256: string } | null;
};

const CORE_DIFF_FIELDS = [
  "source_tab",
  "source_row",
  "vertical",
  "client",
  "market",
  "city",
  "state",
  "state_inferred",
  "address",
  "stage",
  "stage_raw",
  "bldg_sf",
  "list_price",
  "lot_sf",
  "broker",
  "broker_phone",
  "notes",
  "needs_review",
  "review_reasons",
] as const;

const NUMERIC_CORE_FIELDS = new Set<string>([
  "source_row",
  "bldg_sf",
  "list_price",
  "lot_sf",
]);

const CONTACT_CORE_COLUMNS = new Set([
  "id",
  "contact_name",
  "company",
  "client",
  "vertical",
  "title",
  "office",
  "mobile",
  "email",
  "notes",
  "linked_deals",
]);

function normalizeValueForCompare(field: string, value: unknown): Json {
  if (value === undefined || value === null) return null;
  if (NUMERIC_CORE_FIELDS.has(field)) {
    const num = typeof value === "number" ? value : Number(value);
    return Number.isFinite(num) ? num : null;
  }
  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : (item as Json)));
  }
  return value as Json;
}

function valuesEqual(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) < 1e-9;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, idx) => valuesEqual(item, b[idx]));
  }
  return false;
}

function normalizeAttrValue(value: unknown): Json {
  if (value === undefined || value === null) return null;
  return value as Json;
}

function buildAppEditedFieldsByDeal(
  dealHistory: DealHistory[],
  lastAppliedCreatedAt: string | null,
): Map<string, Set<string>> {
  const cutoffMs = lastAppliedCreatedAt ? new Date(lastAppliedCreatedAt).getTime() : null;
  const edited = new Map<string, Set<string>>();

  for (const row of dealHistory) {
    if (!row.changed_by) continue;
    if (row.seed_source !== null) continue;
    const detail = jsonObject(row.detail);
    if (detail.source === "import") continue;
    if (cutoffMs !== null && new Date(row.changed_at).getTime() <= cutoffMs) continue;

    for (const expanded of expandHistoryEntry(row)) {
      let set = edited.get(row.deal_id);
      if (!set) {
        set = new Set<string>();
        edited.set(row.deal_id, set);
      }
      set.add(expanded.field);
    }
  }

  return edited;
}

export function prepareContactsForDb(contacts: NormalizedContact[]): PreparedContact[] {
  const asStringOrNull = (val: unknown): string | null =>
    typeof val === "string" ? val : null;

  return contacts.map((source) => {
    const attributes: Record<string, Json> = {};
    for (const [key, value] of Object.entries(source)) {
      if (!CONTACT_CORE_COLUMNS.has(key)) {
        attributes[key] = value === undefined ? null : (value as Json);
      }
    }
    return {
      id: source.id,
      contact_name: asStringOrNull(source.contact_name),
      company: asStringOrNull(source.company),
      client: asStringOrNull(source.client),
      vertical: asStringOrNull(source.vertical),
      title: asStringOrNull(source.title),
      office: asStringOrNull(source.office),
      mobile: asStringOrNull(source.mobile),
      email: asStringOrNull(source.email),
      notes: asStringOrNull(source.notes),
      attributes,
      linked_deals: Array.isArray(source.linked_deals) ? source.linked_deals : [],
    };
  });
}

export function computeImportDiff(input: ComputeDiffInput): {
  summary: ImportSummary;
  diff: ImportDiffPayload;
} {
  const existingById = new Map(input.existingDeals.map((deal) => [deal.id, deal]));
  const incomingIds = new Set<string>();
  const editedByDeal = buildAppEditedFieldsByDeal(
    input.dealHistory,
    input.lastAppliedRun?.created_at ?? null,
  );

  const dealDiffs: DealDiffItem[] = [];
  let newCount = 0;
  let changedCount = 0;
  let unchangedCount = 0;
  let missingCount = 0;
  let conflictFieldCount = 0;
  let conflictDealCount = 0;

  for (const incoming of input.normalizedDeals) {
    incomingIds.add(incoming.id);
    const existing = existingById.get(incoming.id);

    if (!existing) {
      newCount += 1;
      dealDiffs.push({
        id: incoming.id,
        kind: "new",
        source_tab: incoming.source_tab,
        source_row: incoming.source_row,
        vertical: incoming.vertical,
        client: incoming.client,
        market: incoming.market,
        address: incoming.address,
        stage: incoming.stage,
        incoming,
        changes: [],
        needs_review: incoming.needs_review,
        review_reasons: incoming.review_reasons,
        assumed_fields: incoming.assumed_fields,
      });
      continue;
    }

    const editedFields = editedByDeal.get(existing.id) ?? new Set<string>();
    const provenance = jsonObject(existing.field_provenance);
    const changes: FieldChange[] = [];

    for (const field of CORE_DIFF_FIELDS) {
      const oldVal = normalizeValueForCompare(field, existing[field]);
      const newVal = normalizeValueForCompare(field, incoming[field]);
      if (valuesEqual(oldVal, newVal)) continue;

      const isEditedInApp =
        editedFields.has(field) ||
        (field === "stage_raw" && editedFields.has("stage"));
      const isConfirmed =
        provenance[field] === "confirmed" ||
        (field === "stage_raw" && provenance.stage === "confirmed");
      const conflict = isEditedInApp || isConfirmed;

      changes.push({
        field,
        old_value: oldVal,
        new_value: newVal,
        conflict,
        ...(conflict
          ? { conflict_reason: isEditedInApp ? "edited_in_app" : "confirmed_in_app" }
          : {}),
        default_choice: conflict ? "keep_app" : "use_import",
      });
    }

    const oldAttrs = jsonObject(existing.attributes);
    const newAttrs = incoming.attributes;
    const attrKeys = [...new Set([...Object.keys(oldAttrs), ...Object.keys(newAttrs)])].sort();

    for (const key of attrKeys) {
      const oldVal = normalizeAttrValue(oldAttrs[key]);
      const newVal = normalizeAttrValue(newAttrs[key]);
      if (valuesEqual(oldVal, newVal)) continue;

      const field = `attributes.${key}`;
      const isEditedInApp = editedFields.has(field);
      const isConfirmed = provenance[key] === "confirmed";
      const conflict = isEditedInApp || isConfirmed;

      changes.push({
        field,
        old_value: oldVal,
        new_value: newVal,
        conflict,
        ...(conflict
          ? { conflict_reason: isEditedInApp ? "edited_in_app" : "confirmed_in_app" }
          : {}),
        default_choice: conflict ? "keep_app" : "use_import",
      });
    }

    if (changes.length > 0) {
      changedCount += 1;
      const dealConflicts = changes.filter((c) => c.conflict).length;
      if (dealConflicts > 0) {
        conflictFieldCount += dealConflicts;
        conflictDealCount += 1;
      }
      dealDiffs.push({
        id: incoming.id,
        kind: "changed",
        source_tab: incoming.source_tab,
        source_row: incoming.source_row,
        vertical: incoming.vertical,
        client: incoming.client,
        market: incoming.market,
        address: incoming.address,
        stage: incoming.stage,
        incoming,
        changes,
        needs_review: incoming.needs_review,
        review_reasons: incoming.review_reasons,
        assumed_fields: incoming.assumed_fields,
      });
    } else {
      unchangedCount += 1;
      dealDiffs.push({
        id: incoming.id,
        kind: "unchanged",
        source_tab: incoming.source_tab,
        source_row: incoming.source_row,
        vertical: incoming.vertical,
        client: incoming.client,
        market: incoming.market,
        address: incoming.address,
        stage: incoming.stage,
        changes: [],
        needs_review: incoming.needs_review,
        review_reasons: incoming.review_reasons,
        assumed_fields: incoming.assumed_fields,
      });
    }
  }

  for (const existing of input.existingDeals) {
    if (incomingIds.has(existing.id)) continue;
    missingCount += 1;
    dealDiffs.push({
      id: existing.id,
      kind: "missing",
      source_tab: existing.source_tab,
      source_row: existing.source_row,
      vertical: existing.vertical,
      client: existing.client,
      market: existing.market,
      address: existing.address,
      stage: existing.stage,
      changes: [],
      needs_review: existing.needs_review,
      review_reasons: existing.review_reasons,
      assumed_fields: [],
    });
  }

  const unconfiguredSet = new Set(input.report.unconfigured_tabs);
  const tabs: TabReconciliation[] = input.report.tabs.map((tab) => {
    const tabDeals = input.normalizedDeals.filter((d) => d.source_tab === tab.tab);
    const client = tabDeals.find((d) => d.client)?.client ?? null;
    const market = tabDeals.find((d) => d.market)?.market ?? null;
    const tabPrefix = Object.hasOwn(input.sourceTabs, tab.tab)
      ? (input.sourceTabs[tab.tab] ?? null)
      : null;

    return {
      tab_name: tab.tab,
      tab_prefix: tabPrefix,
      vertical: tab.vertical,
      client,
      market,
      source_rows: tab.source_rows,
      deals: tab.deals,
      unconfigured: unconfiguredSet.has(tab.tab),
      unknown_columns: tab.unknown_columns,
      missing_core_columns: tab.missing_core_columns,
    };
  });

  const unknownStatuses = [
    ...new Set(
      input.normalizedDeals
        .filter(
          (d) =>
            d.stage === "Needs review" &&
            d.stage_raw !== null &&
            d.review_reasons.some((r) => r.startsWith("unmapped status:")),
        )
        .map((d) => d.stage_raw as string),
    ),
  ].sort();

  const unknownColumns = input.report.tabs
    .filter((t) => t.unknown_columns.length > 0)
    .map((t) => ({ tab: t.tab, columns: t.unknown_columns }));

  const hasChanges = newCount > 0 || changedCount > 0 || missingCount > 0;
  const identicalToLastApplied =
    Boolean(
      input.lastAppliedRun &&
        input.lastAppliedRun.file_sha256 === input.fileSha256,
    ) && !hasChanges;

  const summary: ImportSummary = {
    source: input.report.source,
    tabs_found: input.report.tabs.length,
    rows_in: input.report.totals.source_rows,
    deals_out: input.report.totals.deals,
    flagged: input.report.totals.needs_review,
    assumed_cells: input.report.totals.assumed_cells,
    unknown_statuses: unknownStatuses,
    unknown_columns: unknownColumns,
    unconfigured_tabs: [...input.report.unconfigured_tabs],
    formula_warnings: [...input.report.formula_warnings],
    counts: {
      new: newCount,
      changed: changedCount,
      unchanged: unchangedCount,
      missing: missingCount,
      conflicts: conflictFieldCount,
      conflict_deals: conflictDealCount,
    },
    identical_to_last_applied: identicalToLastApplied,
    last_applied_run_id: input.lastAppliedRun?.id ?? null,
    has_changes: hasChanges,
  };

  return {
    summary,
    diff: {
      deals: dealDiffs,
      contacts: prepareContactsForDb(input.normalizedContacts),
      tabs,
    },
  };
}
