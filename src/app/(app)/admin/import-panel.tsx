"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  RefreshCw,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Database, Json } from "@/lib/database.types";
import { fmtDate, fmtMoney, fmtNumber, fmtOrDash } from "@/lib/format";
import type {
  ConflictChoice,
  DealDiffItem,
  DealDiffKind,
  ImportSummary,
  MissingChoice,
} from "@/lib/import/diff";
import { createClient } from "@/lib/supabase/client";
import {
  applyImportRun,
  createImportUploadUrl,
  discardImportRun,
  getImportRun,
  previewImportRun,
  repreviewImportRun,
  type ImportRunRecord,
} from "./import-actions";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type RunStatus = Database["public"]["Tables"]["import_runs"]["Row"]["status"];

export type ImportRunListItem = {
  id: number;
  created_by: string;
  created_at: string;
  applied_at: string | null;
  file_name: string;
  file_sha256: string;
  status: RunStatus;
  error_message: string | null;
  summary: ImportSummary | null;
};

type DiffFilter = "all" | "conflicts" | DealDiffKind;

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

function formatCellValue(value: Json | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.join("; ") : "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatFieldLabel(field: string): string {
  if (field.startsWith("attributes.")) {
    return `attr: ${field.slice("attributes.".length).replaceAll("_", " ")}`;
  }
  return field.replaceAll("_", " ");
}

function statusBadgeVariant(status: RunStatus): "default" | "secondary" | "outline" | "destructive" {
  if (status === "applied") return "default";
  if (status === "failed") return "destructive";
  if (status === "previewed") return "secondary";
  return "outline";
}

function buildDefaultDecisions(run: ImportRunRecord | null) {
  const conflicts: Record<string, Record<string, ConflictChoice>> = {};
  const missing: Record<string, MissingChoice> = {};
  if (!run?.diff) return { conflicts, missing };

  for (const deal of run.diff.deals) {
    if (deal.kind === "changed") {
      for (const change of deal.changes) {
        if (change.conflict) {
          conflicts[deal.id] ??= {};
          conflicts[deal.id][change.field] = change.default_choice;
        }
      }
    } else if (deal.kind === "missing") {
      missing[deal.id] = "leave";
    }
  }
  return { conflicts, missing };
}

function defaultFilterForRun(run: ImportRunRecord | null): DiffFilter {
  const counts = run?.summary?.counts;
  if (!counts) return "all";
  if (counts.conflicts > 0) return "conflicts";
  if (counts.new > 0 || counts.changed > 0 || counts.missing > 0) return "all";
  return "unchanged";
}

