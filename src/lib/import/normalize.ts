import ExcelJS from "exceljs";
import type { DealStage } from "@/lib/deals";
import {
  ATTRIBUTE_ALIASES,
  CITY_STATE,
  CORE_COLUMNS,
  DEFAULT_VERTICAL_CONFIG,
  NON_DEAL_TABS,
  NUMERIC_ATTRIBUTES,
  cleanStr,
  normHeader,
  parseAmps,
  pyFloatStr,
  pyRepr,
  roundHalfToEven,
  slugifyHeader,
  toNumber,
} from "./columns";
import { STAGES, normalizeStatus } from "./status-map";

export const MAX_WORKBOOK_SHEETS = 50;
export const MAX_SHEET_ROWS = 25_000;
export const MAX_SHEET_COLUMNS = 200;

export class ImportWorkbookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportWorkbookError";
  }
}

export type NormalizedDeal = {
  id: string;
  source_tab: string;
  source_row: number;
  vertical: string | null;
  unconfigured_tab: boolean;
  client: string | null;
  market: string | null;
  city: string | null;
  state: string | null;
  state_inferred: boolean;
  address: string | null;
  stage: DealStage;
  stage_raw: string | null;
  bldg_sf: number | null;
  list_price: number | null;
  lot_sf: number | null;
  price_per_sf: number | null;
  price_per_lot_sf: number | null;
  broker: string | null;
  broker_phone: string | null;
  notes: string | null;
  attributes: Record<string, string | number | boolean | null>;
  attributes_raw: Record<string, string | number | boolean | null>;
  assumed_fields: string[];
  needs_review: boolean;
  review_reasons: string[];
};

export type NormalizedContact = {
  id: string;
  linked_deals: string[];
  [key: string]: string | boolean | string[] | null;
};

export type TabImportReport = {
  tab: string;
  vertical: string | null;
  source_rows: number;
  deals: number;
  unknown_columns: string[];
  missing_core_columns: string[];
};

export type ImportReport = {
  source: string;
  mapping_source: "supabase" | "offline_fallback";
  tabs: TabImportReport[];
  unconfigured_tabs: string[];
  formula_warnings: { tab: string; row: number; field: string; message: string }[];
  totals: {
    source_rows: number;
    deals: number;
    needs_review: number;
    assumed_cells: number;
    by_stage: Record<string, number>;
    status_variants: string[];
  };
};

export type NormalizeOptions = {
  sourceName?: string;
  verticalMapping?: Readonly<Record<string, string>>;
  sourceTabs?: Readonly<Record<string, string | null>>;
  mappingSource?: "supabase" | "offline_fallback";
  /**
   * When false (default), matches Python's resolve_vertical fallback to tab prefix.
   * When true (in-app import with live source_tabs), tabs not registered in sourceTabs
   * are treated as unconfigured so admins explicitly assign them.
   */
  strictTabRegistry?: boolean;
};

export type NormalizeResult = {
  deals: NormalizedDeal[];
  contacts: NormalizedContact[];
  report: ImportReport;
};

type ExtractedCell = {
  value: string | number | boolean | null;
  uncachedFormula: boolean;
  formulaError?: string;
};

function unwrapRichText(richText: ExcelJS.RichText[]): string {
  return richText.map((part) => part.text ?? "").join("");
}

function unwrapPrimitive(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray((value as { richText: unknown }).richText)) {
      return unwrapRichText((value as { richText: ExcelJS.RichText[] }).richText);
    }
    if ("text" in value) {
      return unwrapPrimitive((value as { text: unknown }).text);
    }
  }
  return String(value);
}

