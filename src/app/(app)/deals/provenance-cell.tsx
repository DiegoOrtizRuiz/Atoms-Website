"use client";

import type { ICellRendererParams } from "ag-grid-community";
import { Check, Ellipsis, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { canConfirmDeal, canEditDeal, provenanceFor, type Deal } from "@/lib/deals";
import type { CurrentUser } from "@/lib/auth";

export type CellActionContext = {
  user: CurrentUser;
  markAssumption: (deal: Deal, field: string) => Promise<void>;
  confirmField: (deal: Deal, field: string) => Promise<void>;
  onSelectDeal: (deal: Deal) => void;
};

export function provenanceLabel(deal: Deal, field: string) {
  const status = provenanceFor(deal, field);
  if (status === "assumed") return "Assumption — not yet confirmed";
  if (status === "llm_suggested") return "LLM suggestion — review before confirming";
  return "Confirmed";
}

export function ProvenanceCell(
  props: ICellRendererParams<Deal> & {
    displayValue?: React.ReactNode;
  },
) {
  const deal = props.data;
  if (!deal) return null;
  const context = props.context as CellActionContext;
  const field = props.colDef?.field ?? props.colDef?.colId ?? "";
  const provenanceKey = field.startsWith("attributes.")
    ? field.slice("attributes.".length)
    : field;
  const status = provenanceFor(deal, provenanceKey);
  const highlighted = status === "assumed" || status === "llm_suggested";
  const canEdit = canEditDeal(context.user, deal);
  const canConfirm = canConfirmDeal(context.user, deal);

  async function run(action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update provenance.");
    }
  }

  return (
    <div
      className={`group flex h-full min-w-0 items-center gap-1.5 ${
        highlighted ? "italic" : ""
      }`}
    >
      {highlighted ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                className={`size-1.5 shrink-0 rounded-full ${
                  status === "assumed" ? "bg-amber-500" : "bg-violet-500"
                }`}
              />
            }
          />
          <TooltipContent>{provenanceLabel(deal, provenanceKey)}</TooltipContent>
        </Tooltip>
      ) : null}
      <span className="min-w-0 flex-1 truncate">
        {props.displayValue ?? props.valueFormatted ?? props.value ?? "—"}
      </span>
      {canEdit || (highlighted && canConfirm) ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                aria-label={`Value actions for ${provenanceKey}`}
                className="grid size-6 shrink-0 place-items-center rounded opacity-0 text-slate-400 transition-opacity hover:bg-slate-100 group-hover:opacity-100 focus:opacity-100"
                onClick={(event) => event.stopPropagation()}
                type="button"
              />
            }
          >
            <Ellipsis className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canEdit ? (
              <DropdownMenuItem
                onClick={() =>
                  run(() => context.markAssumption(deal, provenanceKey))
                }
              >
                <Sparkles className="size-4" />
                Mark as assumption
              </DropdownMenuItem>
            ) : null}
            {highlighted && canConfirm ? (
              <DropdownMenuItem
                onClick={() =>
                  run(() => context.confirmField(deal, provenanceKey))
                }
              >
                <Check className="size-4" />
                Confirm value
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