export function ImportPanel({
  autoRefreshRunId,
  initialActiveRun,
  initialRuns,
  profiles,
}: {
  autoRefreshRunId?: number;
  initialActiveRun: ImportRunRecord | null;
  initialRuns: ImportRunListItem[];
  profiles: Profile[];
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const autoRefreshedRef = useRef<number | null>(null);

  const [activeRun, setActiveRun] = useState<ImportRunRecord | null>(initialActiveRun);
  const [filter, setFilter] = useState<DiffFilter>(() =>
    defaultFilterForRun(initialActiveRun),
  );
  const [conflictChoices, setConflictChoices] = useState<
    Record<string, Record<string, ConflictChoice>>
  >(() => buildDefaultDecisions(initialActiveRun).conflicts);
  const [missingChoices, setMissingChoices] = useState<
    Record<string, MissingChoice>
  >(() => buildDefaultDecisions(initialActiveRun).missing);
  const [uploading, setUploading] = useState(false);
  const [uploadStep, setUploadStep] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [loadingRunId, setLoadingRunId] = useState<number | null>(null);

  const profileById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles],
  );

  function selectRun(run: ImportRunRecord) {
    setActiveRun(run);
    const defaults = buildDefaultDecisions(run);
    setConflictChoices(defaults.conflicts);
    setMissingChoices(defaults.missing);
    setFilter(defaultFilterForRun(run));
    setUploadError(null);
  }

  useEffect(() => {
    if (!autoRefreshRunId || autoRefreshedRef.current === autoRefreshRunId) return;
    autoRefreshedRef.current = autoRefreshRunId;
    setRefreshing(true);
    void repreviewImportRun(autoRefreshRunId)
      .then((refreshed) => {
        selectRun(refreshed);
        toast.success(`Refreshed preview for run #${refreshed.id}`);
        router.replace(`/admin?tab=import&run=${refreshed.id}`, { scroll: false });
        router.refresh();
      })
      .catch((error: unknown) => {
        toast.error(
          error instanceof Error ? error.message : "Unable to refresh import preview.",
        );
      })
      .finally(() => setRefreshing(false));
  }, [autoRefreshRunId, router]);

  async function handleFileSelected(file: File | null) {
    if (!file) return;
    setUploadError(null);

    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setUploadError("Only .xlsx workbooks are supported.");
      return;
    }
    if (file.size <= 0) {
      setUploadError("The selected file is empty.");
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      setUploadError("Workbook exceeds the 10 MB maximum file size.");
      return;
    }

    setUploading(true);
    try {
      setUploadStep("Uploading workbook to private storage…");
      const { storagePath, token } = await createImportUploadUrl({
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
      });

      const supabase = createClient();
      const { error: storageError } = await supabase.storage
        .from("imports")
        .uploadToSignedUrl(storagePath, token, file, {
          contentType:
            file.type ||
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });

      if (storageError) {
        throw new Error(`Upload to storage failed: ${storageError.message}`);
      }

      setUploadStep("Parsing workbook and computing dry-run diff…");
      const result = await previewImportRun({
        storagePath,
        fileName: file.name,
        mimeType: file.type,
      });

      if (!result.ok) {
        setUploadError(result.error);
        toast.error(result.error);
        router.refresh();
        return;
      }

      selectRun(result.run);
      toast.success(`Dry-run preview ready (run #${result.run.id})`);
      router.replace(`/admin?tab=import&run=${result.run.id}`, { scroll: false });
      router.refresh();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Workbook upload failed.";
      setUploadError(message);
      toast.error(message);
    } finally {
      setUploading(false);
      setUploadStep("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleRefreshPreview() {
    if (!activeRun || activeRun.status !== "previewed") return;
    setRefreshing(true);
    try {
      const refreshed = await repreviewImportRun(activeRun.id);
      selectRun(refreshed);
      toast.success("Preview refreshed with current configuration and deals");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to refresh preview.",
      );
    } finally {
      setRefreshing(false);
    }
  }

  async function handleApply() {
    if (!activeRun || activeRun.status !== "previewed") return;
    setApplying(true);
    try {
      const applied = await applyImportRun({
        runId: activeRun.id,
        decisions: {
          conflicts: conflictChoices,
          missing: missingChoices,
        },
      });
      toast.success(
        `Applied import #${applied.run_id}: ${applied.inserted} inserted, ${applied.updated} updated, ${applied.marked_on_hold} marked On Hold.`,
      );
      const updated = await getImportRun(activeRun.id);
      selectRun(updated);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to apply import.",
      );
    } finally {
      setApplying(false);
    }
  }

  async function handleDiscard() {
    if (!activeRun || activeRun.status !== "previewed") return;
    setDiscarding(true);
    try {
      await discardImportRun(activeRun.id);
      toast.success(`Discarded preview #${activeRun.id}`);
      const updated = await getImportRun(activeRun.id);
      selectRun(updated);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to discard run.",
      );
    } finally {
      setDiscarding(false);
    }
  }

  async function handleInspectRun(runId: number) {
    setLoadingRunId(runId);
    try {
      const run = await getImportRun(runId);
      selectRun(run);
      router.replace(`/admin?tab=import&run=${run.id}`, { scroll: false });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to load import run.",
      );
    } finally {
      setLoadingRunId(null);
    }
  }

  const effectivePlan = useMemo(() => {
    if (!activeRun?.diff) {
      return { newDeals: 0, updatedDeals: 0, markedOnHold: 0, keptConflicts: 0, totalWrites: 0 };
    }
    let newDeals = 0;
    let updatedDeals = 0;
    let markedOnHold = 0;
    let keptConflicts = 0;

    for (const deal of activeRun.diff.deals) {
      if (deal.kind === "new") {
        newDeals += 1;
      } else if (deal.kind === "changed") {
        let willWriteDeal = false;
        for (const change of deal.changes) {
          if (change.conflict) {
            const choice = conflictChoices[deal.id]?.[change.field] ?? "keep_app";
            if (choice === "use_import") {
              willWriteDeal = true;
            } else {
              keptConflicts += 1;
            }
          } else {
            willWriteDeal = true;
          }
        }
        if (willWriteDeal) updatedDeals += 1;
      } else if (deal.kind === "missing") {
        if ((missingChoices[deal.id] ?? "leave") === "mark_on_hold") {
          markedOnHold += 1;
        }
      }
    }

    return {
      newDeals,
      updatedDeals,
      markedOnHold,
      keptConflicts,
      totalWrites: newDeals + updatedDeals + markedOnHold,
    };
  }, [activeRun, conflictChoices, missingChoices]);

  const filteredDeals: DealDiffItem[] = useMemo(() => {
    if (!activeRun?.diff) return [];
    const deals = activeRun.diff.deals;
    if (filter === "all") return deals;
    if (filter === "conflicts") {
      return deals.filter((deal) => deal.changes.some((change) => change.conflict));
    }
    return deals.filter((deal) => deal.kind === filter);
  }, [activeRun, filter]);

  const summary = activeRun?.summary ?? null;
  const isPreviewed = activeRun?.status === "previewed";

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="size-5" />
            Upload workbook (.xlsx)
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Upload an Excel workbook (max 10 MB). The server parses the file, stores a copy in private storage, and generates a dry-run diff before any database changes occur.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed p-4">
            <input
              ref={fileInputRef}
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              aria-label="Upload Excel workbook"
              className="text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-muted"
              disabled={uploading}
              onChange={(event) => void handleFileSelected(event.target.files?.[0] ?? null)}
              type="file"
            />
            {uploading && (
              <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Upload className="size-4 animate-pulse" />
                {uploadStep || "Processing…"}
              </span>
            )}
          </div>
          {uploadError && (
            <div
              className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
              role="alert"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{uploadError}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {activeRun && (
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>
                  Run #{activeRun.id} · {activeRun.file_name}
                </CardTitle>
                <Badge variant={statusBadgeVariant(activeRun.status)}>
                  {activeRun.status}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Uploaded {fmtDate(activeRun.created_at, "PPpp")} by{" "}
                {profileById.get(activeRun.created_by)?.full_name ?? "Admin"} · SHA-256{" "}
                <span className="font-mono">{activeRun.file_sha256.slice(0, 12)}</span>
              </p>
            </div>
            {isPreviewed && (
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={refreshing || applying || discarding}
                  onClick={() => void handleRefreshPreview()}
                  size="sm"
                  variant="outline"
                >
                  <RefreshCw className={`mr-1.5 size-3.5 ${refreshing ? "animate-spin" : ""}`} />
                  {refreshing ? "Refreshing…" : "Refresh preview"}
                </Button>
                <Button
                  disabled={refreshing || applying || discarding}
                  onClick={() => void handleDiscard()}
                  size="sm"
                  variant="outline"
                >
                  {discarding ? "Discarding…" : "Discard"}
                </Button>
                <Button
                  disabled={
                    refreshing ||
                    applying ||
                    discarding ||
                    effectivePlan.totalWrites === 0
                  }
                  onClick={() => void handleApply()}
                  size="sm"
                >
                  {applying
                    ? "Applying…"
                    : `Apply (${effectivePlan.newDeals} new, ${effectivePlan.updatedDeals} updated${
                        effectivePlan.markedOnHold
                          ? `, ${effectivePlan.markedOnHold} on hold`
                          : ""
                      })`}
                </Button>
              </div>
            )}
          </CardHeader>

          <CardContent className="space-y-5">
            {activeRun.status === "failed" && (
              <div
                className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
                role="alert"
              >
                <p className="font-semibold">Import failed</p>
                <p className="mt-1">{activeRun.error_message || "Malformed workbook."}</p>
              </div>
            )}

            {summary && (
              <>
                {!summary.has_changes && (
                  <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                    <div>
                      <p className="font-semibold">No changes</p>
                      <p>
                        {summary.identical_to_last_applied && summary.last_applied_run_id
                          ? `This workbook is identical to already-applied run #${summary.last_applied_run_id} and matches the current database.`
                          : "All parsed deals match the current database state."}
                      </p>
                    </div>
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  {[
                    ["Tabs found", summary.tabs_found],
                    ["Rows in", summary.rows_in],
                    ["Deals out", summary.deals_out],
                    ["Flagged", summary.flagged],
                    ["Assumed cells", summary.assumed_cells],
                  ].map(([label, value]) => (
                    <div className="rounded-lg border p-3" key={String(label)}>
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="mt-1 text-xl font-semibold">{fmtNumber(Number(value))}</p>
                    </div>
                  ))}
                </div>

                {summary.unconfigured_tabs.length > 0 && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
                    <p className="font-semibold">
                      Unconfigured tabs ({summary.unconfigured_tabs.length})
                    </p>
                    <p className="mt-1 text-xs text-amber-900">
                      Assign each new tab to a vertical in Verticals &amp; tabs, then refresh this preview before applying so deals appear under the right vertical.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {summary.unconfigured_tabs.map((tabName) => (
                        <Link
                          className="inline-flex items-center gap-1.5 rounded-md border border-amber-400 bg-white px-2.5 py-1 text-xs font-medium text-amber-950 hover:bg-amber-100"
                          href={`/admin?tab=verticals&registerTab=${encodeURIComponent(tabName)}&returnRun=${activeRun.id}`}
                          key={tabName}
                        >
                          <span className="font-mono">{tabName}</span>
                          <span>→ Assign in Verticals &amp; tabs</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {(summary.unknown_statuses.length > 0 ||
                  summary.unknown_columns.length > 0 ||
                  summary.formula_warnings.length > 0) && (
                  <div className="grid gap-3 md:grid-cols-3">
                    {summary.unknown_statuses.length > 0 && (
                      <div className="rounded-md border p-3 text-sm">
                        <p className="font-medium">Unknown statuses</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {summary.unknown_statuses.map((status) => (
                            <Badge key={status} variant="outline">
                              {status}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {summary.unknown_columns.length > 0 && (
                      <div className="rounded-md border p-3 text-sm">
                        <p className="font-medium">Unknown columns (kept in attributes)</p>
                        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                          {summary.unknown_columns.map((entry) => (
                            <li key={entry.tab}>
                              <span className="font-mono text-foreground">{entry.tab}</span>:{" "}
                              {entry.columns.join(", ")}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {summary.formula_warnings.length > 0 && (
                      <div className="rounded-md border border-amber-200 bg-amber-50/50 p-3 text-sm">
                        <p className="font-medium text-amber-950">
                          Uncached / error formulas ({summary.formula_warnings.length})
                        </p>
                        <ul className="mt-2 space-y-1 text-xs text-amber-900">
                          {summary.formula_warnings.map((warning) => (
                            <li key={`${warning.tab}:${warning.row}:${warning.field}`}>
                              {warning.tab}:{warning.row} — {warning.message}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {activeRun.diff && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-1.5">
                        {(
                          [
                            ["all", `All (${activeRun.diff.deals.length})`],
                            ["conflicts", `Conflicts (${summary.counts.conflict_deals})`],
                            ["new", `New (${summary.counts.new})`],
                            ["changed", `Changed (${summary.counts.changed})`],
                            ["missing", `Missing from file (${summary.counts.missing})`],
                            ["unchanged", `Unchanged (${summary.counts.unchanged})`],
                          ] as [DiffFilter, string][]
                        ).map(([key, label]) => (
                          <Button
                            key={key}
                            onClick={() => setFilter(key)}
                            size="sm"
                            variant={filter === key ? "default" : "outline"}
                          >
                            {label}
                          </Button>
                        ))}
                      </div>

                      {isPreviewed && summary.counts.missing > 0 && (
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-muted-foreground">Missing deals:</span>
                          <Button
                            onClick={() => {
                              const next: Record<string, MissingChoice> = {};
                              for (const deal of activeRun.diff?.deals ?? []) {
                                if (deal.kind === "missing") next[deal.id] = "leave";
                              }
                              setMissingChoices(next);
                            }}
                            size="sm"
                            variant="outline"
                          >
                            Leave all as is
                          </Button>
                          <Button
                            onClick={() => {
                              const next: Record<string, MissingChoice> = {};
                              for (const deal of activeRun.diff?.deals ?? []) {
                                if (deal.kind === "missing") next[deal.id] = "mark_on_hold";
                              }
                              setMissingChoices(next);
                            }}
                            size="sm"
                            variant="outline"
                          >
                            Mark all On Hold
                          </Button>
                        </div>
                      )}
                    </div>

                    <div className="space-y-3">
                      {filteredDeals.map((deal) => {
                        const hasConflicts = deal.changes.some((c) => c.conflict);
                        return (
                          <div
                            className={`rounded-lg border p-3 ${
                              hasConflicts
                                ? "border-amber-300 bg-amber-50/40"
                                : deal.kind === "missing"
                                  ? "border-slate-300 bg-slate-50/60"
                                  : ""
                            }`}
                            key={deal.id}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2 text-sm">
                                <Badge
                                  variant={
                                    deal.kind === "new"
                                      ? "default"
                                      : deal.kind === "changed"
                                        ? "secondary"
                                        : "outline"
                                  }
                                >
                                  {deal.kind === "missing" ? "Missing from file" : deal.kind}
                                </Badge>
                                <span className="font-mono text-xs font-semibold">{deal.id}</span>
                                <span className="font-medium">{fmtOrDash(deal.address)}</span>
                                <span className="text-xs text-muted-foreground">
                                  {fmtOrDash(deal.vertical)} · {fmtOrDash(deal.client)} ·{" "}
                                  {fmtOrDash(deal.market)} · {deal.stage}
                                </span>
                                {deal.needs_review && (
                                  <Badge className="bg-amber-100 text-amber-900" variant="outline">
                                    Needs review
                                  </Badge>
                                )}
                                {hasConflicts && (
                                  <Badge className="bg-amber-200 text-amber-950" variant="outline">
                                    Conflict
                                  </Badge>
                                )}
                              </div>

                              {deal.kind === "missing" && (
                                <div className="flex items-center gap-2 text-xs">
                                  <span className="text-muted-foreground">Never deleted:</span>
                                  <select
                                    aria-label={`Action for missing deal ${deal.id}`}
                                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                                    disabled={!isPreviewed}
                                    onChange={(event) =>
                                      setMissingChoices((prev) => ({
                                        ...prev,
                                        [deal.id]: event.target.value as MissingChoice,
                                      }))
                                    }
                                    value={missingChoices[deal.id] ?? "leave"}
                                  >
                                    <option value="leave">Leave as is</option>
                                    <option value="mark_on_hold">Mark On Hold</option>
                                  </select>
                                </div>
                              )}
                            </div>

                            {deal.kind === "new" && deal.incoming && (
                              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                <span>Stage: {deal.incoming.stage} (raw: {fmtOrDash(deal.incoming.stage_raw)})</span>
                                <span>Bldg SF: {fmtNumber(deal.incoming.bldg_sf)}</span>
                                <span>List price: {fmtMoney(deal.incoming.list_price)}</span>
                                {deal.review_reasons.length > 0 && (
                                  <span className="text-amber-800">
                                    Flags: {deal.review_reasons.join("; ")}
                                  </span>
                                )}
                              </div>
                            )}

                            {deal.kind === "changed" && deal.changes.length > 0 && (
                              <div className="mt-3 overflow-x-auto">
                                <table className="w-full min-w-[600px] text-left text-xs">
                                  <thead>
                                    <tr className="border-b text-muted-foreground">
                                      <th className="p-1.5 font-medium">Field</th>
                                      <th className="p-1.5 font-medium">Current (app)</th>
                                      <th className="p-1.5 font-medium">Incoming (file)</th>
                                      <th className="p-1.5 font-medium">Resolution</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {deal.changes.map((change) => {
                                      const choice = change.conflict
                                        ? (conflictChoices[deal.id]?.[change.field] ?? "keep_app")
                                        : "use_import";
                                      return (
                                        <tr
                                          className="border-b last:border-0"
                                          key={change.field}
                                        >
                                          <td className="p-1.5 font-medium">
                                            {formatFieldLabel(change.field)}
                                            {change.conflict && (
                                              <span className="ml-1.5 inline-block rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold text-amber-950">
                                                {change.conflict_reason === "confirmed_in_app"
                                                  ? "Confirmed in app"
                                                  : "Edited in app"}
                                              </span>
                                            )}
                                          </td>
                                          <td className="max-w-xs break-words p-1.5 text-muted-foreground">
                                            {formatCellValue(change.old_value)}
                                          </td>
                                          <td className="max-w-xs break-words p-1.5 font-medium">
                                            {formatCellValue(change.new_value)}
                                          </td>
                                          <td className="p-1.5">
                                            {change.conflict ? (
                                              <div className="flex flex-wrap gap-1">
                                                <Button
                                                  disabled={!isPreviewed}
                                                  onClick={() =>
                                                    setConflictChoices((prev) => ({
                                                      ...prev,
                                                      [deal.id]: {
                                                        ...(prev[deal.id] ?? {}),
                                                        [change.field]: "keep_app",
                                                      },
                                                    }))
                                                  }
                                                  size="sm"
                                                  variant={
                                                    choice === "keep_app"
                                                      ? "default"
                                                      : "outline"
                                                  }
                                                >
                                                  Keep app value
                                                </Button>
                                                <Button
                                                  disabled={!isPreviewed}
                                                  onClick={() =>
                                                    setConflictChoices((prev) => ({
                                                      ...prev,
                                                      [deal.id]: {
                                                        ...(prev[deal.id] ?? {}),
                                                        [change.field]: "use_import",
                                                      },
                                                    }))
                                                  }
                                                  size="sm"
                                                  variant={
                                                    choice === "use_import"
                                                      ? "default"
                                                      : "outline"
                                                  }
                                                >
                                                  Use file value
                                                </Button>
                                              </div>
                                            ) : (
                                              <span className="text-muted-foreground">
                                                Apply from file
                                              </span>
                                            )}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {filteredDeals.length === 0 && (
                        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                          No deals match this filter.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {isPreviewed && effectivePlan.keptConflicts > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {effectivePlan.keptConflicts} conflicting field(s) will keep their current app value.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Import history</CardTitle>
          <p className="text-sm text-muted-foreground">
            Every workbook upload is archived in private storage with its reconciliation summary and diff.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead>
              <tr className="border-b">
                {["Run", "When", "Who", "File", "Status", "Summary", ""].map((heading) => (
                  <th className="p-2 font-medium" key={heading}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {initialRuns.map((run) => {
                const counts = run.summary?.counts;
                const summaryText =
                  run.status === "failed"
                    ? run.error_message || "Failed"
                    : run.summary
                      ? `${run.summary.rows_in} rows · ${counts?.new ?? 0} new · ${counts?.changed ?? 0} changed · ${counts?.unchanged ?? 0} unchanged${
                          counts?.conflicts ? ` · ${counts.conflicts} conflicts` : ""
                        }`
                      : "—";

                return (
                  <tr className="border-b last:border-0" key={run.id}>
                    <td className="p-2 font-mono text-xs">#{run.id}</td>
                    <td className="p-2">{fmtDate(run.created_at, "PPpp")}</td>
                    <td className="p-2">
                      {profileById.get(run.created_by)?.full_name ?? "Admin"}
                    </td>
                    <td className="p-2 font-medium">{run.file_name}</td>
                    <td className="p-2">
                      <Badge variant={statusBadgeVariant(run.status)}>{run.status}</Badge>
                    </td>
                    <td className="max-w-sm truncate p-2 text-xs text-muted-foreground">
                      {summaryText}
                    </td>
                    <td className="p-2 text-right">
                      <Button
                        disabled={loadingRunId === run.id}
                        onClick={() => void handleInspectRun(run.id)}
                        size="sm"
                        variant="outline"
                      >
                        {loadingRunId === run.id
                          ? "Loading…"
                          : run.status === "previewed"
                            ? "Open preview"
                            : "View diff"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {initialRuns.length === 0 && (
                <tr>
                  <td className="p-4 text-muted-foreground" colSpan={7}>
                    No workbook imports yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
