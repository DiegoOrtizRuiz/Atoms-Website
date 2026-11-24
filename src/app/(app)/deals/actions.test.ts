import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: {
    id: "admin-1",
    role: "admin",
    verticals: [] as string[],
    clients: [] as string[],
  },
  deal: {
    id: "deal-1",
    version: 3,
    vertical: "Food",
    client: "Client A",
    stage: "In Contract",
    notes: "closing 11/25, $250k deposit",
    weekly_note: "Closing 11/25; $250k deposit.",
    attributes: {},
    notes_extracted: {
      key_dates: [{ label: "Closing", date_text: "11/25", iso_guess: "2026-11-25" }],
      negotiated_price: null,
      price_context: "$250k deposit",
      risks: [],
      next_step: null,
      deal_type: "buy",
      weekly_note: "Closing 11/25; $250k deposit.",
      evidence: [{ field: "key_dates", quote: "closing 11/25" }],
      confidence: 0.95,
      suggested_stage: null,
      suggested_stage_reason: null,
    },
    field_provenance: {
      doors: "assumed",
      weekly_note: "llm_suggested",
      notes_extracted: "llm_suggested",
    },
  },
  columns: [
    { key: "doors", type: "number" },
    { key: "occupied", type: "boolean" },
    { key: "zoning", type: "text" },
  ],
  update: vi.fn(),
  adminUpdate: vi.fn(),
  activityInsert: vi.fn().mockResolvedValue({ error: null }),
  geocodeDealById: vi.fn(),
  checkUserRateLimit: vi.fn().mockReturnValue({ allowed: true }),
  generateDealSuggestion: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/geo/service", () => ({
  geocodeDealById: mocks.geocodeDealById,
}));
vi.mock("@/lib/llm/server-enrich", () => ({
  checkUserRateLimit: mocks.checkUserRateLimit,
  generateDealSuggestion: mocks.generateDealSuggestion,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: () => ({
      update: (patch: unknown) => {
        mocks.adminUpdate(patch);
        const query = {
          eq: () => query,
          select: () => query,
          single: async () => ({
            data: { ...mocks.deal, ...(patch as Record<string, unknown>) },
            error: null,
          }),
        };
        return query;
      },
    }),
  })),
}));
vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn().mockImplementation(async () => mocks.user),
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

import {
  acceptAiSuggestion,
  dismissAiSuggestion,
  editAndAcceptAiSuggestion,
  regenerateDealSuggestion,
  updateDeal,
} from "./actions";

describe("updateDeal attributes", () => {
  beforeEach(() => {
    mocks.user = {
      id: "admin-1",
      role: "admin",
      verticals: [],
      clients: [],
    };
    mocks.update.mockClear();
    mocks.adminUpdate.mockClear();
    mocks.activityInsert.mockClear();
    mocks.activityInsert.mockResolvedValue({ error: null });
    mocks.geocodeDealById.mockReset();
    mocks.checkUserRateLimit.mockReset();
    mocks.checkUserRateLimit.mockReturnValue({ allowed: true });
    mocks.generateDealSuggestion.mockReset();
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
      field_provenance: {
        doors: "assumed",
        weekly_note: "llm_suggested",
        notes_extracted: "llm_suggested",
      },
    });
  });

  it("re-geocodes only the edited deal when address, city, or state changes", async () => {
    const geocodedDeal = {
      ...mocks.deal,
      address: "635 Angier Ave",
      lat: 33.7647,
      lng: -84.3662,
      geocode_status: "ok",
    };
    mocks.geocodeDealById.mockResolvedValueOnce(geocodedDeal);

    const addressResult = await updateDeal({
      dealId: "deal-1",
      version: 3,
      field: "address",
      value: "635 Angier Ave",
    });
    expect(mocks.geocodeDealById).toHaveBeenCalledTimes(1);
    expect(mocks.geocodeDealById).toHaveBeenCalledWith("deal-1");
    expect(addressResult).toMatchObject({ conflict: false, deal: geocodedDeal });

    mocks.geocodeDealById.mockClear();
    await updateDeal({
      dealId: "deal-1",
      version: 3,
      field: "notes",
      value: "Non-address update",
    });
    expect(mocks.geocodeDealById).not.toHaveBeenCalled();
  });
});

