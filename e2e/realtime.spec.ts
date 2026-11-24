import { expect, test } from "./helpers/auth";
import { restoreDeal, snapshotDeal, type DealSnapshot } from "./helpers/db";
import { editGridTextCell } from "./helpers/grid";

const CHICAGO_ID = "food_clientA_nyc:5";

test.describe("Realtime cross-view updates", () => {
  let chicagoBefore: DealSnapshot | null = null;

  test.beforeEach(async () => {
    chicagoBefore = await snapshotDeal(CHICAGO_ID);
  });

  test.afterEach(async () => {
    if (chicagoBefore) await restoreDeal(chicagoBefore);
  });

  test("leadership sees admin's Chicago weekly note edit within 10s without reload and 'as of' updates", async ({
    loginAs,
  }) => {
    const leadershipPage = await loginAs("leadership");
    await leadershipPage.goto("/weekly", { waitUntil: "domcontentloaded" });
    await expect(leadershipPage.getByText("2733 W Harrison St")).toBeVisible();

    const asOfLocator = leadershipPage.getByTestId("weekly-as-of");
    await expect(asOfLocator).toBeVisible();
    const initialAsOfText = (await asOfLocator.innerText()).trim();
    const initialAsOfIso = await asOfLocator.getAttribute("data-as-of");

    // Wait > 1 second so the seconds component is guaranteed to advance
    await leadershipPage.waitForTimeout(1200);

    const adminPage = await loginAs("admin");
    await adminPage.goto("/deals?vertical=Food", {
      waitUntil: "domcontentloaded",
    });

    const uniqueNote = `E2E live Chicago update ${Date.now()}`;
    await editGridTextCell(adminPage, CHICAGO_ID, "weekly_note", uniqueNote);
    await expect(
      adminPage.getByText(/Deal saved|Value updated/),
    ).toBeVisible();

    // Verify leadership context B receives the new note within 10s WITHOUT reloading
    const chicagoRow = leadershipPage
      .locator("table tbody tr")
      .filter({ hasText: "2733 W Harrison St" });
    await expect(chicagoRow).toContainText(uniqueNote, { timeout: 10_000 });

    await expect
      .poll(
        async () => ({
          text: (await asOfLocator.innerText()).trim(),
          iso: await asOfLocator.getAttribute("data-as-of"),
        }),
        { timeout: 10_000 },
      )
      .not.toEqual({ text: initialAsOfText, iso: initialAsOfIso });
  });
});
