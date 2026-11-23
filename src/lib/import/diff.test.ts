import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Deal, DealHistory } from "@/lib/deals";
import { DEFAULT_VERTICAL_CONFIG } from "./columns";
import { computeImportDiff } from "./diff";
import { normalizeWorkbook, type NormalizedDeal } from "./normalize";

const WORKBOOK_PATH = path.join(process.cwd(), "data", "src.xlsx");
const workbookBytes = readFileSync(WORKBOOK_PATH);

function normalizedToExistingDeal(deal: NormalizedDeal): Deal {
  const provenance: Record<string, string> = {};
  for (const field of deal.assumed_fields) {
    provenance[field] = "assumed";
  }
  return {
    id: deal.id,
    source_tab: deal.source_tab,
    source_row: deal.source_row,
    vertical: deal.vertical,
    client: deal.client,
    market: deal.market,
    city: deal.city,
    state: deal.state,
    state_inferred: deal.state_inferred,
    address: deal.address,
    stage: deal.stage,
    stage_raw: deal.stage_raw,
    stage_entered_at: "2026-11-19T12:00:00.000Z",
    bldg_sf: deal.bldg_sf,
    list_price: deal.list_price,
    lot_sf: deal.lot_sf,
    price_per_sf: deal.price_per_sf,
    price_per_lot_sf: deal.price_per_lot_sf,
    broker: deal.broker,
    broker_phone: deal.broker_phone,
    notes: deal.notes,
    weekly_note: null,
    show_in_weekly: false,
    attributes: deal.attributes,
    attributes_raw: deal.attributes_raw,
    field_provenance: provenance,
    notes_extracted: null,
    needs_review: deal.needs_review,
    review_reasons: deal.review_reasons,
    version: 1,
    created_at: "2026-11-19T12:00:00.000Z",
    updated_at: "2026-11-19T12:00:00.000Z",
    updated_by: null,
  };
}

