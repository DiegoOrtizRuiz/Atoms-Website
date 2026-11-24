"use client";

import { CalendarDays, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { TractDemographicsRow } from "@/lib/geo/acs";
import {
  demographicsUnavailableReason,
  formatTractDemographics,
  nextKeyDateForDeal,
  verticalAttributesForDeal,
} from "@/lib/geo/map-helpers";
import {
  isUnconfirmed,
  provenanceFor,
  type Deal,
  type VerticalConfig,
} from "@/lib/deals";
import { fmtMoney, fmtNumber, fmtOrDash } from "@/lib/format";
import { stageStyleFor } from "@/lib/stage-colors";

function ProvenanceValue({
  value,
  status,
}: {
  value: string;
  status: "assumed" | "llm_suggested" | "confirmed" | undefined;
}) {
  const highlighted = isUnconfirmed(status);
  const title =
    status === "assumed"
      ? "Assumption — not yet confirmed"
      : status === "llm_suggested"
        ? "LLM suggestion — review before confirming"
        : undefined;
  return (
    <span
      className={`inline-flex items-center gap-1 ${highlighted ? "italic" : ""}`}
      title={title}
    >
      {highlighted ? (
        <span
          aria-label={title}
          className={`size-1.5 shrink-0 rounded-full ${
            status === "assumed" ? "bg-amber-500" : "bg-violet-500"
          }`}
        />
      ) : null}
      <span>{value}</span>
    </span>
  );
}

export function DealHoverCard({
  deal,
  config,
  demographics,
  onSelectDeal,
}: {
  deal: Deal;
  config: VerticalConfig | undefined;
  demographics: TractDemographicsRow | null | undefined;
  onSelectDeal: (deal: Deal) => void;
}) {
  const stageStyle = stageStyleFor(deal.stage);
  const attrs = verticalAttributesForDeal(deal, config);
  const keyDate = nextKeyDateForDeal(deal);
  const demo = formatTractDemographics(demographics);
  const unavailableReason = demographicsUnavailableReason(deal.census_tract_geoid, demographics);

  return (
    <div className="w-[310px] space-y-3 text-left text-xs text-slate-800" data-testid="deal-hover-card">
      <div className="space-y-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold leading-snug text-slate-950">
            {fmtOrDash(deal.address)}
          </p>
          <Badge className={`shrink-0 text-[10px] ${stageStyle.badgeClass}`}>
            {deal.stage}
          </Badge>
        </div>
        <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
          <MapPin className="size-3 shrink-0" />
          <span>{[deal.city, deal.state].filter(Boolean).join(", ") || "—"}</span>
          {deal.state_inferred ? (
            <Badge
              className="border-amber-300 bg-amber-50 px-1.5 py-0 text-[10px] text-amber-800"
              variant="outline"
            >
              state inferred
            </Badge>
          ) : null}
        </p>
        <p className="text-[11px] text-slate-500">
          {fmtOrDash(deal.client)} · {fmtOrDash(deal.vertical)} ·{" "}
          {fmtOrDash(deal.market)}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-md bg-slate-50 p-2">
        <div>
          <dt className="text-[10px] text-slate-400">List price</dt>
          <dd className="font-medium">
            <ProvenanceValue
              status={provenanceFor(deal, "list_price")}
              value={fmtMoney(deal.list_price, { maximumFractionDigits: 0 })}
            />
          </dd>
        </div>
        <div>
          <dt className="text-[10px] text-slate-400">Bldg SF</dt>
          <dd className="font-medium">
            <ProvenanceValue
              status={provenanceFor(deal, "bldg_sf")}
              value={fmtNumber(deal.bldg_sf)}
            />
          </dd>
        </div>
        <div>
          <dt className="text-[10px] text-slate-400">$/SF</dt>
          <dd className="font-medium">
            {fmtMoney(deal.price_per_sf, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] text-slate-400">Lot SF</dt>
          <dd className="font-medium">
            <ProvenanceValue
              status={provenanceFor(deal, "lot_sf")}
              value={fmtNumber(deal.lot_sf)}
            />
          </dd>
        </div>
      </dl>

      {attrs.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Site attributes
          </p>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
            {attrs.slice(0, 6).map((attr) => (
              <div className="min-w-0" key={attr.key}>
                <dt className="truncate text-[10px] text-slate-400">
                  {attr.label}
                </dt>
                <dd className="truncate font-medium">
                  <ProvenanceValue
                    status={attr.provenance}
                    value={attr.displayValue}
                  />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {keyDate ? (
        <p className="flex items-center gap-1.5 rounded bg-cyan-50 px-2 py-1 text-[11px] font-medium text-cyan-900">
          <CalendarDays className="size-3 shrink-0" />
          <span>
            Next key date: {keyDate.label} ({keyDate.formattedDate})
          </span>
        </p>
      ) : null}

      <div className="space-y-1 border-t border-slate-100 pt-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Tract demographics
          </p>
          {deal.census_tract_geoid ? (
            <span className="font-mono text-[10px] text-slate-400">
              {deal.census_tract_geoid}
            </span>
          ) : null}
        </div>
        {unavailableReason ? (
          <p className="text-[11px] text-amber-700">
            Demographics unavailable: {unavailableReason}
          </p>
        ) : demo ? (
          <>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
              <div>
                <dt className="text-[10px] text-slate-400">Population</dt>
                <dd className="font-medium">{demo.population}</dd>
              </div>
              <div>
                <dt className="text-[10px] text-slate-400">Median HH income</dt>
                <dd className="font-medium">{demo.medianIncome}</dd>
              </div>
              <div>
                <dt className="text-[10px] text-slate-400">Median age</dt>
                <dd className="font-medium">{demo.medianAge}</dd>
              </div>
              <div>
                <dt className="text-[10px] text-slate-400">Households</dt>
                <dd className="font-medium">{demo.households}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-[10px] text-slate-400">% bachelor&apos;s+</dt>
                <dd className="font-medium">{demo.pctBachelors}</dd>
              </div>
            </dl>
            <p className="pt-0.5 text-[10px] text-slate-400">
              {demo.sourceLabel}
            </p>
          </>
        ) : null}
      </div>

      <Button
        className="w-full"
        onClick={() => onSelectDeal(deal)}
        size="sm"
        variant="outline"
      >
        Open deal drawer
      </Button>
    </div>
  );
}
