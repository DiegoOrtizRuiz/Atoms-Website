import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ exchange: vi.fn(), verify: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession: mocks.exchange, verifyOtp: mocks.verify } }),
}));

import { GET } from "./route";

beforeEach(() => {
  mocks.exchange.mockReset().mockResolvedValue({ error: null });
  mocks.verify.mockReset().mockResolvedValue({ error: null });
});

it.each(["https://evil.test/path", "//evil.test/path", "/\\evil.test", "/\n/evil.test"])(
  "rejects an unsafe next path %s",
  async (next) => {
    const url = new URL("https://app.test/auth/callback");
    url.searchParams.set("code", "test-code");
    url.searchParams.set("next", next);
    const response = await GET(new Request(url));
    expect(response.headers.get("location")).toBe("https://app.test/deals");
    expect(mocks.exchange).toHaveBeenCalledWith("test-code");
  },
);

it("redirects to a safe relative path after exchanging a code", async () => {
  const response = await GET(new Request("https://app.test/auth/callback?code=abc&next=%2Fauth%2Fset-password"));
  expect(response.headers.get("location")).toBe("https://app.test/auth/set-password");
});

it("verifies an invite token hash and does not redirect on failure", async () => {
  mocks.verify.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: "expired" } });
  const request = () => new Request("https://app.test/auth/callback?token_hash=hash&type=invite&next=%2Fauth%2Fset-password");
  expect((await GET(request())).headers.get("location")).toBe("https://app.test/auth/set-password");
  expect(mocks.verify).toHaveBeenCalledWith({ token_hash: "hash", type: "invite" });
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  expect((await GET(request())).headers.get("location")).toBe("https://app.test/login?error=auth_link");
  spy.mockRestore();
});

it("routes default implicit invite links to the browser session handler", async () => {
  const response = await GET(new Request("https://app.test/auth/callback?next=%2Fauth%2Fset-password"));
  expect(response.headers.get("location")).toBe("https://app.test/auth/complete?next=%2Fauth%2Fset-password");
});
