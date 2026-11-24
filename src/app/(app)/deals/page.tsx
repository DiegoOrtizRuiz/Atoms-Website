import type { Metadata } from "next";
import { OperationsWorkspace } from "./operations-workspace";
import { requireUser } from "@/lib/auth";
import { effectiveRole } from "@/lib/effective-role";
import type { TractDemographicsRow } from "@/lib/geo/acs";
import { createClient } from "@/lib/supabase/server";
import { dealStages, type DealStage } from "@/lib/deals";
import type { DealFilters } from "./filter-controls";

export const metadata: Metadata = { title: "Operations" };

function listParam(value: string | string[] | undefined) {
  const joined = Array.isArray(value) ? value.join(",") : value;
  return joined ? joined.split(",").filter(Boolean) : [];
}

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const user = await requireUser();
  const role = await effectiveRole(user);
  const supabase = await createClient();
  const [dealsResult, configResult, demographicsResult] = await Promise.all([
    supabase.from("deals").select("*").order("updated_at", { ascending: false }),
    supabase
      .from("vertical_config")
      .select("*")
      .order("sort_order", { ascending: true }),
    supabase.from("tract_demographics").select("*"),
  ]);

  if (dealsResult.error) throw new Error(dealsResult.error.message);
  if (configResult.error) throw new Error(configResult.error.message);
  if (demographicsResult.error) throw new Error(demographicsResult.error.message);

  const tractDemographics: Record<string, TractDemographicsRow> = {};
  for (const row of demographicsResult.data ?? []) {
    tractDemographics[row.geoid] = row;
  }

  const { error: activityError } = await supabase.from("activity_log").insert({
    user_id: user.id,
    event: "page_view",
    path: "/deals",
    detail: { source: "server" },
  });
  if (activityError) {
    console.error("Unable to record the Operations page view.", activityError);
  }

  return (
    <OperationsWorkspace
      initialFilters={{
        clients: listParam(params.client),
        verticals: listParam(params.vertical),
        markets: listParam(params.market),
        stages: listParam(params.stage).filter((stage): stage is DealStage =>
          dealStages.includes(stage as DealStage),
        ),
        needsReview: params.needsReview === "true",
        hasAssumptions: params.assumptions === "true",
      } satisfies DealFilters}
      initialConfigs={configResult.data}
      initialDeals={dealsResult.data}
      initialDealId={typeof params.deal === "string" ? params.deal : undefined}
      initialTractDemographics={tractDemographics}
      initialView={params.view === "map" ? "map" : "grid"}
      mapsApiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? ""}
      effectiveRole={role}
      user={user}
    />
  );
}
