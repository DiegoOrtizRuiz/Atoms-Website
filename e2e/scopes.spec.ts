import { expect, test } from "./helpers/auth";
import {
  fetchDealField,
  restoreDeal,
  restoreProfile,
  snapshotDeal,
  snapshotProfile,
  type DealSnapshot,
  type ProfileSnapshot,
} from "./helpers/db";
import { loadLocalEnv } from "./helpers/env";
import {
  editGridTextCell,
  locateGridCell,
  readAccessTokenFromCookies,
} from "./helpers/grid";

const CLIENT_B_DEAL_ID = "catering_clientB_jfk:2";
const ANALYST_EMAIL = "analyst.a@demo.test";

test.describe("Analyst client scopes & live permission updates", () => {
  let dealBefore: DealSnapshot | null = null;
  let profileBefore: ProfileSnapshot | null = null;

  test.beforeEach(async () => {
    dealBefore = await snapshotDeal(CLIENT_B_DEAL_ID);
    profileBefore = await snapshotProfile(ANALYST_EMAIL);
  });

  test.afterEach(async () => {
    if (profileBefore) await restoreProfile(profileBefore);
    if (dealBefore) await restoreDeal(dealBefore);
  });

  test("analyst.a cannot edit Client B (UI + API), admin grants Client B without re-login, reverts, and both log admin_change", async ({
    loginAs,
  }) => {
    loadLocalEnv();
    const analystPage = await loginAs("analyst");

    // Capture the live Supabase anon apikey from the browser's own requests
    let liveApiKey = "";
    analystPage.on("request", (req) => {
      if (liveApiKey) return;
      const url = req.url();
      if (url.includes(".supabase.co")) {
        const headerKey = req.headers()["apikey"];
        if (headerKey) {
          liveApiKey = headerKey;
          return;
        }
        try {
          const parsed = new URL(url);
          const qp = parsed.searchParams.get("apikey");
          if (qp) liveApiKey = qp;
        } catch {
          // ignore
        }
      }
    });

    await analystPage.goto("/deals?vertical=Airline%20Catering", {
      waitUntil: "domcontentloaded",
    });

    // 1. UI read-only check on Client B row
    const brokerCell = await locateGridCell(
      analystPage,
      CLIENT_B_DEAL_ID,
      "broker",
    );
    await expect(
      brokerCell.locator('button[aria-label="Value actions for broker"]'),
    ).toHaveCount(0);
    await brokerCell.dblclick();
    await expect(brokerCell.locator("input, textarea")).toHaveCount(0);

    // 2. Direct API/RLS rejection check using analyst.a's real session JWT
    await expect.poll(() => liveApiKey.length, { timeout: 10_000 }).toBeGreaterThan(10);
    const accessToken = await readAccessTokenFromCookies(analystPage);
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

    const apiResponse = await fetch(
      `${supabaseUrl}/rest/v1/deals?id=eq.${encodeURIComponent(CLIENT_B_DEAL_ID)}`,
      {
        method: "PATCH",
        headers: {
          apikey: liveApiKey,
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({ broker: "Unauthorized Broker" }),
      },
    );
    // Postgres RLS silently filters out non-owned rows (200 with []) or returns 403
    if (apiResponse.ok) {
      const rows = (await apiResponse.json()) as unknown[];
      expect(rows).toEqual([]);
    } else {
      expect([401, 403]).toContain(apiResponse.status);
    }
    const stillUnchanged = await fetchDealField(CLIENT_B_DEAL_ID);
    expect(stillUnchanged.broker).toBe(dealBefore?.broker ?? null);

    // 3. Admin adds Client B to analyst.a
    const adminPage = await loginAs("admin");
    await adminPage.goto("/admin?tab=users", { waitUntil: "domcontentloaded" });
    await adminPage.getByLabel("Search users").fill(ANALYST_EMAIL);
    const analystRow = adminPage
      .locator("table tbody tr")
      .filter({ hasText: ANALYST_EMAIL });
    await expect(analystRow).toBeVisible();
    await analystRow.getByRole("button", { name: "Edit" }).click();

    const dialog = adminPage.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const clientBCheckbox = dialog
      .locator("fieldset", { hasText: "Clients" })
      .locator("label", { hasText: "Client B" })
      .locator('input[type="checkbox"]');
    await clientBCheckbox.check();
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toBeHidden();
    await expect(analystRow).toContainText("Client B");

    // 4. Without re-login, analyst.a reloads /deals and can now edit Client B
    await analystPage.reload({ waitUntil: "domcontentloaded" });
    const tempBroker = `E2E Scope Broker ${Date.now()}`;
    await editGridTextCell(analystPage, CLIENT_B_DEAL_ID, "broker", tempBroker);
    await expect(
      analystPage.getByText(/Deal saved|Value updated/),
    ).toBeVisible();

    const updatedDeal = await fetchDealField(CLIENT_B_DEAL_ID);
    expect(updatedDeal.broker).toBe(tempBroker);

    // 5. Admin reverts Client B from analyst.a
    await analystRow.getByRole("button", { name: "Edit" }).click();
    await expect(dialog).toBeVisible();
    await clientBCheckbox.uncheck();
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toBeHidden();
    await expect(analystRow).not.toContainText("Client B");

    // 6. Both scope changes appear as admin_change in Activity log
    await adminPage.goto("/admin?tab=activity", { waitUntil: "domcontentloaded" });
    await adminPage.getByLabel("Filter by event").selectOption("admin_change");
    const activityTable = adminPage.locator("table tbody");
    await expect(activityTable).toContainText("admin change");
    await expect(activityTable).toContainText(profileBefore!.id);

    const matchingRows = activityTable
      .locator("tr")
      .filter({ hasText: profileBefore!.id })
      .filter({ hasText: "clients" });
    await expect
      .poll(async () => matchingRows.count(), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(2);
  });
});
