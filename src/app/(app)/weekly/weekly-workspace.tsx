"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  Eye,
  Maximize2,
  Plus,
  Save,
  X,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { CurrentUser } from "@/lib/auth";
import type { Json } from "@/lib/database.types";
import { isUnconfirmed, type Deal, type DealHistory, type VerticalConfig } from "@/lib/deals";
import { fmtMoney, fmtNumber, fmtOrDash } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import {
  buildWeeklyModel,
  compareSnapshots,
  weeklySnapshotPayload,
  type WeeklyRow,
  type WeeklySection,
} from "@/lib/weekly";
import { saveWeeklySnapshot } from "./actions";

type Snapshot = {
  id: number;
  week_start: string;
  created_at: string;
  data: Json;
};

function compactMoney(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return fmtMoney(value);
}

function statusClass(status: string) {
  if (status === "Closed") return "bg-emerald-100 text-emerald-800";
  if (status === "Needs review") return "bg-red-100 text-red-800";
  if (status === "On Hold") return "bg-slate-200 text-slate-700";
  if (status === "In Contract") return "bg-amber-100 text-amber-800";
  if (status.includes("PSA")) return "bg-violet-100 text-violet-800";
  if (status.includes("LOI")) return "bg-indigo-100 text-indigo-800";
  return "bg-cyan-100 text-cyan-800";
}

function WeeklyCell({
  row,
  field,
  children,
  className = "",
}: {
  row: WeeklyRow;
  field: string;
  children: React.ReactNode;
  className?: string;
}) {
  const provenance = row.fieldProvenance[field];
  const highlighted = isUnconfirmed(provenance);
  return (
    <span
      className={`${className} ${
        highlighted ? "italic font-medium text-slate-800" : ""
      }`}
      title={
        provenance === "assumed"
          ? "Assumption — not yet confirmed"
          : provenance === "llm_suggested"
            ? "LLM suggestion — review before confirming"
            : undefined
      }
    >
      {highlighted ? (
        <span
          className={`mr-1.5 inline-block size-1.5 rounded-full align-middle ${
            provenance === "assumed" ? "bg-amber-500" : "bg-violet-500"
          }`}
        />
      ) : null}
      {children}
    </span>
  );
}

