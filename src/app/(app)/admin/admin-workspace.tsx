"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CurrentUser } from "@/lib/auth";
import { hasPendingAiSuggestions, pendingAiSections } from "@/lib/ai-suggestions";
import type { Database, Json } from "@/lib/database.types";
import { fmtDate, fmtNumber, fmtOrDash } from "@/lib/format";
import { usePresenceMembers } from "@/lib/presence";
import { geocodeMissingAdminDeals, retryFailedDemographics } from "./actions";
import { ActivityPanel } from "./activity-panel";
import type { ImportRunRecord } from "./import-actions";
import { ImportPanel, type ImportRunListItem } from "./import-panel";
import { VerticalConfigPanel } from "./vertical-config-panel";
import { UsersPanel } from "./users-panel";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Usage = Database["public"]["Views"]["v_user_usage"]["Row"];
type VerticalConfig = Database["public"]["Tables"]["vertical_config"]["Row"];
type SourceTab = Database["public"]["Tables"]["source_tabs"]["Row"];
type LoginDay = Database["public"]["Functions"]["admin_logins_per_day"]["Returns"][number];
type HealthDeal = Pick<
  Database["public"]["Tables"]["deals"]["Row"],
  | "id"
  | "stage"
  | "needs_review"
  | "review_reasons"
  | "stage_raw"
  | "field_provenance"
  | "address"
  | "weekly_note"
  | "notes_extracted"
  | "geocode_status"
  | "lat"
  | "lng"
  | "census_tract_geoid"
>;
type AdminTab = "overview" | "users" | "activity" | "health" | "verticals" | "import";

const adminTabs: AdminTab[] = ["overview", "users", "activity", "health", "verticals", "import"];
function isTab(value?: string): value is AdminTab {
  return Boolean(value && adminTabs.includes(value as AdminTab));
}

function record(value: Json | null) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-2 text-2xl font-semibold">{fmtNumber(value)}</p>
      </CardContent>
    </Card>
  );
}

