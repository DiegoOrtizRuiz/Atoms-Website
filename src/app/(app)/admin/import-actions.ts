"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import type { Database, Json } from "@/lib/database.types";
import { geocodeMissingDeals } from "@/lib/geo/service";
import {
  computeImportDiff,
  type ImportDiffPayload,
  type ImportSummary,
} from "@/lib/import/diff";
import { ImportWorkbookError, normalizeWorkbook } from "@/lib/import/normalize";
import { createClient } from "@/lib/supabase/server";

const MAX_IMPORT_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
  "",
]);

const STORAGE_PATH_PATTERN = /^runs\/[0-9a-zA-Z_-]+\/[0-9a-zA-Z._-]+\.xlsx$/i;

const uploadUrlSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  fileSize: z.number().int().positive(),
  mimeType: z.string().trim().max(200).default(""),
});

const previewSchema = z.object({
  storagePath: z.string().regex(STORAGE_PATH_PATTERN, "Invalid import storage path."),
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().max(200).default(""),
});

const runIdSchema = z.number().int().positive();

const applySchema = z.object({
  runId: z.number().int().positive(),
  decisions: z.object({
    conflicts: z
      .record(z.string(), z.record(z.string(), z.enum(["keep_app", "use_import"])))
      .default({}),
    missing: z.record(z.string(), z.enum(["leave", "mark_on_hold"])).default({}),
  }),
});

export type ImportRunRecord = {
  id: number;
  created_by: string;
  created_at: string;
  applied_at: string | null;
  applied_by: string | null;
  file_name: string;
  file_sha256: string;
  storage_path: string | null;
  status: Database["public"]["Tables"]["import_runs"]["Row"]["status"];
  error_message: string | null;
  summary: ImportSummary | null;
  diff: ImportDiffPayload | null;
};

async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") {
    throw new Error("Only administrators can perform this action.");
  }
  return user;
}

function validateFileMetadata(fileName: string, fileSize: number, mimeType: string) {
  if (!fileName.toLowerCase().endsWith(".xlsx")) {
    throw new Error("Only .xlsx workbooks are supported.");
  }
  if (fileSize <= 0) {
    throw new Error("The selected workbook is empty.");
  }
  if (fileSize > MAX_IMPORT_BYTES) {
    throw new Error("Workbook exceeds the 10 MB maximum file size.");
  }
  const normalizedMime = mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
  if (!ALLOWED_MIME_TYPES.has(normalizedMime)) {
    throw new Error(
      `Unsupported file type (${normalizedMime}). Upload an Excel .xlsx workbook.`,
    );
  }
}

function sanitizeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "workbook.xlsx";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+/, "");
  const ensured = cleaned.toLowerCase().endsWith(".xlsx") ? cleaned : `${cleaned}.xlsx`;
  return ensured.slice(-120);
}

function toImportRunRecord(
  row: Database["public"]["Tables"]["import_runs"]["Row"],
): ImportRunRecord {
  const summary =
    row.summary && typeof row.summary === "object" && !Array.isArray(row.summary) && "rows_in" in row.summary
      ? (row.summary as unknown as ImportSummary)
      : null;
  const diff =
    row.diff && typeof row.diff === "object" && !Array.isArray(row.diff) && "deals" in row.diff
      ? (row.diff as unknown as ImportDiffPayload)
      : null;
  return {
    id: row.id,
    created_by: row.created_by,
    created_at: row.created_at,
    applied_at: row.applied_at,
    applied_by: row.applied_by,
    file_name: row.file_name,
    file_sha256: row.file_sha256,
    storage_path: row.storage_path,
    status: row.status,
    error_message: row.error_message,
    summary,
    diff,
  };
}

