import { expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn().mockResolvedValue({ role: "viewer" }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { saveWeeklySnapshot } from "./actions";

it("rejects a viewer calling the snapshot action directly", async () => {
  await expect(
    saveWeeklySnapshot({ weekStart: "2026-11-16", data: {} }),
  ).rejects.toThrow("Only administrators and leadership can save snapshots.");
});