function Overview({
  usage,
  loginCounts,
  needsReviewCount,
}: {
  usage: Usage[];
  loginCounts: LoginDay[];
  needsReviewCount: number;
}) {
  const online = usePresenceMembers();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekStart = now.getTime() - 7 * 86400000;
  const activeToday = usage.filter(
    (item) => item.last_active && new Date(item.last_active).getTime() >= todayStart,
  ).length;
  const activeWeek = usage.filter(
    (item) => item.last_active && new Date(item.last_active).getTime() >= weekStart,
  ).length;
  const loginsWeek = usage.reduce((sum, item) => sum + (item.logins_7d ?? 0), 0);
  const editsWeek = usage.reduce((sum, item) => sum + (item.edits_7d ?? 0), 0);
  const maxLogins = Math.max(1, ...loginCounts.map((entry) => entry.login_count));

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard label="Online now" value={online.length} />
        <StatCard label="Active users today" value={activeToday} />
        <StatCard label="Active users 7d" value={activeWeek} />
        <StatCard label="Logins 7d" value={loginsWeek} />
        <StatCard label="Edits 7d" value={editsWeek} />
        <StatCard label="Deals needing review" value={needsReviewCount} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_2fr]">
        <Card>
          <CardHeader><CardTitle>Online now</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {online.length ? online.map((member) => (
              <div className="flex items-center justify-between gap-3" key={member.user_id}>
                <div className="min-w-0">
                  <p className="truncate font-medium">{member.full_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {fmtOrDash(member.page)} · since {fmtDate(member.since, "h:mm a")}
                  </p>
                </div>
                <Badge variant="outline" className="capitalize">{member.role.replaceAll("_", " ")}</Badge>
              </div>
            )) : <p className="text-sm text-muted-foreground">Connecting to presence…</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Logins per day · last 30 days</CardTitle></CardHeader>
          <CardContent>
            <div className="flex h-44 items-end gap-1 border-b border-l px-2">
              {loginCounts.map((entry) => (
                <div
                  aria-label={`${fmtDate(entry.day)}: ${entry.login_count} logins`}
                  className="min-w-1 flex-1 rounded-t bg-cyan-600"
                  key={entry.day}
                  style={{ height: `${Math.max(2, (entry.login_count / maxLogins) * 100)}%` }}
                  title={`${fmtDate(entry.day)}: ${entry.login_count}`}
                />
              ))}
            </div>
            <div className="mt-2 flex justify-between text-xs text-muted-foreground">
              <span>{fmtDate(loginCounts[0]?.day)}</span>
              <span>{fmtDate(loginCounts.at(-1)?.day)}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DataHealth({
  deals,
  failedTracts,
  lastImportAt,
}: {
  deals: HealthDeal[];
  failedTracts: number;
  lastImportAt: string | null;
}) {
  const router = useRouter();
  const [geocoding, setGeocoding] = useState(false);
  const [retryingDemographics, setRetryingDemographics] = useState(false);

  const stages = new Map<string, number>();
  const rawStages = new Map<string, number>();
  let assumed = 0;
  for (const deal of deals) {
    stages.set(deal.stage, (stages.get(deal.stage) ?? 0) + 1);
    if (deal.stage === "Needs review" && deal.stage_raw) {
      rawStages.set(deal.stage_raw, (rawStages.get(deal.stage_raw) ?? 0) + 1);
    }
    for (const value of Object.values(record(deal.field_provenance))) {
      if (value === "assumed") assumed++;
    }
  }
  const missingAddress = deals.filter((deal) => !deal.address?.trim());
  const needsReview = deals.filter((deal) => deal.needs_review);
  const aiAwaitingReview = deals.filter((deal) => hasPendingAiSuggestions(deal));
  const geocodedOk = deals.filter((deal) => deal.geocode_status === "ok").length;
  const geocodeNoAddress = deals.filter((deal) => deal.geocode_status === "no_address").length;
  const geocodeFailed = deals.filter(
    (deal) => deal.geocode_status === "not_found" || deal.geocode_status === "error",
  ).length;
  const geocodePending = deals.filter((deal) => deal.geocode_status === null).length;

  async function runGeocodeMissing() {
    setGeocoding(true);
    try {
      const summary = await geocodeMissingAdminDeals();
      const demoPart = summary.demographics
        ? ` Tracts: ${summary.demographics.refreshed} fetched, ${summary.demographics.cached} cached, ${summary.demographics.failed} failed.`
        : "";
      const message = `Geocoded ${summary.processed} deal(s): ${summary.ok} ok, ${summary.no_address} no address, ${summary.not_found} not found, ${summary.error} error.${demoPart}`;
      if (summary.demographics?.failed) toast.error(message);
      else toast.success(message);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to geocode deals.");
    } finally {
      setGeocoding(false);
    }
  }

  async function retryDemographics() {
    setRetryingDemographics(true);
    try {
      const summary = await retryFailedDemographics();
      const message = `Demographics: ${summary.refreshed} updated, ${summary.failed} failed.`;
      if (summary.failed) toast.error(message);
      else toast.success(message);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to retry demographics.");
    } finally {
      setRetryingDemographics(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total deals" value={deals.length} />
        <StatCard label="Needs review" value={needsReview.length} />
        <StatCard label="Assumed cells" value={assumed} />
        <StatCard label="AI suggestions awaiting review" value={aiAwaitingReview.length} />
      </div>
      <Card>
        <CardHeader><CardTitle>Deals by stage</CardTitle></CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {[...stages].map(([stage, count]) => (
            <a className="flex justify-between rounded-md border p-3 hover:bg-muted" href={`/deals?stage=${encodeURIComponent(stage)}`} key={stage}>
              <span>{stage}</span><span className="font-semibold">{fmtNumber(count)}</span>
            </a>
          ))}
        </CardContent>
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Needs review and reasons</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {needsReview.length ? needsReview.map((deal) => (
              <a className="block rounded-md border p-3 hover:bg-muted" href={`/deals?needsReview=true&deal=${encodeURIComponent(deal.id)}`} key={deal.id}>
                <span className="font-medium">{deal.id}</span>
                <span className="ml-2 text-muted-foreground">{deal.review_reasons.join("; ") || "No reason recorded"}</span>
              </a>
            )) : <p className="text-muted-foreground">No deals need review.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Unmapped source stages</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {[...rawStages].map(([stage, count]) => (
              <a className="flex justify-between rounded-md border p-3 hover:bg-muted" href="/deals?needsReview=true" key={stage}>
                <span>{fmtOrDash(stage)}</span><span>{count}</span>
              </a>
            ))}
            {!rawStages.size && <p className="text-muted-foreground">No unmapped source stages.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Deals without an address</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {missingAddress.length ? missingAddress.map((deal) => <a className="block rounded-md border p-3 hover:bg-muted" href={`/deals?deal=${encodeURIComponent(deal.id)}`} key={deal.id}>{deal.id}</a>) : <p className="text-muted-foreground">All deals have an address.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Last seed/import</CardTitle></CardHeader>
          <CardContent><p>{fmtDate(lastImportAt, "PPpp")}</p></CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>AI suggestions awaiting review ({aiAwaitingReview.length})</CardTitle>
            <p className="text-xs text-muted-foreground">
              Deals with unconfirmed AI-drafted notes or extracted facts. Open any deal to accept, edit, or dismiss.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {aiAwaitingReview.length ? aiAwaitingReview.map((deal) => {
              const pending = pendingAiSections(deal);
              return (
                <a
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-violet-200 bg-violet-50/40 p-3 text-sm hover:bg-violet-50"
                  href={`/deals?deal=${encodeURIComponent(deal.id)}`}
                  key={deal.id}
                >
                  <div className="min-w-0">
                    <span className="font-medium">{deal.address || deal.id}</span>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{deal.id}</span>
                    {deal.weekly_note ? (
                      <p className="mt-0.5 truncate text-xs italic text-slate-600">{deal.weekly_note}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {pending.map((section) => (
                      <Badge className="text-[10px]" key={section} variant="secondary">
                        {section.replaceAll("_", " ")}
                      </Badge>
                    ))}
                  </div>
                </a>
              );
            }) : <p className="text-sm text-muted-foreground">All AI suggestions have been reviewed.</p>}
          </CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div>
              <CardTitle>Failed demographics tracts: {fmtNumber(failedTracts)}</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Retry Census demographics requests after resolving the reported issue.</p>
            </div>
            <Button disabled={retryingDemographics || failedTracts === 0} onClick={() => void retryDemographics()} size="sm">
              {retryingDemographics ? "Retrying…" : "Retry"}
            </Button>
          </CardHeader>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div>
              <CardTitle>Geocoding &amp; tract coverage</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                US Census Geocoder (no key required) with optional Google fallback. Deals without an address stay off the map.
              </p>
            </div>
            <Button disabled={geocoding} onClick={() => void runGeocodeMissing()} size="sm">
              {geocoding ? "Geocoding…" : "Geocode missing"}
            </Button>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">Geocoded (ok)</p>
              <p className="mt-1 text-xl font-semibold">{fmtNumber(geocodedOk)}</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">No address</p>
              <p className="mt-1 text-xl font-semibold">{fmtNumber(geocodeNoAddress)}</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">Not found / error</p>
              <p className="mt-1 text-xl font-semibold">{fmtNumber(geocodeFailed)}</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">Pending</p>
              <p className="mt-1 text-xl font-semibold">{fmtNumber(geocodePending)}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function AdminWorkspace({
  attributeValueCounts,
  autoRefreshRunId,
  clients,
  deals,
  failedTracts,
  importRuns,
  initialActiveRun,
  initialTab,
  lastImportAt,
  loginCounts,
  profiles,
  registerTab,
  returnRunId,
  sourceTabs,
  user,
  verticals,
  verticalConfigs,
  usage,
}: {
  attributeValueCounts: Record<string, Record<string, number>>;
  autoRefreshRunId?: number;
  clients: string[];
  deals: HealthDeal[];
  failedTracts: number;
  importRuns: ImportRunListItem[];
  initialActiveRun: ImportRunRecord | null;
  initialTab?: string;
  lastImportAt: string | null;
  loginCounts: LoginDay[];
  profiles: Profile[];
  registerTab?: string;
  returnRunId?: number;
  sourceTabs: SourceTab[];
  user: CurrentUser;
  verticals: string[];
  verticalConfigs: VerticalConfig[];
  usage: Usage[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<AdminTab>(isTab(initialTab) ? initialTab : "overview");

  useEffect(() => {
    if (isTab(initialTab)) {
      setTab(initialTab);
    }
  }, [initialTab]);

  return (
    <div className="space-y-5 px-4 pb-8 md:px-8">
      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (!isTab(value)) return;
          setTab(value);
          router.replace(`/admin?tab=${value}`, { scroll: false });
        }}
      >
        <TabsList className="flex w-full flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="users">Users &amp; permissions</TabsTrigger>
          <TabsTrigger value="activity">Activity log</TabsTrigger>
          <TabsTrigger value="health">Data health</TabsTrigger>
          <TabsTrigger value="verticals">Verticals &amp; tabs</TabsTrigger>
          <TabsTrigger value="import">Data import</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-5">
          <Overview
            loginCounts={loginCounts}
            needsReviewCount={deals.filter((deal) => deal.needs_review).length}
            usage={usage}
          />
        </TabsContent>
        <TabsContent value="users" className="mt-5">
          <UsersPanel clients={clients} profiles={profiles} user={user} usage={usage} verticals={verticals} />
        </TabsContent>
        <TabsContent value="activity" className="mt-5">
          <ActivityPanel profiles={profiles} />
        </TabsContent>
        <TabsContent value="health" className="mt-5">
          <DataHealth deals={deals} failedTracts={failedTracts} lastImportAt={lastImportAt} />
        </TabsContent>
        <TabsContent value="verticals" className="mt-5">
          <VerticalConfigPanel
            attributeValueCounts={attributeValueCounts}
            registerTab={registerTab}
            returnRunId={returnRunId}
            sourceTabs={sourceTabs}
            verticalConfigs={verticalConfigs}
          />
        </TabsContent>
        <TabsContent value="import" className="mt-5">
          <ImportPanel
            autoRefreshRunId={autoRefreshRunId}
            initialActiveRun={initialActiveRun}
            initialRuns={importRuns}
            profiles={profiles}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