describe("computeImportDiff", () => {
  it("reports 18 rows, 18 deals, 4 flagged, 1 assumed, and 18 Unchanged on identical workbook", async () => {
    const sourceTabs = {
      av_clientC_atl: "av",
      food_clientA_nyc: "food",
      catering_clientB_jfk: "catering",
    };
    const parsed = await normalizeWorkbook(workbookBytes, {
      sourceName: "src.xlsx",
      verticalMapping: DEFAULT_VERTICAL_CONFIG,
      sourceTabs,
      strictTabRegistry: true,
    });
    const existingDeals = parsed.deals.map(normalizedToExistingDeal);

    const { summary } = computeImportDiff({
      normalizedDeals: parsed.deals,
      normalizedContacts: parsed.contacts,
      report: parsed.report,
      existingDeals,
      dealHistory: [],
      sourceTabs,
      fileSha256: "same-sha",
      lastAppliedRun: {
        id: 1,
        created_at: "2026-11-19T12:00:00.000Z",
        file_sha256: "same-sha",
      },
    });

    expect(summary.rows_in).toBe(18);
    expect(summary.deals_out).toBe(18);
    expect(summary.flagged).toBe(4);
    expect(summary.assumed_cells).toBe(1);
    expect(summary.counts).toEqual({
      new: 0,
      changed: 0,
      unchanged: 18,
      missing: 0,
      conflicts: 0,
      conflict_deals: 0,
    });
    expect(summary.has_changes).toBe(false);
    expect(summary.identical_to_last_applied).toBe(true);
    expect(summary.unknown_statuses).toEqual(["Listed"]);
    expect(summary.unconfigured_tabs).toEqual([]);
  });

  it("detects conflicts for app-edited notes, app-edited attributes, and confirmed provenance", async () => {
    const sourceTabs = {
      av_clientC_atl: "av",
      food_clientA_nyc: "food",
      catering_clientB_jfk: "catering",
    };
    const parsed = await normalizeWorkbook(workbookBytes, {
      sourceName: "src.xlsx",
      verticalMapping: DEFAULT_VERTICAL_CONFIG,
      sourceTabs,
      strictTabRegistry: true,
    });
    const existingDeals = parsed.deals.map(normalizedToExistingDeal);

    // Simulate in-app edits:
    // 1. Notes edited in app on av_clientC_atl:2
    // 2. Attribute power_amps confirmed in app and changed to 600 on av_clientC_atl:2
    // 3. Seeded history (phase-03) and prior import history should NOT trigger conflicts
    const target = existingDeals.find((d) => d.id === "av_clientC_atl:2")!;
    target.notes = "Updated notes in the web app";
    target.attributes = { ...(target.attributes as Record<string, unknown>), power_amps: 600 };
    target.field_provenance = { power_amps: "confirmed" };

    // Also simulate a non-conflicting change on av_clientC_atl:3 (broker updated in sheet)
    const other = existingDeals.find((d) => d.id === "av_clientC_atl:3")!;
    other.broker = "Old Broker";

    const history: DealHistory[] = [
      {
        id: 1,
        deal_id: "av_clientC_atl:2",
        changed_by: "user-1",
        changed_at: "2026-11-20T15:00:00.000Z",
        field: "notes",
        old_value: "DD date 9/18, kicked off environmental review",
        new_value: "Updated notes in the web app",
        seed_source: null,
        detail: null,
      },
      // Seeded history should be ignored
      {
        id: 2,
        deal_id: "av_clientC_atl:3",
        changed_by: "user-1",
        changed_at: "2026-11-20T15:00:00.000Z",
        field: "broker",
        old_value: "Earlier",
        new_value: "Old Broker",
        seed_source: "phase-03",
        detail: null,
      },
      // Prior import history should be ignored
      {
        id: 3,
        deal_id: "av_clientC_atl:3",
        changed_by: "admin-1",
        changed_at: "2026-11-20T16:00:00.000Z",
        field: "broker",
        old_value: "Earlier",
        new_value: "Old Broker",
        seed_source: null,
        detail: { source: "import", run_id: 1 },
      },
    ];

    const { summary, diff } = computeImportDiff({
      normalizedDeals: parsed.deals,
      normalizedContacts: parsed.contacts,
      report: parsed.report,
      existingDeals,
      dealHistory: history,
      sourceTabs,
      fileSha256: "same-sha",
      lastAppliedRun: {
        id: 1,
        created_at: "2026-11-19T12:00:00.000Z",
        file_sha256: "same-sha",
      },
    });

    expect(summary.counts.changed).toBe(2);
    expect(summary.counts.conflicts).toBe(2);
    expect(summary.counts.conflict_deals).toBe(1);
    expect(summary.has_changes).toBe(true);
    expect(summary.identical_to_last_applied).toBe(false);

    const deal2 = diff.deals.find((d) => d.id === "av_clientC_atl:2")!;
    expect(deal2.kind).toBe("changed");
    const notesChange = deal2.changes.find((c) => c.field === "notes")!;
    expect(notesChange.conflict).toBe(true);
    expect(notesChange.conflict_reason).toBe("edited_in_app");
    expect(notesChange.default_choice).toBe("keep_app");

    const powerChange = deal2.changes.find((c) => c.field === "attributes.power_amps")!;
    expect(powerChange.conflict).toBe(true);
    expect(powerChange.conflict_reason).toBe("confirmed_in_app");
    expect(powerChange.default_choice).toBe("keep_app");

    const deal3 = diff.deals.find((d) => d.id === "av_clientC_atl:3")!;
    expect(deal3.changes).toHaveLength(1);
    expect(deal3.changes[0].field).toBe("broker");
    expect(deal3.changes[0].conflict).toBe(false);
    expect(deal3.changes[0].default_choice).toBe("use_import");
  });

  it("classifies new and missing deals without deleting missing ones", async () => {
    const sourceTabs = {
      av_clientC_atl: "av",
      food_clientA_nyc: "food",
      catering_clientB_jfk: "catering",
    };
    const parsed = await normalizeWorkbook(workbookBytes, {
      sourceName: "src.xlsx",
      verticalMapping: DEFAULT_VERTICAL_CONFIG,
      sourceTabs,
      strictTabRegistry: true,
    });
    const existingDeals = parsed.deals.slice(1).map(normalizedToExistingDeal);
    existingDeals.push({
      ...normalizedToExistingDeal(parsed.deals[0]),
      id: "legacy_tab:99",
      source_tab: "legacy_tab",
      address: "999 Legacy Ln",
    });

    const { summary, diff } = computeImportDiff({
      normalizedDeals: parsed.deals,
      normalizedContacts: parsed.contacts,
      report: parsed.report,
      existingDeals,
      dealHistory: [],
      sourceTabs,
      fileSha256: "new-sha",
      lastAppliedRun: null,
    });

    expect(summary.counts.new).toBe(1);
    expect(summary.counts.missing).toBe(1);
    expect(summary.counts.unchanged).toBe(17);
    expect(diff.deals.find((d) => d.id === parsed.deals[0].id)?.kind).toBe("new");
    expect(diff.deals.find((d) => d.id === "legacy_tab:99")?.kind).toBe("missing");
  });
});
