import {
  test as base,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { e2eBaseUrl, e2ePassword } from "./env";

export type DemoRole = "admin" | "leadership" | "acq_lead" | "analyst" | "viewer";

export const DEMO_USERS: Record<
  DemoRole,
  { email: string; fullName: string }
> = {
  admin: { email: "admin@demo.test", fullName: "Demo Admin" },
  leadership: { email: "leadership@demo.test", fullName: "Demo Leadership" },
  acq_lead: { email: "lead.food@demo.test", fullName: "Food Lead" },
  analyst: { email: "analyst.a@demo.test", fullName: "Analyst A" },
  viewer: { email: "viewer@demo.test", fullName: "Demo Viewer" },
};

export async function signInNewContext(
  browser: Browser,
  email: string,
  password: string,
  options?: { allowSetPassword?: boolean },
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL: e2eBaseUrl(),
    acceptDownloads: true,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 25_000,
    }),
    page.locator('button[type="submit"]').click(),
  ]);
  if (!options?.allowSetPassword) {
    await expect(page).not.toHaveURL(/\/auth\/set-password/);
  }
  return { context, page };
}

type AuthFixtures = {
  loginAs: (role: DemoRole) => Promise<Page>;
};

export const test = base.extend<AuthFixtures>({
  loginAs: async ({ browser }, provide) => {
    const contexts: BrowserContext[] = [];
    const loginAs = async (role: DemoRole): Promise<Page> => {
      const { email } = DEMO_USERS[role];
      const { context, page } = await signInNewContext(
        browser,
        email,
        e2ePassword(),
      );
      contexts.push(context);
      return page;
    };
    await provide(loginAs);
    for (const ctx of contexts) {
      await ctx.close().catch(() => undefined);
    }
  },
});

export { expect };