function extractCellValue(cell: ExcelJS.Cell): ExtractedCell {
  const raw = cell.value;
  if (raw === null || raw === undefined) {
    return { value: null, uncachedFormula: false };
  }
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
    return { value: raw, uncachedFormula: false };
  }
  if (raw instanceof Date) {
    return { value: raw.toISOString(), uncachedFormula: false };
  }
  if (typeof raw === "object") {
    if ("formula" in raw || "sharedFormula" in raw) {
      const formulaValue = raw as { result?: unknown };
      if (formulaValue.result === undefined || formulaValue.result === null) {
        return { value: null, uncachedFormula: true };
      }
      if (
        typeof formulaValue.result === "object" &&
        "error" in (formulaValue.result as Record<string, unknown>)
      ) {
        return {
          value: null,
          uncachedFormula: true,
          formulaError: String((formulaValue.result as { error: unknown }).error),
        };
      }
      return { value: unwrapPrimitive(formulaValue.result), uncachedFormula: false };
    }
    if ("error" in raw) {
      return {
        value: null,
        uncachedFormula: true,
        formulaError: String((raw as { error: unknown }).error),
      };
    }
    if ("richText" in raw && Array.isArray((raw as { richText: unknown }).richText)) {
      return {
        value: unwrapRichText((raw as { richText: ExcelJS.RichText[] }).richText),
        uncachedFormula: false,
      };
    }
    if ("text" in raw) {
      return {
        value: unwrapPrimitive((raw as { text: unknown }).text),
        uncachedFormula: false,
      };
    }
  }
  return { value: String(raw), uncachedFormula: false };
}

function isDefaultFontColor(color: Partial<ExcelJS.Color> | undefined | null): boolean {
  if (!color) return true;
  if (typeof color.argb === "string") {
    return color.argb.toUpperCase() === "FF000000";
  }
  if (typeof color.theme === "number") {
    return color.theme === 1;
  }
  const indexed = (color as { indexed?: unknown }).indexed;
  if (indexed !== undefined && indexed !== null) {
    return false;
  }
  return true;
}

export function isAssumedCell(cell: ExcelJS.Cell): boolean {
  if (!isDefaultFontColor(cell.font?.color)) {
    return true;
  }
  const raw = cell.value;
  if (
    raw &&
    typeof raw === "object" &&
    "richText" in raw &&
    Array.isArray((raw as { richText: unknown }).richText)
  ) {
    return (raw as { richText: ExcelJS.RichText[] }).richText.some(
      (part) => Boolean(part.text) && !isDefaultFontColor(part.font?.color),
    );
  }
  return false;
}

export function resolveVertical(
  tab: string,
  verticalMapping: Readonly<Record<string, string>>,
  sourceTabs: Readonly<Record<string, string | null>>,
  strictTabRegistry = false,
): string | null {
  let prefix: string | null;
  if (Object.hasOwn(sourceTabs, tab)) {
    prefix = sourceTabs[tab] ?? null;
  } else if (strictTabRegistry) {
    prefix = null;
  } else {
    prefix = tab.split("_")[0]?.toLowerCase() ?? null;
  }
  return prefix ? (verticalMapping[prefix] ?? null) : null;
}

