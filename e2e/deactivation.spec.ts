import { expect, test } from "./helpers/auth";
import {
  restoreProfile,
  snapshotProfile,
  type ProfileSnapshot,
} from "./helpers/db";

const VIEWER_EMAIL = "viewer@demo.test";

test.describe("User deactivation", () => {
  let viewerBefore: ProfileSnapshot | null = null;

  test.beforeEach(async () => {
    viewerBefore = await snapshotProfile(VIEWER_EMAIL);
  });

  test.afterEach(async () => {
    if (viewerBefore) await restoreProfile(viewerBefore);
  });

  test("deactivating viewer redirects their next navigation to /login, then reactivating restores access", async ({
    loginAs,
  }) => {
    const viewerPage = await loginAs("viewer");
    await viewerPage.goto("/deals", { waitUntil: "domcontentloaded" });
    await expect(viewerPage).toHaveURL(/\/deals/);

    const adminPage = await loginAs("admin");
    await adminPage.goto("/admin?tab=users", { waitUntil: "domcontentloaded" });
    await adminPage.getByLabel("Search users").fill(VIEWER_EMAIL);

    const viewerRow = adminPage
      .locator("table tbody tr")
      .filter({ hasText: VIEWER_EMAIL });
    await expect(viewerRow).toBeVisible();
    await viewerRow.getByRole("button", { name: "Edit" }).click();

    const dialog = adminPage.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const activeCheckbox = dialog
      .locator("label", { hasText: "Active account" })
      .locator('input[type="checkbox"]');
    await activeCheckbox.uncheck();
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toBeHidden();
    await expect(viewerRow).toContainText("No");

    // Viewer's next navigation must land on /login
    await viewerPage.goto("/weekly", { waitUntil: "domcontentloaded" });
    await expect(viewerPage).toHaveURL(/\/login/);

    // Reactivate viewer via Admin UI
    await viewerRow.getByRole("button", { name: "Edit" }).click();
    await expect(dialog).toBeVisible();
    await activeCheckbox.check();
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toBeHidden();
    await expect(viewerRow).toContainText("Yes");
  });
});
