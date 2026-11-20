import { beforeEach, expect, it, vi } from "vitest";

const createAdminClient = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

import { GET } from "./route";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "test-sha");
  createAdminClient.mockReset();
});

it("returns the deal count from the service-role health query", async () => {
  createAdminClient.mockReturnValue({
    from: () => ({
      select: async () => ({ count: 18, error: null }),
    }),
  });

  const response = await GET();

  expect(await response.json()).toEqual({
    ok: true,
    db: true,
    deals: 18,
    version: "test-sha",
  });
  expect(createAdminClient).toHaveBeenCalledOnce();
});

it("reports unavailable when server-only configuration is missing", async () => {
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");

  const response = await GET();

  expect(await response.json()).toEqual({
    ok: true,
    db: false,
    deals: 0,
    version: "test-sha",
  });
  expect(createAdminClient).not.toHaveBeenCalled();
});
