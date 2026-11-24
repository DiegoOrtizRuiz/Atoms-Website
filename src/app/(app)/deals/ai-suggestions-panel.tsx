"use client";

import { useState } from "react";
import { Check, Pencil, RefreshCw, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  activeSuggestionSections,
  evidenceQuotesFor,
  parseAiExtraction,
  sectionStatus,
  type AiSectionKey,
} from "@/lib/ai-suggestions";
import type { CurrentUser } from "@/lib/auth";
import { canConfirmDeal, type Deal } from "@/lib/deals";
import { fmtMoney, fmtOrDash } from "@/lib/format";
import {
  acceptAiSuggestion,
  dismissAiSuggestion,
  editAndAcceptAiSuggestion,
  regenerateDealSuggestion,
} from "./actions";

const SECTION_META: Record<
  AiSectionKey,
  { title: string; evidenceFields: string[] }
> = {
  weekly_note: { title: "Weekly note", evidenceFields: ["weekly_note"] },
  key_dates: { title: "Key dates", evidenceFields: ["key_dates"] },
  price_context: {
    title: "Price context",
    evidenceFields: ["negotiated_price", "price_context"],
  },
  risks: { title: "Risks", evidenceFields: ["risks"] },
  next_step: { title: "Next step", evidenceFields: ["next_step"] },
  deal_type: { title: "Deal type", evidenceFields: ["deal_type"] },
  suggested_stage: {
    title: "Suggested stage",
    evidenceFields: ["suggested_stage", "suggested_stage_reason"],
  },
};

