import { readFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { DEFAULT_VERTICAL_CONFIG } from "./columns";
import { ImportWorkbookError, normalizeWorkbook } from "./normalize";
import { STAGES } from "./status-map";

const WORKBOOK_PATH = path.join(process.cwd(), "data", "src.xlsx");
const workbookBytes = readFileSync(WORKBOOK_PATH);

describe("TypeScript workbook normalizer checks", () => {
  it("1. preserves row counts per deal tab (18 rows -> 18 deals)", async () => {
    const { deals, report } = await normalizeWorkbook(workbookBytes, {
      sourceName: "src.xlsx",
    });

    expect(report.totals.source_rows).toBe(18);
    expect(report.totals.deals).toBe(18);
    expect(deals).toHaveLength(18);
    expect(report.totals.needs_review).toBe(4);
    expect(report.tabs.map((t) => [t.tab, t.source_rows, t.deals])).toEqual([
      ["av_clientC_atl", 6, 6],
      ["food_clientA_nyc", 8, 8],
      ["catering_clientB_jfk", 4, 4],
    ]);
  });

  it("2. maps status variants accurately and routes Listed to Needs review", async () => {
    const { deals } = await normalizeWorkbook(workbookBytes);

    for (const deal of deals) {
      const valid =
        (STAGES as readonly string[]).includes(deal.stage) ||
        (deal.stage === "Needs review" && deal.needs_review);
      expect(valid).toBe(true);
    }

    const expectedVariants: [string, string][] = [
      ["sourcing", "Sourcing"],
      ["SOURCING", "Sourcing"],
      ["Sourcing", "Sourcing"],
      ["nego PSA", "Negotiating PSA"],
      ["Negotiating PSA", "Negotiating PSA"],
      ["in pipeline", "In Pipeline"],
      ["pre loi", "Pre LOI"],
      ["Under Contract", "In Contract"],
      ["On Hold", "On Hold"],
    ];
    for (const [raw, expected] of expectedVariants) {
      const hits = deals.filter((d) => d.stage_raw === raw);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.every((d) => d.stage === expected)).toBe(true);
    }

    const listed = deals.filter((d) => d.stage_raw === "Listed");
    expect(listed.length).toBe(1);
    expect(listed[0].stage).toBe("Needs review");
    expect(listed[0].needs_review).toBe(true);
  });

  it("3. preserves raw status verbatim", async () => {
    const { deals } = await normalizeWorkbook(workbookBytes);
    const negoPsa = deals.find((d) => d.address === "3330 NW 60th St");
    const underContract = deals.find((d) => d.address === "37 S Hudson St");
    expect(negoPsa?.stage_raw).toBe("nego PSA");
    expect(negoPsa?.stage).toBe("Negotiating PSA");
    expect(underContract?.stage_raw).toBe("Under Contract");
    expect(underContract?.stage).toBe("In Contract");
  });

  it("4. distinguishes blank from zero", async () => {
    const { deals } = await normalizeWorkbook(workbookBytes);
    const culver = deals.find((d) => d.address === "5861 Washington Blvd");
    const torrance = deals.find((d) => d.address === "2426 Amsler St");

    expect(culver?.attributes.dock_high_doors).toBe(0);
    expect(torrance?.attributes).not.toHaveProperty("dock_high_doors");
    expect(torrance?.bldg_sf).toBeNull();
    expect(torrance?.price_per_sf).toBeNull();
  });

  it("5. recomputes $/SF and flags sheet mismatches without hiding them", async () => {
    const { deals } = await normalizeWorkbook(workbookBytes);
    const seattle = deals.find((d) => d.address === "37 S Hudson St");
    expect(seattle?.price_per_sf).toBe(217.77);
    expect(seattle?.needs_review).toBe(true);
    expect(
      seattle?.review_reasons.some((r) => r.includes("price_per_sf")),
    ).toBe(true);
  });

  it("6. tracks colored-text assumptions one-for-one", async () => {
    const { deals, report } = await normalizeWorkbook(workbookBytes);
    expect(report.totals.assumed_cells).toBe(1);
    const atl = deals.find((d) => d.address === "635 Angier Ave");
    expect(atl?.assumed_fields).toEqual(["power_amps"]);
  });

  it("7. is idempotent with unique deal IDs", async () => {
    const first = await normalizeWorkbook(workbookBytes);
    const second = await normalizeWorkbook(workbookBytes);
    expect(first.deals).toEqual(second.deals);
    expect(first.contacts).toEqual(second.contacts);
    expect(new Set(first.deals.map((d) => d.id)).size).toBe(first.deals.length);
  });

  it("8. handles unconfigured tabs, unknown columns, formulas, and malformed workbooks", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("food_clientD_mia");
    ws.addRow([
      "Client",
      "Metro",
      "City",
      "State",
      "Address",
      "Status",
      "Bldg SF",
      "List Price",
      "Sprinkler Type",
    ]);
    const row = ws.addRow([
      "Client D",
      "Miami",
      "Miami",
      "FL",
      "100 Biscayne Blvd",
      "nego psa",
      { formula: "10000+5000", result: 15000 },
      { formula: "B2*100" }, // no cached result -> must be flagged
      "ESFR",
    ]);
    row.getCell(9).font = { color: { argb: "FF0000FF" } };

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    // Strict tab registry mode (in-app import) flags unregistered tab even if prefix matches
    const strictResult = await normalizeWorkbook(buffer, {
      verticalMapping: DEFAULT_VERTICAL_CONFIG,
      sourceTabs: { food_clientA_nyc: "food" },
      strictTabRegistry: true,
    });
    expect(strictResult.report.unconfigured_tabs).toEqual(["food_clientD_mia"]);
    expect(strictResult.deals).toHaveLength(1);
    expect(strictResult.deals[0].vertical).toBeNull();
    expect(strictResult.deals[0].unconfigured_tab).toBe(true);
    expect(strictResult.deals[0].stage).toBe("Negotiating PSA");
    expect(strictResult.deals[0].bldg_sf).toBe(15000);
    expect(strictResult.deals[0].list_price).toBeNull();
    expect(strictResult.deals[0].attributes.sprinkler_type).toBe("ESFR");
    expect(strictResult.deals[0].assumed_fields).toEqual(["sprinkler_type"]);
    expect(strictResult.report.tabs[0].unknown_columns).toEqual([
      "sprinkler type",
    ]);
    expect(
      strictResult.deals[0].review_reasons.some((r) =>
        r.includes("formula cell has no cached value: list_price"),
      ),
    ).toBe(true);

    // Malformed non-xlsx bytes fail cleanly
    await expect(
      normalizeWorkbook(Buffer.from("not an xlsx file", "utf-8")),
    ).rejects.toThrow(ImportWorkbookError);
  });
});
