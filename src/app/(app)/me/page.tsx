import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { MyProfile } from "./profile";

export const metadata: Metadata = { title: "My profile" };

export default async function MePage() {
  const user = await requireUser();
  const supabase = await createClient();
  const [activity, edits] = await Promise.all([
    supabase
      .from("activity_log")
      .select("id, event, path, detail, created_at")
      .eq("user_id", user.id)
      .eq("event", "login")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("deal_history")
      .select("id, deal_id, field, old_value, new_value, changed_at")
      .eq("changed_by", user.id)
      .order("changed_at", { ascending: false })
      .limit(20),
  ]);
  if (activity.error) throw new Error(activity.error.message);
  if (edits.error) throw new Error(edits.error.message);

  const { error: logError } = await supabase.from("activity_log").insert({
    user_id: user.id,
    event: "page_view",
    path: "/me",
    detail: { source: "server" },
  });
  if (logError) console.error("Unable to record the profile page view.", logError);

  const recent = [
    ...(activity.data ?? []).map((item) => ({
      id: `activity-${item.id}`,
      kind: item.event,
      at: item.created_at,
      description: "Signed in",
      dealId: null,
    })),
    ...(edits.data ?? []).map((item) => ({
      id: `edit-${item.id}`,
      kind: "deal_edit",
      at: item.changed_at,
      description: `Changed ${item.field}`,
      dealId: item.deal_id,
    })),
  ]
    .sort((left, right) => right.at.localeCompare(left.at))
    .slice(0, 20);

  return (
    <>
      <PageHeader
        title="My profile"
        description="Review your account, permissions, and recent activity."
      />
      <MyProfile recent={recent} user={user} />
    </>
  );
}
