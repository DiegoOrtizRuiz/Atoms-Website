import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), createAdminClient: vi.fn(), redirect: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { setPassword } from "./actions";

beforeEach(() => vi.clearAllMocks());

it.each([
  ["short", "short", "at least 12"],
  ["a-long-password", "a-different-password", "do not match"],
])("rejects invalid passwords before accessing auth", async (password, confirm, message) => {
  const data = new FormData();
  data.set("password", password);
  data.set("confirm", confirm);
  expect((await setPassword({}, data)).error).toContain(message);
  expect(mocks.createClient).not.toHaveBeenCalled();
});

it("updates the password, records the event, and clears the flag before redirecting", async () => {
  const updateUser = vi.fn().mockResolvedValue({ error: null });
  const insert = vi.fn().mockResolvedValue({ error: null });
  const readProfile = { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "user-1", active: true }, error: null }) }) }) };
  mocks.createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }), updateUser },
    from: (table: string) => table === "profiles" ? readProfile : { insert },
  });
  const update = vi.fn(() => ({ eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: "user-1" }, error: null }) }) }) }) }));
  mocks.createAdminClient.mockReturnValue({ from: () => ({ update }) });
  const data = new FormData();
  data.set("password", "new-password-123");
  data.set("confirm", "new-password-123");
  await setPassword({}, data);
  expect(updateUser).toHaveBeenCalledWith({ password: "new-password-123" });
  expect(insert).toHaveBeenCalledWith({ user_id: "user-1", event: "password_set", path: "/auth/set-password" });
  expect(update).toHaveBeenCalledWith({ must_change_password: false });
  expect(mocks.redirect).toHaveBeenCalledWith("/deals");
});
