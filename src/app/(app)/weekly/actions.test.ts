import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn().mockResolvedValue({ id: "leader-1", role: "leadership" }),
  snapshotUpsert: vi.fn(),
  activityInsert: vi.fn().mockResolvedValue({ error: null }),
}));

vi.mock("@/lib/auth", () => ({
  requireUser: mocks.requireUser,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from(table: string) {
      if (table === "weekly_snapshots") {
        return {
          upsert: mocks.snapshotUpsert,
        };
      }
      if (table === "activity_log") {
        return { insert: mocks.activityInsert };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { saveWeeklySnapshot } from "./actions";

it("rejects a viewer calling the snapshot action directly", async () => {
  mocks.requireUser.mockResolvedValue({ id: "viewer-1", role: "viewer" });
  await expect(
    saveWeeklySnapshot({ weekStart: "2026-11-16", data: {} }),
  ).rejects.toThrow("Only administrators and leadership can save snapshots.");
});

it("logs successful snapshot saves", async () => {
  mocks.requireUser.mockResolvedValue({ id: "leader-1", role: "leadership" });
  mocks.snapshotUpsert.mockReturnValue({
    select: () => ({
      single: async () => ({
        data: { id: 8, week_start: "2026-11-16", created_at: "2026-11-20T00:00:00Z", data: {} },
        error: null,
      }),
    }),
  });

  await saveWeeklySnapshot({ weekStart: "2026-11-16", data: {} });

  expect(mocks.activityInsert).toHaveBeenCalledWith({
    user_id: "leader-1",
    event: "snapshot",
    path: "/weekly",
    detail: { snapshot_id: 8, week_start: "2026-11-16" },
  });
});
