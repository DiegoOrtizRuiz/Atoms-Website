import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_VERTICAL_CONFIG } from "./columns";
import { normalizeWorkbook } from "./normalize";

const ROOT = process.cwd();
const WORKBOOK_PATH = path.join(ROOT, "data", "src.xlsx");
const PYTHON_DEALS_PATH = path.join(ROOT, "out", "deals.json");
const PYTHON_CONTACTS_PATH = path.join(ROOT, "out", "contacts.json");

describe("TypeScript normalizer parity with Python reference", () => {
  it("produces deep-equal deals.json and contacts.json on data/src.xlsx", async () => {
    if (!existsSync(PYTHON_DEALS_PATH) || !existsSync(PYTHON_CONTACTS_PATH)) {
      throw new Error(
        "Python reference outputs not found in out/. Run `python scripts/normalize.py data/src.xlsx out` first.",
      );
    }

    const pythonDeals = JSON.parse(readFileSync(PYTHON_DEALS_PATH, "utf-8"));
    const pythonContacts = JSON.parse(readFileSync(PYTHON_CONTACTS_PATH, "utf-8"));
    const workbookBytes = readFileSync(WORKBOOK_PATH);

    const { deals, contacts } = await normalizeWorkbook(workbookBytes, {
      sourceName: "src.xlsx",
      verticalMapping: DEFAULT_VERTICAL_CONFIG,
      sourceTabs: {},
      mappingSource: "offline_fallback",
      strictTabRegistry: false,
    });

    expect(deals).toEqual(pythonDeals);
    expect(contacts).toEqual(pythonContacts);
  });
});
