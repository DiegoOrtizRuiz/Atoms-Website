import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  fetchTractDemographics: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("./acs", async (importOriginal) => ({
  ...await importOriginal<typeof import("./acs")>(),
  fetchTractDemographics: mocks.fetchTractDemographics,
}));

import { AcsFetchError } from "./acs";
import { ensureTractDemographics } from "./service";

beforeEach(() => {
  vi.resetAllMocks();
});

it.each([
  "CENSUS_API_KEY is not configured.",
  "Census ACS request failed (HTTP 503).",
])("records %s without overwriting previously cached demographics", async (reason) => {
  const insert = vi.fn().mockResolvedValue({ error: null });
  const updateEq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq: updateEq });
  const table = {
    select: () => ({ in: async () => ({
      data: [{ geoid: "13121001801", fetched_at: "2020-01-01", last_error: null }],
      error: null,
    }) }),
    insert,
    update,
  };
  mocks.createAdminClient.mockReturnValue({ from: () => table });
  mocks.fetchTractDemographics.mockRejectedValue(new AcsFetchError(reason));

  const summary = await ensureTractDemographics(["13121001801", "13121001702"]);

  expect(summary.failed).toBe(2);
  expect(update).toHaveBeenCalledWith({ last_error: reason });
  expect(updateEq).toHaveBeenCalledWith("geoid", "13121001801");
  expect(insert).toHaveBeenCalledWith({
    geoid: "13121001702",
    source: "Census ACS 5-yr",
    last_error: reason,
  });
});

it("retries failed tracts even when their cache timestamp is fresh", async () => {
  const upsert = vi.fn().mockResolvedValue({ error: null });
  mocks.createAdminClient.mockReturnValue({
    from: () => ({
      select: () => ({ in: async () => ({
        data: [{ geoid: "13121001801", fetched_at: new Date().toISOString(), last_error: "Census ACS request failed (HTTP 503)." }],
        error: null,
      }) }),
      upsert,
    }),
  });
  const fetched = { geoid: "13121001801", source: "Census ACS 5-yr (2023)", last_error: null };
  mocks.fetchTractDemographics.mockResolvedValue(fetched);

  const summary = await ensureTractDemographics(["13121001801"]);

  expect(summary.refreshed).toBe(1);
  expect(upsert).toHaveBeenCalledWith(fetched, { onConflict: "geoid" });
});

it("surfaces errors when a failure cannot be recorded", async () => {
  mocks.createAdminClient.mockReturnValue({
    from: () => ({
      select: () => ({ in: async () => ({ data: [], error: null }) }),
      insert: async () => ({ error: { message: "database unavailable" } }),
    }),
  });
  mocks.fetchTractDemographics.mockRejectedValue(new AcsFetchError("Census ACS request failed (HTTP 503)."));
  await expect(ensureTractDemographics(["13121001702"])).rejects.toThrow("database unavailable");
});
