import type { Metadata } from "next";
import { ChartNoAxesCombined } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PhasePlaceholder } from "@/components/phase-placeholder";

export const metadata: Metadata = { title: "Rollup" };

export default function RollupPage() {
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
