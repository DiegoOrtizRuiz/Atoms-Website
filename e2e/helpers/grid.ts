import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Scrolls an AG Grid vertically & horizontally until the target [row-id][col-id]
 * cell is mounted in the DOM and visible. Works across AG Grid v36+.
 */
export async function locateGridCell(
  page: Page,
  rowId: string,
  colId: string,
): Promise<Locator> {
  const grid = page.getByRole("grid").first();
  await grid.waitFor({ state: "visible", timeout: 20_000 });
  // Wait for at least one data row to mount
  await grid.locator("[row-id]").first().waitFor({ state: "visible", timeout: 20_000 });

  const row = grid.locator(`[row-id="${rowId}"]`).first();
  const cell = row.locator(`[col-id="${colId}"]`).first();

  // Ensure the target row is mounted vertically (scan any vertical scroller inside the grid)
  for (let attempt = 0; attempt < 12; attempt++) {
    if ((await row.count()) > 0) break;
    await grid.evaluate((root, step) => {
      for (const el of root.querySelectorAll<HTMLElement>("*")) {
        if (el.scrollHeight > el.clientHeight + 4) {
          el.scrollTop = step * 260;
        }
      }
    }, attempt + 1);
    await page.waitForTimeout(80);
  }
  await expect(row).toBeVisible({ timeout: 10_000 });

  // Scan horizontally across virtualized columns.
  // In AG Grid v36, .ag-body-horizontal-scroll-viewport sits outside [role="grid"]
  // inside .ag-root-wrapper, so query it at the page level.
  const hScroller = page.locator(".ag-body-horizontal-scroll-viewport").first();
  if ((await cell.count()) === 0 || !(await cell.isVisible().catch(() => false))) {
    const hasScroller = (await hScroller.count()) > 0;
    const metrics = hasScroller
      ? await hScroller.evaluate((hEl) => {
          hEl.scrollLeft = 0;
          return {
            max: Math.max(0, hEl.scrollWidth - hEl.clientWidth),
            step: Math.max(250, Math.floor(hEl.clientWidth * 0.5)),
          };
        })
      : { max: 3000, step: 300 };

    for (let x = 0; x <= metrics.max + metrics.step; x += metrics.step) {
      if (hasScroller) {
        await hScroller.evaluate((el, left) => {
          el.scrollLeft = left;
          el.dispatchEvent(new Event("scroll"));
        }, x);
      }
      await page.waitForTimeout(100);
      if ((await cell.count()) > 0) {
        await cell.scrollIntoViewIfNeeded().catch(() => undefined);
        if (await cell.isVisible().catch(() => false)) {
          return cell;
        }
      }
    }
  }

  await cell.scrollIntoViewIfNeeded().catch(() => undefined);
  await expect(cell).toBeVisible({ timeout: 10_000 });
  return cell;
}

/**
 * Edits an AG Grid text cell by double-clicking, filling the input, and pressing Enter.
 */
export async function editGridTextCell(
  page: Page,
  rowId: string,
  colId: string,
  nextValue: string,
): Promise<void> {
  const cell = await locateGridCell(page, rowId, colId);
  await cell.dblclick();
  const input = cell.locator("input, textarea").first();
  await expect(input).toBeVisible({ timeout: 8_000 });
  await input.fill(nextValue);
  await input.press("Enter");
}

/**
 * Reads the active Supabase access token from the browser context's SSR cookies.
 */
export async function readAccessTokenFromCookies(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const authCookies = cookies
    .filter((c) => /^sb-[^-]+-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!authCookies.length) {
    throw new Error("No Supabase auth cookie found in browser context.");
  }
  let raw = authCookies.map((c) => c.value).join("");
  if (raw.startsWith("base64-")) {
    raw = Buffer.from(raw.slice("base64-".length), "base64url").toString("utf8");
  } else {
    try {
      raw = decodeURIComponent(raw);
    } catch {
      // keep raw
    }
  }
  const parsed = JSON.parse(raw) as { access_token?: string };
  if (!parsed.access_token) {
    throw new Error("Supabase auth cookie did not contain access_token.");
  }
  return parsed.access_token;
}
