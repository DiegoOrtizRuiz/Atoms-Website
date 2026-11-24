import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import type { ImportDiffPayload, ImportSummary } from "@/lib/import/diff";
import { createClient } from "@/lib/supabase/server";
import { AdminWorkspace } from "./admin-workspace";
import type { ImportRunRecord } from "./import-actions";
import type { ImportRunListItem } from "./import-panel";

export const metadata: Metadata = { title: "Admin" };

function parsePositiveInt(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    run?: string;
    refresh?: string;
    registerTab?: string;
    returnRun?: string;
  }>;
}) {
  const user = await requireUser();
  if (user.role !== "admin") notFound();

  const params = await searchParams;
  const requestedRunId = parsePositiveInt(params.run);
  const returnRunId = parsePositiveInt(params.returnRun);
  const autoRefreshRunId =
    params.refresh === "1" && requestedRunId ? requestedRunId : undefined;

  const supabase = await createClient();
  const [
    profiles,
    usage,
    verticalConfigs,
    sourceTabs,
    clients,
    deals,
    demographicsFailures,
    attributeDeals,
    loginCounts,
    imports,
    importRunsRes,
    activeRunRes,
  ] = await Promise.all([
    supabase.from("profiles").select("*").order("full_name"),
    supabase.from("v_user_usage").select("*"),
    supabase.from("vertical_config").select("*").order("sort_order"),
    supabase.from("source_tabs").select("*").order("tab_name"),
    supabase.from("deals").select("client").not("client", "is", null),
    supabase
      .from("deals")
      .select("id, stage, needs_review, review_reasons, stage_raw, field_provenance, address, weekly_note, notes_extracted, geocode_status, lat, lng, census_tract_geoid"),
    supabase.from("tract_demographics").select("geoid", { count: "exact", head: true }).not("last_error", "is", null),
    supabase.from("deals").select("vertical, attributes"),
    supabase.rpc("admin_logins_per_day", { days: 30 }),
    supabase
      .from("deal_history")
      .select("changed_at")
      .is("changed_by", null)
      .order("changed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("import_runs")
      .select("id, created_by, created_at, applied_at, file_name, file_sha256, status, error_message, summary")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(50),
    requestedRunId
      ? supabase.from("import_runs").select("*").eq("id", requestedRunId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  for (const result of [
    profiles,
    usage,
    verticalConfigs,
    sourceTabs,
    clients,
    deals,
    demographicsFailures,
    attributeDeals,
    loginCounts,
    importRunsRes,
  ]) {
    if (result.error) throw new Error(result.error.message);
  }
  if (imports.error) throw new Error(imports.error.message);
  if (activeRunRes.error) throw new Error(activeRunRes.error.message);
  if (demographicsFailures.count === null) throw new Error("Unable to count failed demographics tracts.");

  const importRuns: ImportRunListItem[] = (importRunsRes.data ?? []).map((row) => ({
    id: row.id,
    created_by: row.created_by,
    created_at: row.created_at,
    applied_at: row.applied_at,
    file_name: row.file_name,
    file_sha256: row.file_sha256,
    status: row.status,
    error_message: row.error_message,
    summary:
      row.summary && typeof row.summary === "object" && !Array.isArray(row.summary) && "rows_in" in row.summary
        ? (row.summary as unknown as ImportSummary)
        : null,
  }));

  const initialActiveRun: ImportRunRecord | null = activeRunRes.data
    ? {
        id: activeRunRes.data.id,
        created_by: activeRunRes.data.created_by,
        created_at: activeRunRes.data.created_at,
        applied_at: activeRunRes.data.applied_at,
        applied_by: activeRunRes.data.applied_by,
        file_name: activeRunRes.data.file_name,
        file_sha256: activeRunRes.data.file_sha256,
        storage_path: activeRunRes.data.storage_path,
        status: activeRunRes.data.status,
        error_message: activeRunRes.data.error_message,
        summary:
          activeRunRes.data.summary &&
          typeof activeRunRes.data.summary === "object" &&
          !Array.isArray(activeRunRes.data.summary) &&
          "rows_in" in activeRunRes.data.summary
            ? (activeRunRes.data.summary as unknown as ImportSummary)
            : null,
        diff:
          activeRunRes.data.diff &&
          typeof activeRunRes.data.diff === "object" &&
          !Array.isArray(activeRunRes.data.diff) &&
          "deals" in activeRunRes.data.diff
            ? (activeRunRes.data.diff as unknown as ImportDiffPayload)
            : null,
      }
    : null;

  const latestAppliedImport = importRuns.find((run) => run.status === "applied");
  const lastImportAt =
    latestAppliedImport?.applied_at ??
    latestAppliedImport?.created_at ??
    imports.data?.changed_at ??
    null;

  const attributeValueCounts: Record<string, Record<string, number>> = {};
  const prefixByVertical = new Map(
    (verticalConfigs.data ?? []).map((config) => [config.vertical, config.tab_prefix]),
  );
  for (const deal of attributeDeals.data ?? []) {
    if (!deal.vertical || !deal.attributes || typeof deal.attributes !== "object" || Array.isArray(deal.attributes)) {
      continue;
    }
    const prefix = prefixByVertical.get(deal.vertical);
    if (!prefix) continue;
    const counts = (attributeValueCounts[prefix] ??= {});
    for (const [key, value] of Object.entries(deal.attributes)) {
      if (value !== null && value !== undefined && value !== "") {
        counts[key] = (counts[key] ?? 0) + 1;
      }
    }
  }

  const { error: activityError } = await supabase.from("activity_log").insert({
    user_id: user.id,
    event: "page_view",
    path: "/admin",
    detail: { source: "server" },
  });
  if (activityError) {
    console.error("Unable to record the Administration page view.", activityError);
  }

  return (
    <>
      <PageHeader
        title="Administration"
        description="Manage access, review activity, and monitor pipeline health."
        helpSection="admin"
      />
      <AdminWorkspace
        attributeValueCounts={attributeValueCounts}
        autoRefreshRunId={autoRefreshRunId}
        clients={[
          ...new Set(
            (clients.data ?? [])
              .map((deal) => deal.client)
              .filter((client): client is string => Boolean(client)),
          ),
        ].sort()}
        deals={deals.data ?? []}
        failedTracts={demographicsFailures.count}
        importRuns={importRuns}
        initialActiveRun={initialActiveRun}
        initialTab={params.tab}
        lastImportAt={lastImportAt}
        loginCounts={loginCounts.data ?? []}
        profiles={profiles.data ?? []}
        registerTab={params.registerTab}
        returnRunId={returnRunId}
        sourceTabs={sourceTabs.data ?? []}
        user={user}
        verticalConfigs={verticalConfigs.data ?? []}
        verticals={(verticalConfigs.data ?? []).map((item) => item.vertical)}
        usage={usage.data ?? []}
      />
    </>
  );
}
