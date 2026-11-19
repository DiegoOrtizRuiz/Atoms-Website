"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CalendarDays, History, MapPin, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fmtDate, fmtMoney, fmtNumber, fmtOrDash } from "@/lib/format";
import type { Deal, DealHistory } from "@/lib/deals";
import { loadDealHistory } from "./actions";

function valueText(value: unknown) {
  if (value == null || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

export function DealDrawer({
  deal,
  open,
  onOpenChange,
}: {
  deal: Deal | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [history, setHistory] = useState<DealHistory[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !deal) return;
    let active = true;
    setHistory([]);
    setHistoryError(null);
    loadDealHistory(deal.id)
      .then((rows) => {
        if (active) setHistory(rows);
      })
      .catch((error) => {
        if (active) {
          setHistoryError(
            error instanceof Error ? error.message : "Unable to load history.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [deal, open]);

  if (!deal || !open) return null;
  const attributes = deal.attributes as Record<string, unknown>;
  const rawAttributes = deal.attributes_raw as Record<string, unknown>;
  const extracted = deal.notes_extracted as Record<string, unknown> | null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <button
        aria-label="Close deal details"
        className="absolute inset-0 bg-slate-950/30 backdrop-blur-[2px]"
        onClick={() => onOpenChange(false)}
        type="button"
      />
      <aside className="relative h-full w-full max-w-xl overflow-y-auto border-l border-slate-200 bg-white shadow-2xl">
        <header className="sticky top-0 z-10 border-b bg-white px-6 py-5">
          <div className="flex items-start justify-between gap-5 pr-8">
            <div>
              <h2 className="text-xl font-semibold text-slate-950">
                {fmtOrDash(deal.address)}
              </h2>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
                <MapPin className="size-3.5" />
                {[deal.city, deal.state].filter(Boolean).join(", ") || "—"}
              </p>
            </div>
            {deal.needs_review ? (
              <Badge className="bg-amber-100 text-amber-800">Needs review</Badge>
            ) : null}
          </div>
          <Button
            aria-label="Close"
            className="absolute top-3 right-3"
            onClick={() => onOpenChange(false)}
            size="icon-sm"
            variant="ghost"
          >
            <X className="size-4" />
          </Button>
        </header>

        <div className="space-y-8 px-6 py-6">
          <section>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Deal snapshot
            </h3>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
              {[
                ["Stage", deal.stage],
                ["Raw stage", deal.stage_raw],
                ["Client", deal.client],
                ["Market", deal.market],
                ["Vertical", deal.vertical],
                ["Broker", deal.broker],
                ["Building SF", fmtNumber(deal.bldg_sf)],
                ["List price", fmtMoney(deal.list_price)],
                ["$/SF", fmtMoney(deal.price_per_sf, { minimumFractionDigits: 2 })],
                ["Lot SF", fmtNumber(deal.lot_sf)],
                ["Updated", fmtDate(deal.updated_at, "MMM d, yyyy h:mm a")],
                ["Version", deal.version],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-slate-400">{label}</dt>
                  <dd className="mt-1 font-medium text-slate-800">
                    {fmtOrDash(value)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Notes
            </h3>
            <p className="whitespace-pre-wrap rounded-lg border bg-slate-50 p-4 text-sm leading-6 text-slate-700">
              {fmtOrDash(deal.notes)}
            </p>
            {deal.weekly_note ? (
              <div className="mt-3">
                <p className="mb-1 text-xs font-medium text-slate-400">Weekly note</p>
                <p className="rounded-lg border border-cyan-100 bg-cyan-50 p-4 text-sm leading-6 text-slate-700">
                  {deal.weekly_note}
                </p>
              </div>
            ) : null}
          </section>

          {deal.review_reasons.length ? (
            <section>
              <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <AlertTriangle className="size-4 text-amber-500" />
                Review reasons
              </h3>
              <ul className="space-y-2">
                {deal.review_reasons.map((reason) => (
                  <li
                    className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                    key={reason}
                  >
                    {reason}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Vertical attributes
            </h3>
            <div className="space-y-2 rounded-lg border divide-y">
              {Object.keys(attributes).length ? (
                Object.entries(attributes).map(([key, value]) => (
                  <div
                    className="grid grid-cols-2 gap-4 px-4 py-3 text-sm"
                    key={key}
                  >
                    <span className="text-slate-500">{key.replaceAll("_", " ")}</span>
                    <span className="break-words text-right font-medium text-slate-800">
                      {valueText(value)}
                    </span>
                  </div>
                ))
              ) : (
                <p className="p-4 text-sm text-slate-500">No vertical attributes.</p>
              )}
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Raw source
            </h3>
            <pre className="overflow-x-auto rounded-lg bg-slate-950 p-4 text-xs leading-5 text-slate-300">
              {JSON.stringify(
                {
                  source_tab: deal.source_tab,
                  source_row: deal.source_row,
                  stage_raw: deal.stage_raw,
                  attributes_raw: rawAttributes,
                },
                null,
                2,
              )}
            </pre>
            {extracted ? (
              <pre className="overflow-x-auto rounded-lg border border-violet-200 bg-violet-50 p-4 text-xs leading-5 text-violet-950">
                {JSON.stringify(extracted, null, 2)}
              </pre>
            ) : null}
          </section>

          <section>
            <h3 className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
              <History className="size-4" />
              History
            </h3>
            {historyError ? (
              <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {historyError}
              </p>
            ) : history.length ? (
              <ol className="space-y-4">
                {history.map((entry) => (
                  <li className="relative border-l border-slate-200 pl-5" key={entry.id}>
                    <span className="absolute -left-1.5 top-1 size-3 rounded-full border-2 border-white bg-slate-400" />
                    <p className="text-sm font-medium text-slate-800">
                      {entry.field.replaceAll("_", " ")}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      {valueText(entry.old_value)} → {valueText(entry.new_value)}
                    </p>
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-400">
                      <CalendarDays className="size-3" />
                      {fmtDate(entry.changed_at, "MMM d, yyyy h:mm a")}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-slate-500">No history yet.</p>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
