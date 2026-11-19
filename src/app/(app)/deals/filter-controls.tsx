"use client";

import { Check, ChevronDown, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { DealStage } from "@/lib/deals";

export type DealFilters = {
  clients: string[];
  verticals: string[];
  markets: string[];
  stages: DealStage[];
  needsReview: boolean;
  hasAssumptions: boolean;
};

export const emptyFilters: DealFilters = {
  clients: [],
  verticals: [],
  markets: [],
  stages: [],
  needsReview: false,
  hasAssumptions: false,
};

function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const summary =
    selected.length === 0
      ? "All"
      : selected.length === 1
        ? options.find((option) => option.value === selected[0])?.label
        : `${selected.length} selected`;

  return (
    <div className="min-w-40 space-y-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              className="h-9 w-full justify-between bg-white font-normal"
              variant="outline"
            />
          }
        >
          <span className="truncate">{summary}</span>
          <ChevronDown className="size-3.5 text-slate-400" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-52 max-h-72 overflow-y-auto">
          {options.map((option) => {
            const checked = selected.includes(option.value);
            return (
              <DropdownMenuCheckboxItem
                checked={checked}
                key={option.value}
                onCheckedChange={(next) =>
                  onChange(
                    next
                      ? [...selected, option.value]
                      : selected.filter((value) => value !== option.value),
                  )
                }
              >
                {option.label}
              </DropdownMenuCheckboxItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function FilterControls({
  filters,
  options,
  stageCounts,
  onChange,
}: {
  filters: DealFilters;
  options: {
    clients: string[];
    verticals: string[];
    markets: string[];
    stages: DealStage[];
  };
  stageCounts: Record<string, number>;
  onChange: (filters: DealFilters) => void;
}) {
  const active =
    filters.clients.length > 0 ||
    filters.verticals.length > 0 ||
    filters.markets.length > 0 ||
    filters.stages.length > 0 ||
    filters.needsReview ||
    filters.hasAssumptions;

  return (
    <div className="border-b border-slate-200 bg-slate-50 px-6 py-4 lg:px-10">
      <div className="flex flex-wrap items-end gap-3">
        <MultiSelect
          label="Client"
          onChange={(clients) => onChange({ ...filters, clients })}
          options={options.clients.map((value) => ({ value, label: value }))}
          selected={filters.clients}
        />
        <MultiSelect
          label="Vertical"
          onChange={(verticals) => onChange({ ...filters, verticals })}
          options={options.verticals.map((value) => ({ value, label: value }))}
          selected={filters.verticals}
        />
        <MultiSelect
          label="Market"
          onChange={(markets) => onChange({ ...filters, markets })}
          options={options.markets.map((value) => ({ value, label: value }))}
          selected={filters.markets}
        />
        <MultiSelect
          label="Stage"
          onChange={(stages) =>
            onChange({ ...filters, stages: stages as DealStage[] })
          }
          options={options.stages.map((value) => ({
            value,
            label: `${value} (${stageCounts[value] ?? 0})`,
          }))}
          selected={filters.stages}
        />
        <Button
          className="h-9"
          onClick={() =>
            onChange({ ...filters, needsReview: !filters.needsReview })
          }
          variant={filters.needsReview ? "default" : "outline"}
        >
          {filters.needsReview ? <Check className="size-4" /> : null}
          Needs review
        </Button>
        <Button
          className="h-9"
          onClick={() =>
            onChange({ ...filters, hasAssumptions: !filters.hasAssumptions })
          }
          variant={filters.hasAssumptions ? "default" : "outline"}
        >
          {filters.hasAssumptions ? <Check className="size-4" /> : null}
          Has assumptions
        </Button>
        {active ? (
          <Button
            className="h-9 text-slate-500"
            onClick={() => onChange(emptyFilters)}
            variant="ghost"
          >
            <RotateCcw className="size-4" />
            Reset
          </Button>
        ) : null}
      </div>
    </div>
  );
}
