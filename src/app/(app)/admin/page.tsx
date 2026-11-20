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
  const [profiles, usage, verticals, clients, deals, loginCounts, imports] =
    await Promise.all([
      supabase.from("profiles").select("*").order("full_name"),
      supabase.from("v_user_usage").select("*"),
      supabase.from("vertical_config").select("vertical").order("sort_order"),
      supabase.from("deals").select("client").not("client", "is", null),
      supabase
        .from("deals")
        .select("id, stage, needs_review, review_reasons, stage_raw, field_provenance, address"),
      supabase.rpc("admin_logins_per_day", { days: 30 }),
      supabase
        .from("deal_history")
        .select("changed_at")
        .is("changed_by", null)
        .order("changed_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  for (const result of [profiles, usage, verticals, clients, deals, loginCounts]) {
    if (result.error) throw new Error(result.error.message);
  }
  if (imports.error) throw new Error(imports.error.message);

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
        deals={deals.data ?? []}
        initialTab={(await searchParams).tab}
        lastImportAt={imports.data?.changed_at ?? null}
        loginCounts={loginCounts.data ?? []}
        profiles={profiles.data ?? []}
        user={user}
        verticals={(verticals.data ?? []).map((item) => item.vertical)}
        usage={usage.data ?? []}
      />
    </>
  );
}
