import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "./helpers/auth";
import { locateGridCell } from "./helpers/grid";

const output = path.join(process.cwd(), "public", "help");

test("capture the guide using leadership and admin demo accounts", async ({ loginAs }) => {
  mkdirSync(output, { recursive: true });

  const leadership = await loginAs("leadership");
  await leadership.goto("/help");
  await expect(leadership.getByText("You can view all deals, but you cannot edit deals.")).toBeVisible();
  await expect(leadership.locator("#admin")).toHaveCount(0);
  await leadership.goto("/deals");
  await expect(leadership.getByRole("link", { name: "Help for operations" })).toHaveAttribute("href", "/help#operations");
  const filterBar = leadership.getByRole("button", { name: "Has assumptions" }).locator("..").locator("..");
  await expect(filterBar).toBeVisible();
  await filterBar.screenshot({ path: path.join(output, "filters.png") });
  const readOnlyCell = await locateGridCell(leadership, "food_clientA_nyc:5", "bldg_sf");
  await readOnlyCell.hover();
  await expect(readOnlyCell.getByLabel("Editable")).toHaveCount(0);

  await leadership.goto("/weekly");
  await expect(leadership.getByRole("button", { name: "Present" })).toBeVisible();
  await expect(leadership.getByRole("button", { name: "Export PPTX" })).toBeVisible();
  await leadership.locator("header").first().screenshot({ path: path.join(output, "weekly.png") });
  await expect(leadership.getByRole("link", { name: "Help for weekly" })).toHaveAttribute("href", "/help#weekly");

  const admin = await loginAs("admin");
  await admin.goto("/help");
  await expect(admin.locator("#admin")).toBeVisible();
  await expect(admin.getByText("You can view all deals and edit all deals.")).toBeVisible();
  await admin.goto("/deals?vertical=Autonomous%20Vehicle");
  const cell = await locateGridCell(admin, "av_clientC_atl:2", "attributes.power_amps");
  await expect(cell.locator(".bg-amber-500")).toBeVisible();
  await cell.hover();
  await expect(cell.getByLabel("Editable")).toBeVisible();
  await cell.getByRole("button", { name: "Value actions for power_amps" }).click();
  await expect(admin.getByRole("menuitem", { name: "Confirm value" })).toBeVisible();
  const box = await cell.boundingBox();
  if (!box) throw new Error("The assumption cell is not visible.");
  const x = Math.max(0, box.x - 160);
  const y = Math.max(0, box.y - 60);
  await admin.screenshot({
    path: path.join(output, "assumption.png"),
    clip: { x, y, width: Math.min(700, 1440 - x), height: Math.min(280, 900 - y) },
  });
});

test("capture the map card with loaded demographics", async ({ loginAs }) => {
  mkdirSync(output, { recursive: true });
  const leadership = await loginAs("leadership");
  await leadership.goto("/deals?view=map");
  await expect(leadership.getByRole("link", { name: "Help for map" })).toHaveAttribute("href", "/help#map");
  const card = leadership.getByTestId("deal-hover-card");
  const marker = leadership.locator('[title="635 Angier Ave"]').first();
  await expect(card.or(marker)).toBeVisible();
  if (!(await card.isVisible())) {
    await marker.hover();
  } else {
    await leadership.getByRole("button", { name: /635 Angier Ave/ }).hover();
  }
  await expect(card).toBeVisible();
  await expect(card.locator("dt").filter({ hasText: "Population" }).locator("..").locator("dd")).toContainText(/\d/);
  await card.screenshot({ path: path.join(output, "map-card.png") });
});