describe("AI suggestion review actions", () => {
  beforeEach(() => {
    mocks.user = {
      id: "admin-1",
      role: "admin",
      verticals: [],
      clients: [],
    };
    mocks.update.mockClear();
    mocks.adminUpdate.mockClear();
    mocks.activityInsert.mockClear();
    mocks.activityInsert.mockResolvedValue({ error: null });
    mocks.checkUserRateLimit.mockReset();
    mocks.checkUserRateLimit.mockReturnValue({ allowed: true });
    mocks.generateDealSuggestion.mockReset();
  });

  it("allows admin and scoped acq_lead to accept key_dates, and rejects analyst", async () => {
    // 1. acq_lead for Food (lead.food) can accept Food deal suggestion
    mocks.user = {
      id: "lead-food-1",
      role: "acq_lead",
      verticals: ["Food"],
      clients: [],
    };
    const leadRes = await acceptAiSuggestion({
      dealId: "deal-1",
      version: 3,
      section: "key_dates",
    });
    expect(leadRes.conflict).toBe(false);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        field_provenance: expect.objectContaining({
          "ai:key_dates": "confirmed",
        }),
      }),
    );
    expect(mocks.activityInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "lead-food-1",
        event: "ai_review",
        detail: { deal_id: "deal-1", section: "key_dates", action: "accept" },
      }),
    );

    // 2. analyst (analyst.a) cannot accept AI suggestions even for their client
    mocks.update.mockClear();
    mocks.user = {
      id: "analyst-a-1",
      role: "analyst",
      verticals: ["Food"],
      clients: ["Client A"],
    };
    await expect(
      acceptAiSuggestion({
        dealId: "deal-1",
        version: 3,
        section: "key_dates",
      }),
    ).rejects.toThrow("You do not have permission to review AI suggestions.");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("edits and accepts weekly_note without touching source fields", async () => {
    const res = await editAndAcceptAiSuggestion({
      dealId: "deal-1",
      version: 3,
      section: "weekly_note",
      editedText: "Closing confirmed 11/25.",
    });
    expect(res.conflict).toBe(false);
    expect(mocks.update).toHaveBeenCalledWith({
      weekly_note: "Closing confirmed 11/25.",
      field_provenance: expect.objectContaining({
        weekly_note: "confirmed",
      }),
    });
    expect(mocks.adminUpdate).not.toHaveBeenCalled();
    expect(mocks.activityInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "ai_review",
        detail: expect.objectContaining({
          section: "weekly_note",
          action: "edit_accept",
        }),
      }),
    );
  });

  it("dismisses a suggestion by recording _dismissed and writing an audit row", async () => {
    const res = await dismissAiSuggestion({
      dealId: "deal-1",
      version: 3,
      section: "price_context",
    });
    expect(res.conflict).toBe(false);
    expect(mocks.adminUpdate).toHaveBeenCalledWith({
      notes_extracted: expect.objectContaining({
        _dismissed: ["price_context"],
      }),
    });
    expect(mocks.activityInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "ai_review",
        detail: expect.objectContaining({
          deal_id: "deal-1",
          section: "price_context",
          action: "dismiss",
        }),
      }),
    );
  });

  it("returns a friendly no-op message when no LLM key is configured and enforces rate limit", async () => {
    mocks.generateDealSuggestion.mockResolvedValueOnce({
      ok: false,
      configured: false,
      message: "AI regeneration is unavailable because no LLM provider key is configured.",
    });

    const unconfigured = await regenerateDealSuggestion({
      dealId: "deal-1",
      version: 3,
    });
    expect(unconfigured).toMatchObject({
      ok: false,
      configured: false,
    });
    expect(mocks.adminUpdate).not.toHaveBeenCalled();

    mocks.checkUserRateLimit.mockReturnValueOnce({
      allowed: false,
      retryAfterSec: 42,
    });
    const limited = await regenerateDealSuggestion({
      dealId: "deal-1",
      version: 3,
    });
    expect(limited).toMatchObject({
      ok: false,
      configured: true,
    });
    expect(limited.message).toContain("42s");
  });
});
