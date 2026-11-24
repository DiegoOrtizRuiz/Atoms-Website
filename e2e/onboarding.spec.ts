import { expect, signInNewContext, test } from "./helpers/auth";
import { deleteTestUserByEmail } from "./helpers/db";

test.describe("Temporary-password onboarding", () => {
  let createdEmail: string | null = null;

  test.afterEach(async () => {
    if (createdEmail) {
      await deleteTestUserByEmail(createdEmail);
      createdEmail = null;
    }
  });

  test("new temporary-password user is forced to /auth/set-password, blocked from /deals until set, then lands on /deals", async ({
    browser,
    loginAs,
  }) => {
    const email = `e2e.onboard.${Date.now()}@demo.test`;
    createdEmail = email;

    // 1. Admin creates temporary-password user
    const adminPage = await loginAs("admin");
    await adminPage.goto("/admin?tab=users", { waitUntil: "domcontentloaded" });
    await adminPage.getByRole("button", { name: "Invite user" }).click();

    const dialog = adminPage.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("textbox", { name: "Full name" }).fill("E2E Temp User");
    await dialog.getByRole("textbox", { name: "Email" }).fill(email);
    await dialog.getByRole("button", { name: "Create user" }).click();

    const tempCode = dialog.locator("code");
    await expect(tempCode).toBeVisible({ timeout: 20_000 });
    const tempPassword = (await tempCode.innerText()).trim();
    expect(tempPassword.length).toBeGreaterThanOrEqual(12);

    // 2. Temp user logs in with temporary password → forced to /auth/set-password
    const { context: userContext, page: userPage } = await signInNewContext(
      browser,
      email,
      tempPassword,
      { allowSetPassword: true },
    );

    try {
      await expect(userPage).toHaveURL(/\/auth\/set-password/);

      // 3. Cannot load /deals data before setting a permanent password
      await userPage.goto("/deals", { waitUntil: "domcontentloaded" });
      await expect(userPage).toHaveURL(/\/auth\/set-password/);
      await expect(userPage.getByText("635 Angier Ave")).toHaveCount(0);

      // 4. Sets a new password → lands on /deals with real data
      const nextPassword = `TempOnboard!${Date.now()}`;
      await userPage.locator('input[name="password"]').fill(nextPassword);
      await userPage.locator('input[name="confirm"]').fill(nextPassword);
      await Promise.all([
        userPage.waitForURL(/\/deals/, { timeout: 25_000 }),
        userPage.getByRole("button", { name: "Set password" }).click(),
      ]);

      await expect(userPage).toHaveURL(/\/deals/);
      await expect(
        userPage.getByRole("heading", { name: "Operations" }),
      ).toBeVisible();
    } finally {
      await userContext.close().catch(() => undefined);
    }
  });
});
