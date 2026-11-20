import type { Metadata } from "next";
import { ChartNoAxesCombined } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PhasePlaceholder } from "@/components/phase-placeholder";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Rollup" };

export default async function RollupPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.from("activity_log").insert({
    user_id: user.id,
    event: "page_view",
    path: "/rollup",
    detail: { source: "server" },
  });
  if (error) console.error("Unable to record the Rollup page view.", error);

  return (
    <>
      <PageHeader
        title="Stage rollup"
        description="Understand pipeline volume and time in stage by vertical and market."
      />
      <PhasePlaceholder
        description="Aggregate reporting will be enabled from the stage rollup database view."
        icon={ChartNoAxesCombined}
        title="Rollup reporting is ready to connect"
      />
    </>
  );
}