function parseDealTab(
  ws: ExcelJS.Worksheet,
  report: ImportReport,
  verticalMapping: Readonly<Record<string, string>>,
  sourceTabs: Readonly<Record<string, string | null>>,
  strictTabRegistry: boolean,
): NormalizedDeal[] {
  if (ws.rowCount > MAX_SHEET_ROWS) {
    throw new ImportWorkbookError(
      `Tab "${ws.name}" exceeds the maximum supported ${MAX_SHEET_ROWS.toLocaleString()} rows.`,
    );
  }
  const headerRow = ws.getRow(1);
  const colCount = Math.max(ws.columnCount, headerRow.cellCount);
  if (colCount > MAX_SHEET_COLUMNS) {
    throw new ImportWorkbookError(
      `Tab "${ws.name}" exceeds the maximum supported ${MAX_SHEET_COLUMNS} columns.`,
    );
  }

  const vertical = resolveVertical(ws.name, verticalMapping, sourceTabs, strictTabRegistry);
  const headers: (string | null)[] = [];
  for (let col = 1; col <= colCount; col++) {
    headers.push(normHeader(extractCellValue(headerRow.getCell(col)).value));
  }

  const lookup: Record<string, number> = {};
  for (const [canon, aliases] of Object.entries(CORE_COLUMNS)) {
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i];
      if (h !== null && aliases.includes(h)) {
        lookup[canon] = i;
      }
    }
  }

  const mappedCols = new Set(Object.values(lookup));
  const attrCols: Record<string, number> = {};
  const unknownCols: string[] = [];
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (h === null || mappedCols.has(i)) continue;
    if (Object.hasOwn(ATTRIBUTE_ALIASES, h)) {
      attrCols[ATTRIBUTE_ALIASES[h]] = i;
    } else {
      const key = slugifyHeader(h);
      if (key) {
        attrCols[key] = i;
      }
      unknownCols.push(h);
    }
  }

  const tabRep: TabImportReport = {
    tab: ws.name,
    vertical,
    source_rows: 0,
    deals: 0,
    unknown_columns: unknownCols,
    missing_core_columns: (["state", "broker", "lot_sf"] as const).filter(
      (k) => !Object.hasOwn(lookup, k),
    ),
  };

  const deals: NormalizedDeal[] = [];
  for (let rIdx = 2; rIdx <= ws.rowCount; rIdx++) {
    const row = ws.getRow(rIdx);
    const width = Math.max(colCount, row.cellCount);
    const cells: ExcelJS.Cell[] = [];
    const extracted: ExtractedCell[] = [];
    let hasContent = false;
    for (let col = 1; col <= width; col++) {
      const cell = row.getCell(col);
      const ex = extractCellValue(cell);
      cells.push(cell);
      extracted.push(ex);
      if (
        ex.uncachedFormula ||
        (ex.value !== null && String(ex.value).trim() !== "")
      ) {
        hasContent = true;
      }
    }
    if (!hasContent) continue;

    tabRep.source_rows += 1;
    const get = (k: string): string | number | boolean | null => {
      if (!Object.hasOwn(lookup, k)) return null;
      const idx = lookup[k];
      return idx < extracted.length ? extracted[idx].value : null;
    };

    const reasons: string[] = [];

    const stageRaw = cleanStr(get("stage_raw"));
    const stage = normalizeStatus(stageRaw);
    if (stage === null) {
      reasons.push(`unmapped status: ${pyRepr(stageRaw)}`);
    }
    if (vertical === null) {
      reasons.push(`unconfigured tab: ${ws.name}`);
    }

    const city = cleanStr(get("city"));
    let state = cleanStr(get("state"));
    let stateInferred = false;
    if (state === null && city && Object.hasOwn(CITY_STATE, city.toLowerCase())) {
      state = CITY_STATE[city.toLowerCase()];
      stateInferred = true;
    }

    const bldgSf = toNumber(get("bldg_sf"));
    const price = toNumber(get("list_price"));
    const lotSf = toNumber(get("lot_sf"));
    const psf = price && bldgSf ? roundHalfToEven(price / bldgSf, 2) : null;
    const plsf = price && lotSf ? roundHalfToEven(price / lotSf, 2) : null;

    const derivedChecks: [string, number | null, number | null][] = [
      ["price_per_sf", psf, toNumber(get("price_per_sf_sheet"))],
      ["price_per_lot_sf", plsf, toNumber(get("price_per_lot_sf_sheet"))],
    ];
    for (const [label, calc, sheet] of derivedChecks) {
      if (sheet !== null && calc !== null && Math.abs(calc - sheet) > 0.01) {
        reasons.push(
          `${label}: sheet says ${pyFloatStr(sheet)}, inputs give ${pyFloatStr(calc)}`,
        );
      }
    }

    const attributes: Record<string, string | number | boolean | null> = {};
    const attributesRaw: Record<string, string | number | boolean | null> = {};
    for (const [key, idx] of Object.entries(attrCols)) {
      const raw = idx < extracted.length ? extracted[idx].value : null;
      if (raw === null) continue;
      attributesRaw[key] = raw;
      let val: string | number | boolean | null;
      if (key === "power_amps") {
        val = parseAmps(raw);
      } else if (key === "clear_height_ft") {
        val = toNumber(raw);
        if (val === null) {
          reasons.push(`clear height not a number: ${pyRepr(raw)}`);
        }
      } else if (NUMERIC_ATTRIBUTES.has(key)) {
        val = toNumber(raw);
      } else {
        val = cleanStr(raw);
      }
      attributes[key] = val;
    }

    const assumed: string[] = [];
    const fieldIndexPairs: [string, number][] = [
      ...Object.entries(lookup),
      ...Object.entries(attrCols),
    ];
    for (const [canon, idx] of fieldIndexPairs) {
      if (idx < extracted.length) {
        if (extracted[idx].uncachedFormula) {
          const msg = extracted[idx].formulaError
            ? `formula error in ${canon}: ${extracted[idx].formulaError}`
            : `formula cell has no cached value: ${canon}`;
          reasons.push(msg);
          report.formula_warnings.push({
            tab: ws.name,
            row: rIdx,
            field: canon,
            message: msg,
          });
        }
        if (extracted[idx].value !== null && isAssumedCell(cells[idx])) {
          assumed.push(canon);
        }
      }
    }

    const address = cleanStr(get("address"));
    if (address === null && (bldgSf || price)) {
      reasons.push("property data present but address missing");
    }

    deals.push({
      id: `${ws.name}:${rIdx}`,
      source_tab: ws.name,
      source_row: rIdx,
      vertical,
      unconfigured_tab: vertical === null,
      client: cleanStr(get("client")),
      market: cleanStr(get("market")),
      city,
      state,
      state_inferred: stateInferred,
      address,
      stage: stage ?? "Needs review",
      stage_raw: stageRaw,
      bldg_sf: bldgSf,
      list_price: price,
      lot_sf: lotSf,
      price_per_sf: psf,
      price_per_lot_sf: plsf,
      broker: cleanStr(get("broker")),
      broker_phone: cleanStr(get("broker_phone")),
      notes: cleanStr(get("notes")),
      attributes,
      attributes_raw: attributesRaw,
      assumed_fields: assumed,
      needs_review: reasons.length > 0,
      review_reasons: reasons,
    });
    tabRep.deals += 1;
  }

  report.tabs.push(tabRep);
  return deals;
}

