import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { WeeklyWorkspace } from "./weekly-workspace";

export const metadata: Metadata = { title: "Weekly Review" };

export default async function WeeklyPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const [deals, configs, history, snapshot] = await Promise.all([
    supabase.from("deals").select("*").order("updated_at", { ascending: false }),
    supabase.from("vertical_config").select("*").order("sort_order"),
    supabase
      .from("deal_history")
      .select("*")
      .gte("changed_at", new Date(Date.now() - 30 * 86400000).toISOString())
      .order("changed_at", { ascending: false }),
    supabase
      .from("weekly_snapshots")
      .select("id, week_start, created_at, data")
      .order("week_start", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  for (const result of [deals, configs, history]) {
    if (result.error) throw new Error(result.error.message);
  }
  if (snapshot.error) throw new Error(snapshot.error.message);

  const { error: activityError } = await supabase.from("activity_log").insert({
    user_id: user.id,
    event: "page_view",
    path: "/weekly",
    detail: { source: "server" },
  });
  if (activityError) {
    console.error("Unable to record the Weekly Review page view.", activityError);
  }

  return (
    <WeeklyWorkspace
      initialConfigs={configs.data ?? []}
      initialDeals={deals.data ?? []}
      initialHistory={history.data ?? []}
      initialSnapshot={snapshot.data}
      user={user}
    />
  );
}
