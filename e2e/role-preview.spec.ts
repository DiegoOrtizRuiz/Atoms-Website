import { expect, test } from "./helpers/auth";
import { locateGridCell } from "./helpers/grid";

const ANGIER_ID = "av_clientC_atl:2";

test.describe("Admin role preview", () => {
  test("admin selects View as Analyst, sees banner, hidden edit controls, and analyst nav, then resets", async ({
    loginAs,
  }) => {
    const adminPage = await loginAs("admin");
    await adminPage.goto("/deals?vertical=Autonomous%20Vehicle", {
      waitUntil: "domcontentloaded",
    });

    const nav = adminPage.getByRole("navigation", {
      name: "Primary navigation",
    });
    const roleSelect = adminPage.getByLabel("Viewing as role");

    try {
      // Confirm Admin link & edit controls exist before preview
      await expect(nav.getByRole("link", { name: "Admin" })).toBeVisible();
      const brokerBefore = await locateGridCell(adminPage, ANGIER_ID, "broker");
      await expect(
        brokerBefore.locator('button[aria-label="Value actions for broker"]'),
      ).toHaveCount(1);

      // Switch to View as Analyst
      await roleSelect.selectOption("analyst");

      // Banner shows
      await expect(
        adminPage.getByText(
          "Previewing as analyst — your real permissions still apply to saves.",
        ),
      ).toBeVisible();

      // Nav matches analyst role (Admin link hidden; Operations/Weekly/Rollup/My profile visible)
      await expect(nav.getByRole("link", { name: "Admin" })).toHaveCount(0);
      await expect(nav.getByRole("link", { name: "Operations" })).toBeVisible();
      await expect(
        nav.getByRole("link", { name: "Weekly Review" }),
      ).toBeVisible();
      await expect(nav.getByRole("link", { name: "Rollup" })).toBeVisible();
      await expect(nav.getByRole("link", { name: "My profile" })).toBeVisible();

      // Edit controls hidden where analyst cannot edit (admin has clients: [])
      const brokerPreview = await locateGridCell(adminPage, ANGIER_ID, "broker");
      await expect(
        brokerPreview.locator('button[aria-label="Value actions for broker"]'),
      ).toHaveCount(0);
      await brokerPreview.dblclick();
      await expect(brokerPreview.locator("input, textarea")).toHaveCount(0);

      // Deal drawer also hides Edit address button in analyst preview
      const addressCell = await locateGridCell(adminPage, ANGIER_ID, "address");
      await addressCell.getByRole("button", { name: /635 Angier Ave/ }).click();
      const drawer = adminPage.getByRole("dialog");
      await expect(drawer).toBeVisible();
      await expect(
        drawer.getByRole("button", { name: "Edit address" }),
      ).toHaveCount(0);
      await drawer.getByRole("button", { name: "Close", exact: true }).click();

      // Reset to Admin
      await roleSelect.selectOption("admin");
      await expect(
        adminPage.getByText(/Previewing as analyst/),
      ).toHaveCount(0);
      await expect(nav.getByRole("link", { name: "Admin" })).toBeVisible();
    } finally {
      // Guarantee preview cookie is reset even if an assertion failed
      if ((await roleSelect.inputValue().catch(() => "admin")) !== "admin") {
        await roleSelect.selectOption("admin").catch(() => undefined);
      }
    }
  });
});