function parseContacts(ws: ExcelJS.Worksheet): NormalizedContact[] {
  const headerRow = ws.getRow(1);
  const colCount = Math.max(ws.columnCount, headerRow.cellCount);
  const keys: (string | null)[] = [];
  for (let col = 1; col <= colCount; col++) {
    const h = normHeader(extractCellValue(headerRow.getCell(col)).value);
    keys.push(h ? slugifyHeader(h) : null);
  }

  const out: NormalizedContact[] = [];
  for (let rIdx = 2; rIdx <= ws.rowCount; rIdx++) {
    const row = ws.getRow(rIdx);
    const values: (string | number | boolean | null)[] = [];
    let anyNonNull = false;
    for (let col = 1; col <= colCount; col++) {
      const val = extractCellValue(row.getCell(col)).value;
      values.push(val);
      if (val !== null) anyNonNull = true;
    }
    if (!anyNonNull) continue;

    const rec: NormalizedContact = { id: `contact:${rIdx}`, linked_deals: [] };
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (!key) continue;
      const val = values[i];
      rec[key] = typeof val === "boolean" ? val : cleanStr(val);
    }
    out.push(rec);
  }
  return out;
}

function linkContacts(deals: NormalizedDeal[], contacts: NormalizedContact[]): void {
  const byPhone = new Map<string, string[]>();
  for (const d of deals) {
    if (d.broker_phone) {
      const list = byPhone.get(d.broker_phone) ?? [];
      list.push(d.id);
      byPhone.set(d.broker_phone, list);
    }
  }
  for (const contact of contacts) {
    const linked = new Set<string>();
    for (const phone of [contact.office, contact.mobile]) {
      if (typeof phone === "string" && phone) {
        for (const dealId of byPhone.get(phone) ?? []) {
          linked.add(dealId);
        }
      }
    }
    contact.linked_deals = [...linked].sort();
  }
}

