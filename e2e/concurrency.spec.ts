import { expect, test } from "./helpers/auth";
import { restoreDeal, snapshotDeal, type DealSnapshot } from "./helpers/db";
import { editGridTextCell, locateGridCell } from "./helpers/grid";

const TARGET_DEAL_ID = "food_clientA_nyc:5";

test.describe("Optimistic-lock concurrency conflict", () => {
  let dealBefore: DealSnapshot | null = null;

  test.beforeEach(async () => {
    dealBefore = await snapshotDeal(TARGET_DEAL_ID);
  });

  test.afterEach(async () => {
    if (dealBefore) await restoreDeal(dealBefore);
  });

  test("two contexts edit the same cell concurrently; second gets conflict toast and reloaded value", async ({
    loginAs,
  }) => {
    const pageA = await loginAs("admin");
    const pageB = await loginAs("acq_lead");

    // Pause background realtime/polling sync in context B so both users
    // hold the identical stale deal.version when editing simultaneously.
    await pageB.route(/\.supabase\.co\/(realtime|rest)\//, (route) =>
      route.abort(),
    );

    await pageA.goto("/deals?vertical=Food", { waitUntil: "domcontentloaded" });
    await pageB.goto("/deals?vertical=Food", { waitUntil: "domcontentloaded" });

    // Locate the same cell in both contexts before either writes
    await locateGridCell(pageA, TARGET_DEAL_ID, "broker");
    await locateGridCell(pageB, TARGET_DEAL_ID, "broker");

    const valueA = `Winner Broker ${Date.now()}`;
    const valueB = `Stale Broker ${Date.now()}`;

    // Context A saves first and bumps deal.version
    await editGridTextCell(pageA, TARGET_DEAL_ID, "broker", valueA);
    await expect(pageA.getByText(/Deal saved|Value updated/)).toBeVisible();

    // Context B edits the same cell with the stale version
    await editGridTextCell(pageB, TARGET_DEAL_ID, "broker", valueB);

    // Context B receives the conflict toast and reloads Context A's winning value
    await expect(
      pageB.getByText("Someone else edited this deal — reloaded"),
    ).toBeVisible({ timeout: 15_000 });

    const reloadedCellB = await locateGridCell(pageB, TARGET_DEAL_ID, "broker");
    await expect(reloadedCellB).toContainText(valueA, { timeout: 10_000 });
  });
});
