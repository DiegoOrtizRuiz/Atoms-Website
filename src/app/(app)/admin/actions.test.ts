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
vi.mock("@/lib/geo/service", () => ({
  geocodeMissingDeals: vi.fn().mockResolvedValue({
    processed: 0,
    ok: 0,
    no_address: 0,
    not_found: 0,
    error: 0,
    cached: 0,
    tractGeoids: [],
  }),
}));

import {
  addVerticalConfig,
  geocodeMissingAdminDeals,
  inviteAdminUser,
  registerSourceTab,
  reorderVerticalConfigs,
  saveSourceTab,
  saveVerticalConfig,
  updateAdminProfile,
} from "./actions";

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

  await expect(
    saveVerticalConfig({
      tabPrefix: "food",
      vertical: "Food",
      description: "",
      active: true,
      columns: [],
    }),
  ).rejects.toThrow("Only administrators can perform this action.");
  await expect(
    addVerticalConfig({
      tabPrefix: "new_vertical",
      vertical: "New vertical",
      description: "",
      active: true,
      columns: [],
      sortOrder: 40,
    }),
  ).rejects.toThrow("Only administrators can perform this action.");
  await expect(reorderVerticalConfigs(["food"])).rejects.toThrow(
    "Only administrators can perform this action.",
  );
  await expect(
    saveSourceTab({
      tabName: "food_clientA",
      tabPrefix: "food",
      client: "Client A",
      market: "New York",
      active: true,
    }),
  ).rejects.toThrow("Only administrators can perform this action.");
  await expect(
    registerSourceTab({
      tabName: "food_clientD_mia",
      tabPrefix: "food",
      client: "Client D",
      market: "Miami",
      active: true,
    }),
  ).rejects.toThrow("Only administrators can perform this action.");
  await expect(geocodeMissingAdminDeals()).rejects.toThrow(
    "Only administrators can perform this action.",
  );
  expect(mocks.createClient).not.toHaveBeenCalled();
});

it("rejects duplicate dynamic attribute keys", async () => {
  mocks.requireUser.mockResolvedValue({
    id: "00000000-0000-4000-8000-000000000001",
    role: "admin",
  });

  await expect(
    addVerticalConfig({
      tabPrefix: "new_vertical",
      vertical: "New vertical",
      description: "",
      active: true,
      columns: [
        { key: "sprinkler", label: "Sprinkler", type: "string" },
        { key: "sprinkler", label: "Sprinkler status", type: "boolean" },
      ],
      sortOrder: 40,
    }),
  ).rejects.toThrow("Duplicate attribute key: sprinkler");
  expect(mocks.createClient).not.toHaveBeenCalled();
});

it("reports a missing source tab instead of showing a false save success", async () => {
  mocks.requireUser.mockResolvedValue({
    id: "00000000-0000-4000-8000-000000000001",
    role: "admin",
  });
  const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  const query = {
    update: vi.fn(() => query),
    eq: vi.fn(() => query),
    select: vi.fn(() => query),
    maybeSingle,
  };
  mocks.createClient.mockResolvedValue({ from: () => query });

  await expect(
    saveSourceTab({
      tabName: "unknown_tab",
      tabPrefix: "food",
      client: null,
      market: null,
      active: true,
    }),
  ).rejects.toThrow("Source tab unknown_tab was not found.");
  expect(maybeSingle).toHaveBeenCalledOnce();
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
