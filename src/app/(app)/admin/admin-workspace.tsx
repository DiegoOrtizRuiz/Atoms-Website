"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CurrentUser } from "@/lib/auth";
import type { Database, Json } from "@/lib/database.types";
import { fmtDate, fmtNumber, fmtOrDash } from "@/lib/format";
import { usePresenceMembers } from "@/lib/presence";
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
  "id" | "stage" | "needs_review" | "review_reasons" | "stage_raw" | "field_provenance" | "address"
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
  lastImportAt,
}: {
  deals: HealthDeal[];
  lastImportAt: string | null;
}) {
  const stages = new Map<string, number>();
  const rawStages = new Map<string, number>();
  let assumed = 0;
  let suggested = 0;
  for (const deal of deals) {
    stages.set(deal.stage, (stages.get(deal.stage) ?? 0) + 1);
    if (deal.stage === "Needs review" && deal.stage_raw) {
      rawStages.set(deal.stage_raw, (rawStages.get(deal.stage_raw) ?? 0) + 1);
    }
    for (const value of Object.values(record(deal.field_provenance))) {
      if (value === "assumed") assumed++;
      if (value === "llm_suggested") suggested++;
    }
  }
  const missingAddress = deals.filter((deal) => !deal.address?.trim());
  const needsReview = deals.filter((deal) => deal.needs_review);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total deals" value={deals.length} />
        <StatCard label="Needs review" value={needsReview.length} />
        <StatCard label="Assumed cells" value={assumed} />
        <StatCard label="LLM-suggested pending" value={suggested} />
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
      </div>
    </div>
  );
}

export function AdminWorkspace({
  attributeValueCounts,
  autoRefreshRunId,
  clients,
  deals,
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
          <DataHealth deals={deals} lastImportAt={lastImportAt} />
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
