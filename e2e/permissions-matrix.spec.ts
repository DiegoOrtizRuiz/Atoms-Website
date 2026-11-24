import { expect, test, type DemoRole } from "./helpers/auth";

const MATRIX: Array<{
  role: DemoRole;
  adminAllowed: boolean;
}> = [
  { role: "admin", adminAllowed: true },
  { role: "leadership", adminAllowed: false },
  { role: "acq_lead", adminAllowed: false },
  { role: "analyst", adminAllowed: false },
  { role: "viewer", adminAllowed: false },
];

const SHARED_ROUTES = ["/deals", "/weekly", "/rollup", "/me"] as const;

test.describe("Role × route permissions matrix", () => {
  for (const { role, adminAllowed } of MATRIX) {
    test(`${role} has expected access across /deals, /weekly, /rollup, /admin, /me`, async ({
      loginAs,
    }) => {
      const page = await loginAs(role);

      for (const route of SHARED_ROUTES) {
        const res = await page.goto(route, { waitUntil: "domcontentloaded" });
        expect(res?.status()).toBeLessThan(400);
        await expect(page).toHaveURL(new RegExp(`${route}(?:\\?|$)`));
      }

      await page.goto("/admin", { waitUntil: "domcontentloaded" });
      if (adminAllowed) {
        await expect(page).toHaveURL(/\/admin/);
        await expect(
          page.getByRole("tab", { name: "Users & permissions" }),
        ).toBeVisible();
      } else {
        await expect(page).toHaveURL(/\/deals/);
      }
    });
  }
});
