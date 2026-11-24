import { expect, test } from "./helpers/auth";

test("administrators can see the failed tract count and retry control", async ({ loginAs }) => {
  const page = await loginAs("admin");
  await page.goto("/admin?tab=health");
  const heading = page.getByText(/^Failed demographics tracts: \d/);
  await expect(heading).toBeVisible();
  const count = Number((await heading.textContent())?.match(/\d[\d,]*/)?.[0].replaceAll(",", ""));
  expect(Number.isFinite(count)).toBe(true);
  const retry = heading.locator("..").locator("..").getByRole("button", { name: "Retry" });
  if (count === 0) await expect(retry).toBeDisabled();
  else await expect(retry).toBeEnabled();
});
