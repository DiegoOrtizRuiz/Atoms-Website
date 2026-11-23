import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminWorkspace } from "./admin-workspace";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requireUser();
  if (user.role !== "admin") notFound();

  const supabase = await createClient();
  const [
    profiles,
    usage,
    verticalConfigs,
    sourceTabs,
    clients,
    deals,
    attributeDeals,
    loginCounts,
    imports,
  ] = await Promise.all([
    supabase.from("profiles").select("*").order("full_name"),
    supabase.from("v_user_usage").select("*"),
    supabase.from("vertical_config").select("*").order("sort_order"),
    supabase.from("source_tabs").select("*").order("tab_name"),
    supabase.from("deals").select("client").not("client", "is", null),
    supabase
      .from("deals")
      .select("id, stage, needs_review, review_reasons, stage_raw, field_provenance, address"),
    supabase.from("deals").select("vertical, attributes"),
    supabase.rpc("admin_logins_per_day", { days: 30 }),
    supabase
      .from("deal_history")
      .select("changed_at")
      .is("changed_by", null)
      .order("changed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  for (const result of [
    profiles,
    usage,
    verticalConfigs,
    sourceTabs,
    clients,
    deals,
    attributeDeals,
    loginCounts,
  ]) {
    if (result.error) throw new Error(result.error.message);
  }
  if (imports.error) throw new Error(imports.error.message);

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
      />
      <AdminWorkspace
        clients={[
          ...new Set(
            (clients.data ?? [])
              .map((deal) => deal.client)
              .filter((client): client is string => Boolean(client)),
          ),
        ].sort()}
        attributeValueCounts={attributeValueCounts}
        deals={deals.data ?? []}
        initialTab={(await searchParams).tab}
        lastImportAt={imports.data?.changed_at ?? null}
        loginCounts={loginCounts.data ?? []}
        profiles={profiles.data ?? []}
        sourceTabs={sourceTabs.data ?? []}
        user={user}
        verticalConfigs={verticalConfigs.data ?? []}
        verticals={(verticalConfigs.data ?? []).map((item) => item.vertical)}
        usage={usage.data ?? []}
      />
    </>
  );
}
