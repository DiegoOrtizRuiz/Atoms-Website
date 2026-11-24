import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireUser: mocks.requireUser,
  userRoles: ["admin", "leadership", "acq_lead", "analyst", "viewer"],
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));
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
  applyImportRun,
  createImportUploadUrl,
  discardImportRun,
  getImportRun,
  previewImportRun,
  repreviewImportRun,
} from "./import-actions";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("import-actions safety and authorization", () => {
  it.each(["viewer", "analyst", "acq_lead", "leadership"] as const)(
    "rejects all import actions for non-admin role %s",
    async (role) => {
      mocks.requireUser.mockResolvedValue({
        id: "00000000-0000-4000-8000-000000000001",
        role,
      });

      await expect(
        createImportUploadUrl({
          fileName: "src.xlsx",
          fileSize: 1024,
          mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      ).rejects.toThrow("Only administrators can perform this action.");

      await expect(
        previewImportRun({
          storagePath: "runs/123-abc/src.xlsx",
          fileName: "src.xlsx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      ).rejects.toThrow("Only administrators can perform this action.");

      await expect(repreviewImportRun(1)).rejects.toThrow(
        "Only administrators can perform this action.",
      );
      await expect(
        applyImportRun({ runId: 1, decisions: { conflicts: {}, missing: {} } }),
      ).rejects.toThrow("Only administrators can perform this action.");
      await expect(discardImportRun(1)).rejects.toThrow(
        "Only administrators can perform this action.",
      );
      await expect(getImportRun(1)).rejects.toThrow(
        "Only administrators can perform this action.",
      );
      expect(mocks.createClient).not.toHaveBeenCalled();
    },
  );

  it("rejects oversized, wrong-extension, wrong-MIME, and path-traversal uploads", async () => {
    mocks.requireUser.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000099",
      role: "admin",
    });

    await expect(
      createImportUploadUrl({
        fileName: "deals.csv",
        fileSize: 1024,
        mimeType: "text/csv",
      }),
    ).rejects.toThrow("Only .xlsx workbooks are supported.");

    await expect(
      createImportUploadUrl({
        fileName: "huge.xlsx",
        fileSize: 10 * 1024 * 1024 + 1,
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    ).rejects.toThrow("Workbook exceeds the 10 MB maximum file size.");

    await expect(
      createImportUploadUrl({
        fileName: "fake.xlsx",
        fileSize: 500,
        mimeType: "application/pdf",
      }),
    ).rejects.toThrow("Unsupported file type");

    await expect(
      previewImportRun({
        storagePath: "../secrets/evil.xlsx",
        fileName: "evil.xlsx",
        mimeType: "",
      }),
    ).rejects.toThrow("Invalid import storage path.");
  });

  it("marks malformed uploaded workbooks as failed with a clear error message", async () => {
    mocks.requireUser.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000099",
      role: "admin",
    });

    const insertedPayloads: Record<string, unknown>[] = [];
    const insertBuilder = {
      select: vi.fn(() => insertBuilder),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 77 }, error: null }),
    };

    mocks.createClient.mockResolvedValue({
      storage: {
        from: () => ({
          download: vi.fn().mockResolvedValue({
            data: new Blob([Buffer.from("definitely not a zip/xlsx file")]),
            error: null,
          }),
        }),
      },
      from: (table: string) => {
        if (table === "vertical_config") {
          return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
        }
        if (table === "source_tabs") {
          return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
        }
        if (table === "deals") {
          return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
        }
        if (table === "deal_history") {
          const q = {
            select: vi.fn(() => q),
            not: vi.fn(() => q),
            is: vi.fn(() => q),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
          return q;
        }
        if (table === "import_runs") {
          const q = {
            select: vi.fn(() => q),
            eq: vi.fn(() => q),
            order: vi.fn(() => q),
            limit: vi.fn(() => q),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            insert: vi.fn((payload: Record<string, unknown>) => {
              insertedPayloads.push(payload);
              return insertBuilder;
            }),
          };
          return q;
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    });

    const result = await previewImportRun({
      storagePath: "runs/123-abc/corrupt.xlsx",
      fileName: "corrupt.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.runId).toBe(77);
      expect(result.error).toContain("not a valid .xlsx workbook");
    }
    expect(insertedPayloads).toHaveLength(1);
    expect(insertedPayloads[0]).toMatchObject({
      status: "failed",
      file_name: "corrupt.xlsx",
    });
  });

  it("uses cached formula values and flags uncached/error formulas in previewImportRun", async () => {
    mocks.requireUser.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000099",
      role: "admin",
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("food_clientA_nyc");
    ws.addRow([
      "Client",
      "Metro",
      "City",
      "Address",
      "Status",
      "Bldg SF",
      "List Price",
    ]);
    ws.addRow([
      "Client A",
      "NYC",
      "Miami",
      "100 Formula Way",
      "nego psa",
      { formula: "10000+2500", result: 12500 },
      { formula: "F2*200" }, // no cached value
    ]);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    let insertedRow: Record<string, unknown> | null = null;
    const insertBuilder = {
      select: vi.fn(() => insertBuilder),
      single: vi.fn(async () => ({
        data: {
          id: 88,
          created_at: "2026-11-23T16:00:00.000Z",
          applied_at: null,
          applied_by: null,
          error_message: null,
          ...insertedRow,
        },
        error: null,
      })),
    };

    mocks.createClient.mockResolvedValue({
      storage: {
        from: () => ({
          download: vi.fn().mockResolvedValue({
            data: new Blob([buffer]),
            error: null,
          }),
        }),
      },
      from: (table: string) => {
        if (table === "vertical_config") {
          return {
            select: vi.fn().mockResolvedValue({
              data: [{ tab_prefix: "food", vertical: "Food" }],
              error: null,
            }),
          };
        }
        if (table === "source_tabs") {
          return {
            select: vi.fn().mockResolvedValue({
              data: [{ tab_name: "food_clientA_nyc", tab_prefix: "food" }],
              error: null,
            }),
          };
        }
        if (table === "deals") {
          return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
        }
        if (table === "deal_history") {
          const q = {
            select: vi.fn(() => q),
            not: vi.fn(() => q),
            is: vi.fn(() => q),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
          return q;
        }
        if (table === "import_runs") {
          const q = {
            select: vi.fn(() => q),
            eq: vi.fn(() => q),
            order: vi.fn(() => q),
            limit: vi.fn(() => q),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            insert: vi.fn((payload: Record<string, unknown>) => {
              insertedRow = payload;
              return insertBuilder;
            }),
          };
          return q;
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    });

    const result = await previewImportRun({
      storagePath: "runs/123-abc/formulas.xlsx",
      fileName: "formulas.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.run.status).toBe("previewed");
      expect(result.run.summary?.formula_warnings).toHaveLength(1);
      expect(result.run.diff?.deals[0]?.incoming?.bldg_sf).toBe(12500);
      expect(result.run.diff?.deals[0]?.incoming?.list_price).toBeNull();
      expect(result.run.diff?.deals[0]?.needs_review).toBe(true);
    }
  });
});