export function AiSuggestionsPanel({
  deal,
  user,
  onDealUpdated,
}: {
  deal: Deal;
  user?: CurrentUser;
  onDealUpdated?: (deal: Deal) => void;
}) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [editingSection, setEditingSection] = useState<AiSectionKey | null>(null);
  const [draftText, setDraftText] = useState("");

  const parsed = parseAiExtraction(deal);
  const sections = activeSuggestionSections(deal);
  const canReview = Boolean(user && canConfirmDeal(user, deal));

  function initialDraft(section: AiSectionKey): string {
    if (!parsed) return "";
    if (section === "weekly_note") return parsed.weekly_note ?? "";
    if (section === "price_context") return parsed.price_context ?? "";
    if (section === "next_step") return parsed.next_step ?? "";
    if (section === "risks") return parsed.risks.join("; ");
    if (section === "deal_type") return parsed.deal_type;
    if (section === "suggested_stage") return parsed.suggested_stage ?? "";
    if (section === "key_dates") {
      return parsed.key_dates
        .map((d) => `${d.label}: ${d.date_text}${d.iso_guess ? ` (${d.iso_guess})` : ""}`)
        .join("; ");
    }
    return "";
  }

  async function handleAccept(section: AiSectionKey) {
    setBusyKey(`accept:${section}`);
    try {
      const result = await acceptAiSuggestion({
        dealId: deal.id,
        version: deal.version,
        section,
      });
      onDealUpdated?.(result.deal);
      if (result.conflict) {
        toast.error("Someone else edited this deal — reloaded");
        return;
      }
      toast.success(`${SECTION_META[section].title} accepted`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to accept suggestion.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleEditAccept(section: AiSectionKey) {
    if (!draftText.trim()) {
      toast.error("Enter a value before saving.");
      return;
    }
    setBusyKey(`edit:${section}`);
    try {
      const result = await editAndAcceptAiSuggestion({
        dealId: deal.id,
        version: deal.version,
        section,
        editedText: draftText.trim(),
      });
      onDealUpdated?.(result.deal);
      if (result.conflict) {
        toast.error("Someone else edited this deal — reloaded");
        return;
      }
      setEditingSection(null);
      setDraftText("");
      toast.success(`${SECTION_META[section].title} updated and accepted`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save suggestion.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleDismiss(section: AiSectionKey) {
    setBusyKey(`dismiss:${section}`);
    try {
      const result = await dismissAiSuggestion({
        dealId: deal.id,
        version: deal.version,
        section,
      });
      onDealUpdated?.(result.deal);
      if (result.conflict) {
        toast.error("Someone else edited this deal — reloaded");
        return;
      }
      toast.success(`${SECTION_META[section].title} dismissed`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to dismiss suggestion.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleRegenerate() {
    setRegenerating(true);
    try {
      const result = await regenerateDealSuggestion({
        dealId: deal.id,
        version: deal.version,
      });
      if (result.deal) onDealUpdated?.(result.deal);
      if (!result.ok) {
        toast.info(result.message);
        return;
      }
      toast.success(
        result.cached
          ? "AI suggestions refreshed from cache"
          : "AI suggestions regenerated",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to regenerate suggestions.");
    } finally {
      setRegenerating(false);
    }
  }

  function renderSectionBody(section: AiSectionKey) {
    if (!parsed) return null;
    if (section === "weekly_note") {
      return <p className="text-sm text-slate-800">{fmtOrDash(parsed.weekly_note)}</p>;
    }
    if (section === "key_dates") {
      return (
        <ul className="space-y-1 text-sm text-slate-800">
          {parsed.key_dates.map((item) => (
            <li key={`${item.label}:${item.date_text}`}>
              <span className="font-medium">{item.label}</span>: {item.date_text}
              {item.iso_guess ? (
                <span className="ml-1.5 text-xs text-slate-500">({item.iso_guess})</span>
              ) : null}
            </li>
          ))}
        </ul>
      );
    }
    if (section === "price_context") {
      return (
        <div className="space-y-1 text-sm text-slate-800">
          {parsed.negotiated_price !== null ? (
            <p className="font-medium">
              Negotiated price: {fmtMoney(parsed.negotiated_price)}
            </p>
          ) : null}
          {parsed.price_context ? <p>{parsed.price_context}</p> : null}
        </div>
      );
    }
    if (section === "risks") {
      return (
        <ul className="list-disc space-y-1 pl-4 text-sm text-slate-800">
          {parsed.risks.map((risk) => (
            <li key={risk}>{risk}</li>
          ))}
        </ul>
      );
    }
    if (section === "next_step") {
      return <p className="text-sm text-slate-800">{parsed.next_step}</p>;
    }
    if (section === "deal_type") {
      return <p className="text-sm font-medium capitalize text-slate-800">{parsed.deal_type}</p>;
    }
    if (section === "suggested_stage") {
      return (
        <p className="text-sm text-slate-800">
          <span className="font-medium">{parsed.suggested_stage}</span>
          {parsed.suggested_stage_reason ? ` — ${parsed.suggested_stage_reason}` : ""}
        </p>
      );
    }
    return null;
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-violet-600" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            AI suggestions
          </h3>
          {parsed?.confidence !== null && parsed?.confidence !== undefined ? (
            <Badge className="border-violet-200 bg-violet-50 text-[10px] text-violet-800" variant="outline">
              {Math.round(parsed.confidence * 100)}% confidence
            </Badge>
          ) : null}
        </div>
        {canReview ? (
          <Button
            disabled={regenerating || !deal.notes?.trim()}
            onClick={() => void handleRegenerate()}
            size="sm"
            variant="outline"
          >
            <RefreshCw className={`mr-1.5 size-3.5 ${regenerating ? "animate-spin" : ""}`} />
            {regenerating ? "Regenerating…" : "Regenerate suggestion"}
          </Button>
        ) : null}
      </div>

      {sections.length > 0 && parsed ? (
        <div className="space-y-2.5">
          {sections.map((section) => {
            const status = sectionStatus(deal, section);
            const isSuggested = status === "llm_suggested";
            const quotes = evidenceQuotesFor(
              parsed.evidence,
              SECTION_META[section].evidenceFields,
            );
            const isEditing = editingSection === section;

            return (
              <div
                className={`rounded-lg border p-3.5 ${
                  isSuggested
                    ? "border-violet-200 bg-violet-50/40"
                    : "border-slate-200 bg-slate-50/50"
                }`}
                key={section}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-700">
                      {SECTION_META[section].title}
                    </span>
                    {isSuggested ? (
                      <Badge
                        className="border-violet-300 bg-violet-100 text-[10px] italic text-violet-900"
                        variant="outline"
                      >
                        <span className="mr-1 inline-block size-1.5 rounded-full bg-violet-600" />
                        AI suggested
                      </Badge>
                    ) : status === "confirmed" ? (
                      <Badge
                        className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-800"
                        variant="outline"
                      >
                        Confirmed
                      </Badge>
                    ) : null}
                  </div>
                </div>

                <div className={`mt-2 ${isSuggested ? "italic" : ""}`}>
                  {renderSectionBody(section)}
                </div>

                {quotes.length > 0 ? (
                  <p className="mt-2 rounded bg-white/80 px-2.5 py-1.5 text-[11px] text-slate-600">
                    <span className="font-semibold text-slate-500">Evidence:</span>{" "}
                    {quotes.map((quote) => `"${quote}"`).join(" · ")}
                  </p>
                ) : null}

                {isEditing ? (
                  <div className="mt-3 space-y-2">
                    <Input
                      aria-label={`Edit ${SECTION_META[section].title}`}
                      onChange={(event) => setDraftText(event.target.value)}
                      value={draftText}
                    />
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        disabled={busyKey !== null}
                        onClick={() => void handleEditAccept(section)}
                        size="sm"
                      >
                        {busyKey === `edit:${section}` ? "Saving…" : "Save & accept"}
                      </Button>
                      <Button
                        disabled={busyKey !== null}
                        onClick={() => setEditingSection(null)}
                        size="sm"
                        variant="outline"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : canReview && isSuggested ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Button
                      disabled={busyKey !== null}
                      onClick={() => void handleAccept(section)}
                      size="sm"
                    >
                      <Check className="mr-1 size-3.5" />
                      {busyKey === `accept:${section}` ? "Accepting…" : "Accept"}
                    </Button>
                    <Button
                      disabled={busyKey !== null}
                      onClick={() => {
                        setEditingSection(section);
                        setDraftText(initialDraft(section));
                      }}
                      size="sm"
                      variant="outline"
                    >
                      <Pencil className="mr-1 size-3.5" />
                      Edit &amp; accept
                    </Button>
                    <Button
                      disabled={busyKey !== null}
                      onClick={() => void handleDismiss(section)}
                      size="sm"
                      variant="ghost"
                    >
                      <X className="mr-1 size-3.5" />
                      {busyKey === `dismiss:${section}` ? "Dismissing…" : "Dismiss"}
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed p-3 text-xs text-slate-500">
          No active AI suggestions for this deal.
        </p>
      )}
    </section>
  );
}
