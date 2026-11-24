import { expect, test } from "./helpers/auth";

test("help is available to every role and reflects assigned access", async ({ loginAs }) => {
  test.setTimeout(150_000);
  for (const [role, description] of [
    ["leadership", "You can view all deals, but you cannot edit deals."],
    ["viewer", "You can view all deals, but you cannot edit deals."],
    ["analyst", "You can view all deals and edit Client A deals."],
    ["acq_lead", "You can view all deals and edit deals in Food."],
    ["admin", "You can view all deals and edit all deals."],
  ] as const) {
    const page = await loginAs(role);
    await page.goto("/help");
    await expect(page.getByText(description, { exact: true })).toBeVisible();
    await expect(page.locator("#admin")).toHaveCount(role === "admin" ? 1 : 0);
    if (role === "leadership") {
      for (const image of await page.locator("main img").all()) {
        await expect.poll(() => image.evaluate((element) =>
          element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0,
        )).toBe(true);
      }
      await expect(page.locator("main img")).toHaveCount(4);
    }
    await page.context().close();
  }
});

test("navigation and page headers link to the right help sections", async ({ loginAs }) => {
  const page = await loginAs("admin");
  await page.goto("/deals");
  await expect(page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Help" })).toHaveAttribute("href", "/help");
  await expect(page.getByRole("link", { name: "Help for operations" })).toHaveAttribute("href", "/help#operations");
  await page.getByRole("tab", { name: "Map" }).click();
  await expect(page.getByRole("link", { name: "Help for map" })).toHaveAttribute("href", "/help#map");
  await page.goto("/weekly");
  await expect(page.getByRole("link", { name: "Help for weekly" })).toHaveAttribute("href", "/help#weekly");
  await page.goto("/rollup");
  await expect(page.getByRole("link", { name: "Help for rollup" })).toHaveAttribute("href", "/help#rollup");
  await page.goto("/admin");
  await expect(page.getByRole("link", { name: "Help for admin" })).toHaveAttribute("href", "/help#admin");
});
