import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireUser: mocks.requireUser,
  userRoles: ["admin", "leadership", "acq_lead", "analyst", "viewer"],
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { inviteAdminUser, updateAdminProfile } from "./actions";

beforeEach(() => {
  mocks.requireUser.mockReset();
});

it("rejects direct admin mutations from a viewer", async () => {
  mocks.requireUser.mockResolvedValue({
    id: "00000000-0000-4000-8000-000000000001",
    role: "viewer",
  });

  await expect(
    updateAdminProfile({
      id: "00000000-0000-4000-8000-000000000002",
      role: "analyst",
      verticals: [],
      clients: [],
      active: true,
    }),
  ).rejects.toThrow("Only administrators can perform this action.");

  await expect(
    inviteAdminUser({
      email: "new-user@example.test",
      fullName: "New User",
      role: "viewer",
      verticals: [],
      clients: [],
    }),
  ).rejects.toThrow("Only administrators can perform this action.");
});

it("prevents an administrator from demoting their own account", async () => {
  mocks.requireUser.mockResolvedValue({
    id: "00000000-0000-4000-8000-000000000001",
    role: "admin",
  });

  await expect(
    updateAdminProfile({
      id: "00000000-0000-4000-8000-000000000001",
      role: "viewer",
      verticals: [],
      clients: [],
      active: true,
    }),
  ).rejects.toThrow("You cannot demote or deactivate your own account.");
});
