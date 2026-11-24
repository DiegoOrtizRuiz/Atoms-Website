import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { expect, test } from "./helpers/auth";

type ParsedCell = {
  text: string;
  italic: boolean;
};

type ParsedRow = ParsedCell[];

function decodeXmlEntities(text: string): string {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function parseSlideTableRows(xml: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  const trMatches = xml.matchAll(/<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g);
  for (const trMatch of trMatches) {
    const trBody = trMatch[1];
    const cells: ParsedCell[] = [];
    const tcMatches = trBody.matchAll(/<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g);
    for (const tcMatch of tcMatches) {
      const tcBody = tcMatch[1];
      const paragraphs: string[] = [];
      let hasItalicRun = false;

      const pMatches = tcBody.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g);
      for (const pMatch of pMatches) {
        const pBody = pMatch[1];
        const parts: string[] = [];
        const rMatches = pBody.matchAll(/<a:r\b[^>]*>([\s\S]*?)<\/a:r>/g);
        for (const rMatch of rMatches) {
          const rBody = rMatch[1];
          const tMatch = /<a:t>([\s\S]*?)<\/a:t>/.exec(rBody);
          const runText = tMatch ? decodeXmlEntities(tMatch[1]) : "";
          parts.push(runText);
          if (/<a:rPr\b[^>]*\bi="1"/.test(rBody) && runText.trim().length > 0) {
            hasItalicRun = true;
          }
        }
        paragraphs.push(parts.join(""));
      }
      cells.push({
        text: paragraphs.join("\n").trim(),
        italic: hasItalicRun,
      });
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

test.describe("Weekly PPTX export parity", () => {
  test("exported PPTX data rows, Market/Address/Status, and italic flags match on-screen weekly tables", async ({
    loginAs,
  }) => {
    const page = await loginAs("leadership");
    await page.goto("/weekly", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Pipeline Review" }),
    ).toBeVisible();

    // Scrape on-screen table rows (Market, Address, Status, and per-cell italic flag)
    const screenRows = await page.evaluate(() => {
      const rows: Array<{
        market: string;
        address: string;
        status: string;
        italics: boolean[];
      }> = [];
      for (const tr of document.querySelectorAll("main table tbody tr")) {
        const tds = Array.from(tr.querySelectorAll("td"));
        if (tds.length !== 8) continue;
        const market = (tds[0].textContent ?? "").trim();
        // Address cell contains a primary <span> with address and a <p> with location
        const addressPrimary = (
          tds[1].querySelector("span.font-semibold")?.textContent ??
          tds[1].textContent ??
          ""
        ).trim();
        // Status badge text (excluding optional "Source: ..." line)
        const status = (
          tds[2].querySelector("[data-slot='badge'], span.inline-flex, span")?.textContent ??
          tds[2].textContent ??
          ""
        ).trim();
        const italics = tds.map((td) =>
          Boolean(td.querySelector(".italic")),
        );
        rows.push({ market, address: addressPrimary, status, italics });
      }
      return rows;
    });

    expect(screenRows.length).toBeGreaterThan(0);

    // Download the PPTX
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 25_000 }),
      page.getByRole("button", { name: "Export PPTX" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^pipeline-review-.*\.pptx$/);
    const filePath = await download.path();
    expect(filePath).toBeTruthy();

    const zip = await JSZip.loadAsync(readFileSync(filePath!));
    const slideFiles = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => {
        const na = Number(/slide(\d+)\.xml/.exec(a)?.[1] ?? 0);
        const nb = Number(/slide(\d+)\.xml/.exec(b)?.[1] ?? 0);
        return na - nb;
      });

    expect(slideFiles.length).toBeGreaterThanOrEqual(3);

    const pptxDataRows: ParsedRow[] = [];
    for (const slideName of slideFiles) {
      const xml = await zip.files[slideName].async("string");
      const tableRows = parseSlideTableRows(xml);
      if (tableRows.length > 1) {
        // Skip header row ("Market", "Address", "Status", ...)
        expect(tableRows[0].map((c) => c.text)).toEqual([
          "Market",
          "Address",
          "Status",
          "$",
          "SF",
          "$/SF",
          "Lot size",
          "Notes",
        ]);
        pptxDataRows.push(...tableRows.slice(1));
      }
    }

    expect(pptxDataRows.length).toBe(screenRows.length);

    const stripDot = (s: string) => s.replace(/^●\s*/, "").trim();

    for (let i = 0; i < screenRows.length; i++) {
      const ui = screenRows[i];
      const ppt = pptxDataRows[i];

      expect(stripDot(ppt[0].text)).toBe(ui.market);
      const pptAddressFirstLine = stripDot(ppt[1].text.split("\n")[0]);
      expect(pptAddressFirstLine).toBe(ui.address);
      expect(stripDot(ppt[2].text)).toBe(ui.status);

      // Exact per-cell italic parity across all 8 columns
      expect(ppt.map((cell) => cell.italic)).toEqual(ui.italics);
    }
  });
});
