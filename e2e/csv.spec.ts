import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import { expect, test } from "./helpers/auth";

test.describe("Activity CSV export", () => {
  test("downloads filtered activity CSV with BOM, valid headers, rows > 0, and no formula injection", async ({
    loginAs,
  }) => {
    const adminPage = await loginAs("admin");
    await adminPage.goto("/admin?tab=activity", { waitUntil: "domcontentloaded" });

    // Apply an event filter
    await adminPage.getByLabel("Filter by event").selectOption("login");
    await expect(adminPage.locator("table tbody")).toContainText("login");

    const exportLink = adminPage.getByRole("link", { name: "Export CSV" });
    await expect(exportLink).toHaveAttribute(
      "href",
      /\/api\/admin\/activity\.csv\?.*event=login/,
    );

    const [download] = await Promise.all([
      adminPage.waitForEvent("download", { timeout: 25_000 }),
      exportLink.click(),
    ]);
    expect(download.suggestedFilename()).toBe("activity-log.csv");
    const filePath = await download.path();
    expect(filePath).toBeTruthy();

    const rawBytes = readFileSync(filePath!);
    // UTF-8 BOM (0xEF 0xBB 0xBF) must be present for Excel compatibility
    expect(rawBytes[0]).toBe(0xef);
    expect(rawBytes[1]).toBe(0xbb);
    expect(rawBytes[2]).toBe(0xbf);

    const csvText = rawBytes.subarray(3).toString("utf8");
    const records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
    }) as Array<Record<string, string>>;

    expect(records.length).toBeGreaterThan(0);
    expect(Object.keys(records[0])).toEqual([
      "created_at",
      "user_id",
      "user_name",
      "event",
      "path",
      "detail",
    ]);

    for (const row of records) {
      expect(row.event).toBe("login");
      for (const value of Object.values(row)) {
        // Formula-injection guard: no unescaped leading =, +, -, or @
        expect(value).not.toMatch(/^[\t\r ]*[=+\-@]/);
      }
    }
  });
});
