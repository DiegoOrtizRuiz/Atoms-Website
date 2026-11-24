import { DEMO_USERS, expect, test } from "./helpers/auth";

test.describe("Live Realtime presence", () => {
  test("admin sees both admin (/admin) and analyst.a (/deals) online within 10s, and closing B removes it", async ({
    loginAs,
  }) => {
    const adminPage = await loginAs("admin");
    await adminPage.goto("/admin", { waitUntil: "domcontentloaded" });

    const onlineCard = adminPage
      .locator('[data-slot="card"]')
      .filter({ has: adminPage.getByText("Online now", { exact: true }) })
      .last();

    await expect(onlineCard).toContainText(DEMO_USERS.admin.fullName, {
      timeout: 10_000,
    });
    await expect(onlineCard).toContainText("/admin", { timeout: 10_000 });

    const analystPage = await loginAs("analyst");
    await analystPage.goto("/deals", { waitUntil: "domcontentloaded" });

    // Both users listed with their correct pages within 10s
    const analystEntry = onlineCard
      .locator("div.flex.items-center.justify-between")
      .filter({ hasText: DEMO_USERS.analyst.fullName });
    await expect(analystEntry).toBeVisible({ timeout: 10_000 });
    await expect(analystEntry).toContainText("/deals", { timeout: 10_000 });

    const adminEntry = onlineCard
      .locator("div.flex.items-center.justify-between")
      .filter({ hasText: DEMO_USERS.admin.fullName });
    await expect(adminEntry).toContainText("/admin");

    // Closing analyst.a context removes them from Online now
    await analystPage.context().close();
    await expect(onlineCard).not.toContainText(DEMO_USERS.analyst.fullName, {
      timeout: 10_000,
    });
  });
});
