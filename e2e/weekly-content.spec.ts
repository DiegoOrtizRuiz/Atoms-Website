import { expect, test } from "./helpers/auth";

test.describe("Weekly Review content & data integrity", () => {
  test("shows Seattle Nov 25 in Needs attention, Seattle $217.77/SF, Listed as Needs review, and no null/NaN/undefined/$0", async ({
    loginAs,
  }) => {
    const page = await loginAs("leadership");
    await page.goto("/weekly", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Pipeline Review" }),
    ).toBeVisible();

    // 1. Needs attention includes Seattle (37 S Hudson St) closing Nov 25
    const attentionSection = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", { name: "Needs attention this week" }),
      });
    await expect(attentionSection).toBeVisible();
    await expect(attentionSection).toContainText(/Nov 25/i);
    await expect(attentionSection).toContainText(/37 S Hudson St|Seattle/i);

    // 2. Seattle row shows $217.77/SF
    const seattleRow = page
      .locator("main table tbody tr")
      .filter({ hasText: "37 S Hudson St" });
    await expect(seattleRow).toBeVisible();
    await expect(seattleRow).toContainText("Seattle");
    await expect(seattleRow).toContainText("$217.77/SF");

    // 3. Click "Show all deals" so Listed (201 N Miami Ave) is included and shows as Needs review
    await page.getByRole("button", { name: "Show all deals" }).click();
    const listedRow = page
      .locator("main table tbody tr")
      .filter({ hasText: "201 N Miami Ave" });
    await expect(listedRow).toBeVisible();
    await expect(listedRow).toContainText("Needs review");
    await expect(listedRow).toContainText("Source: Listed");

    // 4. Entire visible page text contains no null, NaN, undefined, or $0
    const visibleText = await page.locator("main").first().innerText();
    expect(visibleText).not.toMatch(/\b(null|NaN|undefined)\b/);
    expect(visibleText).not.toMatch(/\$0(?:\.00)?\b/);
  });
});
