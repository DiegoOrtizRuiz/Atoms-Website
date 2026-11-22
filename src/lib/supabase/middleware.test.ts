import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), profile: vi.fn() }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: mocks.getUser, signOut: vi.fn() },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.profile }) }) }),
  }),
}));
vi.mock("./config", () => ({ hasSupabaseConfig: true, supabaseConfig: { url: "https://example.test", anonKey: "test" } }));
import { updateSession } from "./middleware";

beforeEach(() => {
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mocks.profile.mockResolvedValue({ data: { id: "user-1", role: "admin", must_change_password: true }, error: null });
});

it("sends a pending user to set-password, including on login", async () => {
  for (const path of ["/deals", "/admin", "/login"]) {
    const response = await updateSession(new NextRequest(`https://app.test${path}`));
    expect(response.headers.get("location")).toBe("https://app.test/auth/set-password");
  }
});

it("allows password setup and the email callback without a redirect loop", async () => {
  for (const path of ["/auth/set-password", "/auth/callback", "/auth/complete"]) {
    const response = await updateSession(new NextRequest(`https://app.test${path}`));
    expect(response.headers.get("location")).toBeNull();
  }
});
