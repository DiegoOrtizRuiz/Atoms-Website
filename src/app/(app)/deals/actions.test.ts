import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deal: {
    id: "deal-1",
    version: 3,
    vertical: "Food",
    attributes: {},
    field_provenance: { doors: "assumed" },
  },
  columns: [
    { key: "doors", type: "number" },
    { key: "occupied", type: "boolean" },
    { key: "zoning", type: "text" },
  ],
  update: vi.fn(),
  activityInsert: vi.fn().mockResolvedValue({ error: null }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn().mockResolvedValue({ id: "admin-1", role: "admin" }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockImplementation(async () => ({
    from(table: string) {
      if (table === "activity_log") {
        return { insert: mocks.activityInsert };
      }
      if (table === "vertical_config") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { columns: mocks.columns }, error: null }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: mocks.deal, error: null }),
          }),
        }),
        update: (patch: unknown) => {
          mocks.update(patch);
          const query = {
            eq: () => query,
            select: () => query,
            maybeSingle: async () => ({ data: mocks.deal, error: null }),
          };
          return query;
        },
      };
    },
  })),
}));

import { updateDeal } from "./actions";

describe("updateDeal attributes", () => {
  beforeEach(() => {
    mocks.update.mockClear();
    mocks.activityInsert.mockClear();
    mocks.activityInsert.mockResolvedValue({ error: null });
  });

  it("stores numeric and boolean values with their configured types", async () => {
    const result = await updateDeal({
      dealId: "deal-1",
      version: 3,
      field: "attributes.doors",
      value: " 12.5 ",
    });
    expect(mocks.update).toHaveBeenLastCalledWith({ attributes: { doors: 12.5 } });
    expect(mocks.activityInsert).toHaveBeenCalledWith({
      user_id: "admin-1",
      event: "deal_edit",
      path: "/deals",
      detail: { deal_id: "deal-1", field: "attributes.doors" },
    });
    expect(result).toMatchObject({ conflict: false, provenanceKept: true });

    await updateDeal({
      dealId: "deal-1",
      version: 3,
      field: "attributes.occupied",
      value: "false",
    });
    expect(mocks.update).toHaveBeenLastCalledWith({ attributes: { occupied: false } });
  });

  it("trims text and preserves empty values as null", async () => {
    await updateDeal({ dealId: "deal-1", version: 3, field: "attributes.zoning", value: "  I-1  " });
    expect(mocks.update).toHaveBeenLastCalledWith({ attributes: { zoning: "I-1" } });
    await updateDeal({ dealId: "deal-1", version: 3, field: "attributes.doors", value: "  " });
    expect(mocks.update).toHaveBeenLastCalledWith({ attributes: { doors: null } });
  });

  it("rejects unknown keys and invalid numbers or booleans", async () => {
    await expect(updateDeal({ dealId: "deal-1", version: 3, field: "attributes.unknown", value: "x" }))
      .rejects.toThrow("Unknown attribute");
    await expect(updateDeal({ dealId: "deal-1", version: 3, field: "attributes.doors", value: "two" }))
      .rejects.toThrow("valid number");
    await expect(updateDeal({ dealId: "deal-1", version: 3, field: "attributes.occupied", value: "maybe" }))
      .rejects.toThrow("true or false");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("does not report a retained flag when explicitly marking an assumption", async () => {
    const result = await updateDeal({
      dealId: "deal-1",
      version: 3,
      field: "attributes.doors",
      value: 2,
      markAssumption: true,
    });
    expect(result).toMatchObject({ conflict: false, provenanceKept: false });
    expect(mocks.update).toHaveBeenCalledWith({
      attributes: { doors: 2 },
      field_provenance: { doors: "assumed" },
    });
  });
});
