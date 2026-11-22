import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ redirect: vi.fn(), createClient: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { requireUser } from "./auth";

it("blocks server actions for users who must change their password", async () => {
  mocks.redirect.mockImplementation(() => { throw new Error("redirect"); });
  mocks.createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({
      data: { active: true, must_change_password: true }, error: null,
    }) }) }) }),
  });
  await expect(requireUser()).rejects.toThrow("redirect");
  expect(mocks.redirect).toHaveBeenCalledWith("/auth/set-password");
});