function hasZipSignature(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) &&
    (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08)
  );
}

async function loadWorkbook(
  input: Buffer | Uint8Array | ArrayBuffer | ExcelJS.Workbook,
): Promise<ExcelJS.Workbook> {
  if (input instanceof ExcelJS.Workbook) {
    return input;
  }
  const bytes =
    input instanceof Uint8Array
      ? input
      : new Uint8Array(input);
  if (bytes.length === 0) {
    throw new ImportWorkbookError("The uploaded file is empty.");
  }
  if (!hasZipSignature(bytes)) {
    throw new ImportWorkbookError(
      "The file is not a valid .xlsx workbook (missing Office Open XML archive header).",
    );
  }
  const wb = new ExcelJS.Workbook();
  try {
    // Copy into an isolated ArrayBuffer so ExcelJS handles Uint8Array slices cleanly.
    const arrayBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    await wb.xlsx.load(arrayBuffer);
  } catch (error) {
    throw new ImportWorkbookError(
      `Unable to parse .xlsx workbook: ${
        error instanceof Error ? error.message : "malformed archive"
      }`,
    );
  }
  return wb;
}

export async function normalizeWorkbook(
  input: Buffer | Uint8Array | ArrayBuffer | ExcelJS.Workbook,
  options: NormalizeOptions = {},
): Promise<NormalizeResult> {
  const wb = await loadWorkbook(input);
  if (wb.worksheets.length === 0) {
    throw new ImportWorkbookError("The workbook contains no worksheets.");
  }
  if (wb.worksheets.length > MAX_WORKBOOK_SHEETS) {
    throw new ImportWorkbookError(
      `The workbook contains ${wb.worksheets.length} worksheets (maximum supported is ${MAX_WORKBOOK_SHEETS}).`,
    );
  }

  const verticalMapping = options.verticalMapping ?? DEFAULT_VERTICAL_CONFIG;
  const sourceTabs = options.sourceTabs ?? {};
  const strictTabRegistry = options.strictTabRegistry ?? false;

  const report: ImportReport = {
    source: options.sourceName ?? "workbook.xlsx",
    mapping_source: options.mappingSource ?? "offline_fallback",
    tabs: [],
    unconfigured_tabs: [],
    formula_warnings: [],
    totals: {
      source_rows: 0,
      deals: 0,
      needs_review: 0,
      assumed_cells: 0,
      by_stage: {},
      status_variants: [],
    },
  };

  let deals: NormalizedDeal[] = [];
  let contacts: NormalizedContact[] = [];

  for (const ws of wb.worksheets) {
    if (ws.name === "contact_tracker") {
      contacts = parseContacts(ws);
    } else if (NON_DEAL_TABS.has(ws.name)) {
      continue;
    } else {
      if (resolveVertical(ws.name, verticalMapping, sourceTabs, strictTabRegistry) === null) {
        report.unconfigured_tabs.push(ws.name);
      }
      deals = deals.concat(
        parseDealTab(ws, report, verticalMapping, sourceTabs, strictTabRegistry),
      );
    }
  }

  linkContacts(deals, contacts);

  const byStage: Record<string, number> = {};
  for (const stage of [...STAGES, "Needs review"]) {
    byStage[stage] = deals.filter((d) => d.stage === stage).length;
  }

  report.totals = {
    source_rows: report.tabs.reduce((sum, tab) => sum + tab.source_rows, 0),
    deals: deals.length,
    needs_review: deals.filter((d) => d.needs_review).length,
    assumed_cells: deals.reduce((sum, d) => sum + d.assumed_fields.length, 0),
    by_stage: byStage,
    status_variants: [
      ...new Set(deals.map((d) => d.stage_raw).filter((s): s is string => s !== null)),
    ].sort(),
  };

  return { deals, contacts, report };
}
