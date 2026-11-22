import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireUser: mocks.requireUser,
  userRoles: ["admin", "leadership", "acq_lead", "analyst", "viewer"],
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { inviteAdminUser, updateAdminProfile } from "./actions";

beforeEach(() => {
  vi.resetAllMocks();
});

it.each(["temporary", "email"] as const)("creates a user in %s mode without falling back", async (mode) => {
  mocks.requireUser.mockResolvedValue({ id: "admin-id", role: "admin" });
  const insertProfile = vi.fn().mockResolvedValue({ error: null });
  const insertLog = vi.fn().mockResolvedValue({ error: null });
  mocks.createClient.mockResolvedValue({
    from: (table: string) => {
      if (table === "vertical_config") return { select: async () => ({ data: [], error: null }) };
      return { insert: table === "profiles" ? insertProfile : insertLog };
    },
  });
  const createUser = vi.fn().mockResolvedValue({ data: { user: { id: "new-id" } }, error: null });
  const inviteUserByEmail = vi.fn().mockResolvedValue({ data: { user: { id: "new-id" } }, error: null });
  mocks.createAdminClient.mockReturnValue({ auth: { admin: { createUser, inviteUserByEmail } } });
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.test");
  try {
    const result = await inviteAdminUser({
      email: "new@example.test", fullName: "New User", role: "viewer", verticals: [], clients: [], mode,
    });
    expect(insertProfile).toHaveBeenCalledWith(expect.objectContaining({ must_change_password: mode === "temporary" }));
    if (mode === "temporary") {
      expect(result.temporaryPassword).toHaveLength(32);
      expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ email_confirm: true, password: result.temporaryPassword }));
      expect(inviteUserByEmail).not.toHaveBeenCalled();
    } else {
      expect(result.temporaryPassword).toBeNull();
      expect(createUser).not.toHaveBeenCalled();
      expect(inviteUserByEmail).toHaveBeenCalledWith("new@example.test", expect.objectContaining({ redirectTo: "https://app.test/auth/callback?next=/auth/set-password" }));
    }
  } finally {
    vi.unstubAllEnvs();
  }
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