function WeeklySectionTable({
  section,
  differences,
  presentation = false,
}: {
  section: WeeklySection;
  differences: Record<string, "new" | "moved" | "removed">;
  presentation?: boolean;
}) {
  return (
    <section className={presentation ? "h-full" : "overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"}>
      {!presentation ? (
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {section.vertical}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {section.rows.length} {section.rows.length === 1 ? "deal" : "deals"} in review
            </p>
          </div>
          <div className="hidden flex-wrap justify-end gap-1.5 sm:flex">
            {Object.entries(section.counts).map(([stage, count]) => (
              <Badge className={statusClass(stage)} key={stage}>
                {count} {stage}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className={`w-full border-collapse text-left ${presentation ? "text-xl" : "text-sm"}`}>
          <thead className="bg-slate-950 text-white">
            <tr>
              {["Market", "Address", "Status", "$", "SF", "$/SF", "Lot size", "Notes"].map(
                (header) => (
                  <th
                    className={`whitespace-nowrap px-4 font-medium ${
                      presentation ? "py-5 text-base" : "py-3 text-[11px] uppercase tracking-wider"
                    }`}
                    key={header}
                  >
                    {header}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {section.rows.map((row) => (
              <tr className="bg-white align-top hover:bg-slate-50" key={row.id}>
                <td className={`whitespace-nowrap px-4 ${presentation ? "py-6" : "py-4"}`}>
                  <WeeklyCell row={row} field="market">
                    {fmtOrDash(row.market)}
                  </WeeklyCell>
                </td>
                <td className={`min-w-52 px-4 ${presentation ? "py-6" : "py-4"}`}>
                  <div className="flex items-start gap-2">
                    <div>
                      <WeeklyCell row={row} field="address">
                        <span className="font-semibold text-slate-900">
                          {fmtOrDash(row.address)}
                        </span>
                      </WeeklyCell>
                      <p className="mt-1 text-xs text-slate-400">
                        {fmtOrDash(row.location)}
                      </p>
                    </div>
                    {differences[row.id] ? (
                      <Badge
                        className={
                          differences[row.id] === "new"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-cyan-100 text-cyan-800"
                        }
                      >
                        {differences[row.id]}
                      </Badge>
                    ) : null}
                  </div>
                </td>
                <td className={`px-4 ${presentation ? "py-6" : "py-4"}`}>
                  <WeeklyCell row={row} field="stage">
                    <Badge className={statusClass(row.stage)}>{row.stage}</Badge>
                  </WeeklyCell>
                  {row.stageRaw && row.stageRaw !== row.stage ? (
                    <p className="mt-1 text-[10px] text-slate-400">
                      Source: {row.stageRaw}
                    </p>
                  ) : null}
                </td>
                <td className={`whitespace-nowrap px-4 font-medium ${presentation ? "py-6" : "py-4"}`}>
                  <WeeklyCell row={row} field="list_price">
                    {compactMoney(row.listPrice)}
                  </WeeklyCell>
                </td>
                <td className={`whitespace-nowrap px-4 ${presentation ? "py-6" : "py-4"}`}>
                  <WeeklyCell row={row} field="bldg_sf">
                    {fmtNumber(row.buildingSf)}
                  </WeeklyCell>
                </td>
                <td className={`whitespace-nowrap px-4 ${presentation ? "py-6" : "py-4"}`}>
                  {row.pricePerSf == null ? "—" : `$${fmtNumber(row.pricePerSf)}/SF`}
                </td>
                <td className={`whitespace-nowrap px-4 ${presentation ? "py-6" : "py-4"}`}>
                  <WeeklyCell row={row} field="lot_sf">
                    {fmtNumber(row.lotSf)}
                  </WeeklyCell>
                </td>
                <td className={`min-w-72 px-4 leading-6 text-slate-600 ${presentation ? "py-6" : "py-4"}`}>
                  <WeeklyCell row={row} field={row.notesField}>
                    {fmtOrDash(row.notes)}
                  </WeeklyCell>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function WeeklyWorkspace({
  initialDeals,
  initialConfigs,
  initialHistory,
  initialSnapshot,
  user,
}: {
  initialDeals: Deal[];
  initialConfigs: VerticalConfig[];
  initialHistory: DealHistory[];
  initialSnapshot: Snapshot | null;
  user: CurrentUser;
}) {
  const [deals, setDeals] = useState(initialDeals);
  const [history, setHistory] = useState(initialHistory);
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [showAll, setShowAll] = useState(false);
  const [compare, setCompare] = useState(false);
  const [presentation, setPresentation] = useState(false);
  const [slide, setSlide] = useState(0);
  const [asOf, setAsOf] = useState(new Date());
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const pollingRef = useRef<number | null>(null);
  const dealsRef = useRef(initialDeals);

  useEffect(() => {
    dealsRef.current = deals;
  }, [deals]);

  const model = useMemo(
    () => buildWeeklyModel(deals, initialConfigs, history, showAll, asOf),
    [asOf, deals, history, initialConfigs, showAll],
  );
  const differences = useMemo(
    () => (compare && snapshot ? compareSnapshots(model, snapshot.data) : {}),
    [compare, model, snapshot],
  );

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("weekly-review")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "deals" },
        (payload) => {
          if (!payload.new) return;
          const incoming = payload.new as Deal;
          setDeals((rows) =>
            rows.map((row) => (row.id === incoming.id ? incoming : row)),
          );
          setAsOf(new Date());
        },
      )
      .subscribe();

    pollingRef.current = window.setInterval(async () => {
      const [{ data: nextDeals }, { data: nextHistory }] = await Promise.all([
        supabase.from("deals").select("*").order("updated_at", { ascending: false }),
        supabase
          .from("deal_history")
          .select("*")
          .gte("changed_at", new Date(Date.now() - 30 * 86400000).toISOString())
          .order("changed_at", { ascending: false }),
      ]);
      if (nextDeals) {
        const changed = JSON.stringify(nextDeals) !== JSON.stringify(dealsRef.current);
        setDeals(nextDeals);
        if (changed) setAsOf(new Date());
      }
      if (nextHistory) setHistory(nextHistory);
    }, 5000);

    return () => {
      if (pollingRef.current) window.clearInterval(pollingRef.current);
      void supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (!presentation) return;
    document.documentElement.requestFullscreen?.().catch(() => undefined);
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPresentation(false);
      if (event.key === "ArrowRight" || event.key === " ") {
        event.preventDefault();
        setSlide((current) => Math.min(model.sections.length - 1, current + 1));
      }
      if (event.key === "ArrowLeft") {
        setSlide((current) => Math.max(0, current - 1));
      }
    };
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("keydown", keydown);
      if (document.fullscreenElement) void document.exitFullscreen();
    };
  }, [model.sections.length, presentation]);

  const saveSnapshot = async () => {
    setSaving(true);
    try {
      const saved = await saveWeeklySnapshot({
        weekStart: model.weekStart,
        data: weeklySnapshotPayload(model),
      });
      setSnapshot(saved);
      toast.success("Weekly snapshot saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save snapshot.");
    } finally {
      setSaving(false);
    }
  };

  const exportPptx = async () => {
    setExporting(true);
    try {
      const { exportWeeklyPptx } = await import("./pptx");
      await exportWeeklyPptx(model);
      toast.success("PPTX exported");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to export PPTX.");
    } finally {
      setExporting(false);
    }
  };

  if (presentation) {
    const section = model.sections[slide];
    return (
      <div className="fixed inset-0 z-50 overflow-auto bg-slate-100 p-10 text-slate-950">
        <div className="mx-auto flex h-full min-h-[720px] max-w-[1800px] flex-col">
          <header className="mb-8 flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-700">
                Pipeline review · {model.weekStart}
              </p>
              <h1 className="mt-2 text-5xl font-semibold tracking-tight">
                {section?.vertical ?? "Weekly review"}
              </h1>
            </div>
            <Button onClick={() => setPresentation(false)} size="lg" variant="outline">
              <X className="size-4" />
              Exit
            </Button>
          </header>
          <div className="flex-1 rounded-2xl border bg-white p-1 shadow-xl">
            {section ? (
              <WeeklySectionTable
                differences={differences}
                presentation
                section={section}
              />
            ) : null}
          </div>
          <footer className="mt-6 flex items-center justify-between">
            <Button
              disabled={slide === 0}
              onClick={() => setSlide((current) => current - 1)}
              variant="outline"
            >
              <ArrowLeft className="size-4" />
              Previous
            </Button>
            <p className="text-sm text-slate-500">
              {slide + 1} / {model.sections.length} · Arrow keys or space to advance
            </p>
            <Button
              disabled={slide === model.sections.length - 1}
              onClick={() => setSlide((current) => current + 1)}
            >
              Next
              <ArrowRight className="size-4" />
            </Button>
          </footer>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white px-6 py-7 lg:px-10">
        <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-700">
              Acquisitions workspace
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
              Pipeline Review
            </h1>
            <p className="mt-1.5 text-sm text-slate-500">
              Week of {format(parseISO(model.weekStart), "MMMM d, yyyy")} · as of{" "}
              {format(asOf, "HH:mm")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setCompare((value) => !value)} variant={compare ? "default" : "outline"}>
              <Eye className="size-4" />
              Compare to snapshot
            </Button>
            {(user.role === "admin" || user.role === "leadership") ? (
              <Button disabled={saving} onClick={saveSnapshot} variant="outline">
                <Save className="size-4" />
                {saving ? "Saving…" : "Save snapshot"}
              </Button>
            ) : null}
            <Button disabled={exporting} onClick={exportPptx} variant="outline">
              <Download className="size-4" />
              {exporting ? "Exporting…" : "Export PPTX"}
            </Button>
            <Button
              onClick={() => {
                setSlide(0);
                setPresentation(true);
              }}
            >
              <Maximize2 className="size-4" />
              Present
            </Button>
          </div>
        </div>
      </header>

      <main className="space-y-7 px-6 py-7 lg:px-10">
        <section className="grid gap-3 md:grid-cols-3">
          {model.sections.map((section) => (
            <Card className="border-slate-200 shadow-sm" key={section.vertical}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      {section.vertical}
                    </p>
                    <p className="mt-2 text-3xl font-semibold text-slate-950">
                      {section.rows.length}
                    </p>
                    <p className="text-xs text-slate-500">deals in review</p>
                  </div>
                  <span className="grid size-9 place-items-center rounded-full bg-cyan-50 text-cyan-700">
                    <Check className="size-4" />
                  </span>
                </div>
                <div className="mt-5 flex flex-wrap gap-1.5">
                  {Object.entries(section.counts).map(([stage, count]) => (
                    <Badge className={`${statusClass(stage)} text-[10px]`} key={stage}>
                      {count} {stage}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <div className="flex items-center gap-2 text-amber-900">
            <AlertTriangle className="size-4" />
            <h2 className="text-sm font-semibold">Needs attention this week</h2>
          </div>
          {model.attention.length ? (
            <div className="mt-4 grid gap-2 lg:grid-cols-2">
              {model.attention.map((item) => (
                <div
                  className="flex items-center justify-between gap-4 rounded-lg border border-amber-200/70 bg-white/70 px-4 py-3"
                  key={item.id}
                >
                  <span className="text-sm font-medium text-slate-800">
                    {item.label}
                  </span>
                  <span className="truncate text-xs text-slate-500">{item.detail}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-amber-800">
              No stage moves, new deals, or key dates in the current window.
            </p>
          )}
        </section>

        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Weekly pipeline</h2>
            <p className="text-sm text-slate-500">
              Most advanced stages first, grouped by vertical.
            </p>
          </div>
          <Button onClick={() => setShowAll((value) => !value)} variant="outline">
            {showAll ? <Check className="size-4" /> : <Plus className="size-4" />}
            {showAll ? "Showing all deals" : "Show all deals"}
          </Button>
        </div>

        {model.sections.map((section) => (
          <WeeklySectionTable
            differences={differences}
            key={section.vertical}
            section={section}
          />
        ))}

        {compare && !snapshot ? (
          <p className="text-center text-sm text-slate-500">
            No snapshot exists yet. Save one to enable comparison.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-center gap-5 pb-4 text-xs text-slate-500">
          <span className="flex items-center gap-2 italic">
            <span className="size-1.5 rounded-full bg-amber-500" />
            Assumption — not yet confirmed
          </span>
          <span className="flex items-center gap-2 italic">
            <span className="size-1.5 rounded-full bg-violet-500" />
            LLM suggestion — review before confirming
          </span>
        </div>
      </main>
    </div>
  );
}
