import { DEMO_USERS, expect, test } from "./helpers/auth";
import { restoreDeal, snapshotDeal, type DealSnapshot } from "./helpers/db";
import { locateGridCell } from "./helpers/grid";

const ANGIER_ID = "av_clientC_atl:2";
const FOOD_DEAL_ID = "food_clientA_nyc:5";

test.describe("Assumptions & provenance workflow", () => {
  let angierBefore: DealSnapshot | null = null;
  let foodBefore: DealSnapshot | null = null;

  test.beforeEach(async () => {
    angierBefore = await snapshotDeal(ANGIER_ID);
    foodBefore = await snapshotDeal(FOOD_DEAL_ID);
  });

  test.afterEach(async () => {
    if (angierBefore) await restoreDeal(angierBefore);
    if (foodBefore) await restoreDeal(foodBefore);
  });

  test("admin confirms 400A on 635 Angier Ave, lead.food marks a Food assumption, analyst.a sees no Confirm action", async ({
    loginAs,
  }) => {
    // 1. Admin confirms 400A power on 635 Angier Ave
    const adminPage = await loginAs("admin");
    await adminPage.goto("/deals?vertical=Autonomous%20Vehicle", {
      waitUntil: "domcontentloaded",
    });

    const powerCell = await locateGridCell(
      adminPage,
      ANGIER_ID,
      "attributes.power_amps",
    );
    await expect(powerCell).toContainText("400");
    await expect(powerCell.locator(".italic")).toBeVisible();
    await expect(powerCell.locator(".bg-amber-500")).toBeVisible();

    await powerCell
      .locator('button[aria-label="Value actions for power_amps"]')
      .click({ force: true });
    await adminPage.getByRole("menuitem", { name: "Confirm value" }).click();

    await expect(adminPage.getByText("Value confirmed")).toBeVisible();
    await expect(powerCell.locator(".italic")).toHaveCount(0);
    await expect(powerCell.locator(".bg-amber-500")).toHaveCount(0);

    // Open deal drawer and verify history row by name (Demo Admin)
    const addressCell = await locateGridCell(adminPage, ANGIER_ID, "address");
    await addressCell.getByRole("button", { name: /635 Angier Ave/ }).click();
    const drawer = adminPage.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("heading", { name: "History" })).toBeVisible();
    await expect(drawer).toContainText("field provenance");
    await expect(drawer).toContainText(DEMO_USERS.admin.fullName);

    // 2. lead.food marks a Food deal value as an assumption
    const foodLeadPage = await loginAs("acq_lead");
    await foodLeadPage.goto("/deals?vertical=Food", {
      waitUntil: "domcontentloaded",
    });

    const sfCell = await locateGridCell(foodLeadPage, FOOD_DEAL_ID, "bldg_sf");
    await expect(sfCell.locator(".bg-amber-500")).toHaveCount(0);
    await sfCell
      .locator('button[aria-label="Value actions for bldg_sf"]')
      .click({ force: true });
    await foodLeadPage
      .getByRole("menuitem", { name: "Mark as assumption" })
      .click();

    await expect(sfCell.locator(".italic")).toBeVisible();
    await expect(sfCell.locator(".bg-amber-500")).toBeVisible();

    // 3. analyst.a sees the assumed styling on that Food deal, but NO Confirm action
    const analystPage = await loginAs("analyst");
    await analystPage.goto("/deals?vertical=Food", {
      waitUntil: "domcontentloaded",
    });

    const analystSfCell = await locateGridCell(
      analystPage,
      FOOD_DEAL_ID,
      "bldg_sf",
    );
    await expect(analystSfCell.locator(".bg-amber-500")).toBeVisible();
    await analystSfCell
      .locator('button[aria-label="Value actions for bldg_sf"]')
      .click({ force: true });
    await expect(
      analystPage.getByRole("menuitem", { name: "Mark as assumption" }),
    ).toBeVisible();
    await expect(
      analystPage.getByRole("menuitem", { name: "Confirm value" }),
    ).toHaveCount(0);
  });
});