async function computePreviewPayload(
  supabase: Awaited<ReturnType<typeof createClient>>,
  bytes: Buffer,
  fileName: string,
  fileSha256: string,
) {
  const [verticalConfigsRes, sourceTabsRes, dealsRes, lastAppliedRes] = await Promise.all([
    supabase.from("vertical_config").select("tab_prefix, vertical"),
    supabase.from("source_tabs").select("tab_name, tab_prefix"),
    supabase.from("deals").select("*"),
    supabase
      .from("import_runs")
      .select("id, created_at, file_sha256")
      .eq("status", "applied")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  for (const res of [verticalConfigsRes, sourceTabsRes, dealsRes, lastAppliedRes]) {
    if (res.error) throw new Error(res.error.message);
  }

  const lastAppliedRun = lastAppliedRes.data ?? null;

  let historyQuery = supabase
    .from("deal_history")
    .select("*")
    .not("changed_by", "is", null)
    .is("seed_source", null)
    .order("changed_at", { ascending: false });

  if (lastAppliedRun) {
    historyQuery = historyQuery.gt("changed_at", lastAppliedRun.created_at);
  }

  const historyRes = await historyQuery;
  if (historyRes.error) throw new Error(historyRes.error.message);

  const verticalMapping: Record<string, string> = {};
  for (const row of verticalConfigsRes.data ?? []) {
    verticalMapping[row.tab_prefix] = row.vertical;
  }

  const sourceTabs: Record<string, string | null> = {};
  for (const row of sourceTabsRes.data ?? []) {
    sourceTabs[row.tab_name] = row.tab_prefix;
  }

  const normalized = await normalizeWorkbook(bytes, {
    sourceName: fileName,
    verticalMapping,
    sourceTabs,
    mappingSource: "supabase",
    strictTabRegistry: (sourceTabsRes.data?.length ?? 0) > 0,
  });

  return computeImportDiff({
    normalizedDeals: normalized.deals,
    normalizedContacts: normalized.contacts,
    report: normalized.report,
    existingDeals: dealsRes.data ?? [],
    dealHistory: historyRes.data ?? [],
    sourceTabs,
    fileSha256,
    lastAppliedRun,
  });
}

export async function createImportUploadUrl(input: z.input<typeof uploadUrlSchema>) {
  await requireAdmin();
  const parsed = uploadUrlSchema.parse(input);
  validateFileMetadata(parsed.fileName, parsed.fileSize, parsed.mimeType);

  const safeName = sanitizeFileName(parsed.fileName);
  const storagePath = `runs/${Date.now()}-${randomUUID()}/${safeName}`;
  const supabase = await createClient();

  const { data, error } = await supabase.storage
    .from("imports")
    .createSignedUploadUrl(storagePath);

  if (error || !data) {
    throw new Error(
      `Unable to initialize workbook upload: ${error?.message ?? "storage unavailable"}`,
    );
  }

  return {
    storagePath,
    token: data.token,
  };
}

export async function previewImportRun(
  input: z.input<typeof previewSchema>,
): Promise<
  | { ok: true; run: ImportRunRecord }
  | { ok: false; runId: number | null; error: string }
> {
  const admin = await requireAdmin();
  const parsed = previewSchema.parse(input);
  const supabase = await createClient();

  let bytes: Buffer;
  try {
    const { data: blob, error: downloadError } = await supabase.storage
      .from("imports")
      .download(parsed.storagePath);
    if (downloadError || !blob) {
      throw new Error(
        `Unable to read uploaded workbook from storage: ${downloadError?.message ?? "file not found"}`,
      );
    }
    bytes = Buffer.from(await blob.arrayBuffer());
  } catch (error) {
    return {
      ok: false,
      runId: null,
      error: error instanceof Error ? error.message : "Unable to download uploaded workbook.",
    };
  }

  const fileSha256 = createHash("sha256").update(bytes).digest("hex");

  try {
    validateFileMetadata(parsed.fileName, bytes.byteLength, parsed.mimeType);
    const { summary, diff } = await computePreviewPayload(
      supabase,
      bytes,
      parsed.fileName,
      fileSha256,
    );

    const { data: inserted, error: insertError } = await supabase
      .from("import_runs")
      .insert({
        created_by: admin.id,
        file_name: parsed.fileName,
        file_sha256: fileSha256,
        storage_path: parsed.storagePath,
        status: "previewed",
        summary: summary as unknown as Json,
        diff: diff as unknown as Json,
      })
      .select("*")
      .single();

    if (insertError || !inserted) {
      throw new Error(
        `Unable to save import preview: ${insertError?.message ?? "database error"}`,
      );
    }

    revalidatePath("/admin");
    return { ok: true, run: toImportRunRecord(inserted) };
  } catch (error) {
    const message =
      error instanceof ImportWorkbookError || error instanceof Error
        ? error.message
        : "Unable to parse the uploaded workbook.";

    const { data: failedRow } = await supabase
      .from("import_runs")
      .insert({
        created_by: admin.id,
        file_name: parsed.fileName,
        file_sha256: fileSha256,
        storage_path: parsed.storagePath,
        status: "failed",
        error_message: message,
        summary: { error: message },
        diff: {},
      })
      .select("id")
      .maybeSingle();

    revalidatePath("/admin");
    return {
      ok: false,
      runId: failedRow?.id ?? null,
      error: message,
    };
  }
}

export async function repreviewImportRun(runId: number): Promise<ImportRunRecord> {
  await requireAdmin();
  const id = runIdSchema.parse(runId);
  const supabase = await createClient();

  const { data: existing, error: readError } = await supabase
    .from("import_runs")
    .select("*")
    .eq("id", id)
    .single();
  if (readError || !existing) {
    throw new Error(readError?.message ?? `Import run #${id} was not found.`);
  }
  if (existing.status !== "previewed") {
    throw new Error("Only previewed import runs can be refreshed.");
  }
  if (!existing.storage_path) {
    throw new Error("This import run has no stored workbook to re-parse.");
  }

  const { data: blob, error: downloadError } = await supabase.storage
    .from("imports")
    .download(existing.storage_path);
  if (downloadError || !blob) {
    throw new Error(
      `Unable to load stored workbook: ${downloadError?.message ?? "file not found"}`,
    );
  }
  const bytes = Buffer.from(await blob.arrayBuffer());
  const { summary, diff } = await computePreviewPayload(
    supabase,
    bytes,
    existing.file_name,
    existing.file_sha256,
  );

  const { data: updated, error: updateError } = await supabase
    .from("import_runs")
    .update({
      summary: summary as unknown as Json,
      diff: diff as unknown as Json,
      error_message: null,
    })
    .eq("id", id)
    .eq("status", "previewed")
    .select("*")
    .single();

  if (updateError || !updated) {
    throw new Error(updateError?.message ?? "Unable to update import preview.");
  }

  revalidatePath("/admin");
  return toImportRunRecord(updated);
}

export async function applyImportRun(input: z.input<typeof applySchema>) {
  await requireAdmin();
  const parsed = applySchema.parse(input);
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("apply_import", {
    run_id: parsed.runId,
    decisions: parsed.decisions as unknown as Json,
  });

  if (error) {
    throw new Error(`Import could not be applied: ${error.message}`);
  }

  try {
    await geocodeMissingDeals();
  } catch (geoError) {
    console.error("Post-import geocoding failed (import already applied).", geoError);
  }

  for (const path of ["/admin", "/deals", "/weekly", "/rollup"]) {
    revalidatePath(path);
  }

  return data as {
    run_id: number;
    inserted: number;
    updated: number;
    marked_on_hold: number;
    skipped_conflicts: number;
    contacts_upserted: number;
  };
}

export async function discardImportRun(runId: number) {
  await requireAdmin();
  const id = runIdSchema.parse(runId);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("import_runs")
    .update({ status: "discarded" })
    .eq("id", id)
    .eq("status", "previewed")
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`Unable to discard import run: ${error.message}`);
  if (!data) throw new Error(`Previewed import run #${id} was not found.`);

  revalidatePath("/admin");
  return { ok: true };
}

export async function getImportRun(runId: number): Promise<ImportRunRecord> {
  await requireAdmin();
  const id = runIdSchema.parse(runId);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("import_runs")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? `Import run #${id} was not found.`);
  }
  return toImportRunRecord(data);
}
