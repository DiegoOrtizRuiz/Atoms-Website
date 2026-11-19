"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  ValidationModule,
  type CellValueChangedEvent,
  type ColDef,
  type GridApi,
  type ICellRendererParams,
  type ValueFormatterParams,
} from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import { CircleAlert, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import type { CurrentUser } from "@/lib/auth";
import type { Json } from "@/lib/database.types";
import {
  canEditDeal,
  dealFieldValue,
  dealStages,
  jsonObject,
  type Deal,
  type VerticalConfig,
} from "@/lib/deals";
import { fmtDate, fmtMoney, fmtNumber, fmtOrDash } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import {
  confirmDealField,
  setDealAssumption,
  updateDeal,
} from "./actions";
import { DealDrawer } from "./deal-drawer";
import {
  FilterControls,
  type DealFilters,
} from "./filter-controls";
import { ProvenanceCell, type CellActionContext } from "./provenance-cell";

ModuleRegistry.registerModules([AllCommunityModule, ValidationModule]);

type PresenceMember = {
  id: string;
  name: string;
  initials: string;
};

function unique(values: (string | null)[]) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function money(value: unknown, decimals = 0) {
  return fmtMoney(value as number | string | null, {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  });
}

export function OperationsWorkspace({
  initialDeals,
  initialConfigs,
  initialFilters,
  user,
}: {
  initialDeals: Deal[];
  initialConfigs: VerticalConfig[];
  initialFilters: DealFilters;
  user: CurrentUser;
}) {
  const router = useRouter();
  const [deals, setDeals] = useState(initialDeals);
  const [filters, setFilters] = useState(initialFilters);
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [online, setOnline] = useState<PresenceMember[]>([]);
  const [changedRows, setChangedRows] = useState<Set<string>>(new Set());
  const gridApi = useRef<GridApi<Deal> | null>(null);
  const dealsRef = useRef(initialDeals);

  useEffect(() => {
    dealsRef.current = deals;
  }, [deals]);

  const configsByVertical = useMemo(
    () => new Map(initialConfigs.map((config) => [config.vertical, config])),
    [initialConfigs],
  );

  const options = useMemo(
    () => ({
      clients: unique(deals.map((deal) => deal.client)),
      verticals: unique(deals.map((deal) => deal.vertical)),
      markets: unique(deals.map((deal) => deal.market)),
      stages: dealStages,
    }),
    [deals],
  );

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const deal of deals) counts[deal.stage] = (counts[deal.stage] ?? 0) + 1;
    return counts;
  }, [deals]);

  const filteredDeals = useMemo(
    () =>
      deals.filter((deal) => {
        if (filters.clients.length && !filters.clients.includes(deal.client ?? "")) return false;
        if (filters.verticals.length && !filters.verticals.includes(deal.vertical ?? "")) return false;
        if (filters.markets.length && !filters.markets.includes(deal.market ?? "")) return false;
        if (filters.stages.length && !filters.stages.includes(deal.stage)) return false;
        if (filters.needsReview && !deal.needs_review) return false;
        if (
          filters.hasAssumptions &&
          !Object.values(jsonObject(deal.field_provenance)).some(
            (status) => status === "assumed" || status === "llm_suggested",
          )
        ) {
          return false;
        }
        return true;
      }),
    [deals, filters],
  );

  const replaceDeal = useCallback((deal: Deal) => {
    setDeals((rows) => rows.map((row) => (row.id === deal.id ? deal : row)));
    setSelectedDeal((selected) => (selected?.id === deal.id ? deal : selected));
    gridApi.current?.applyTransactionAsync({ update: [deal] });
  }, []);

  const handleMutation = useCallback(
    async (
      deal: Deal,
      action: () => Promise<{ conflict: boolean; deal: Deal }>,
    ) => {
      const result = await action();
      replaceDeal(result.deal);
      if (result.conflict) {
        toast.error("Someone else edited this deal — reloaded");
      }
    },
    [replaceDeal],
  );

  const markAssumption = useCallback(
    async (deal: Deal, field: string) => {
      await handleMutation(deal, () =>
        setDealAssumption({ dealId: deal.id, version: deal.version, field }),
      );
    },
    [handleMutation],
  );

  const confirmField = useCallback(
    async (deal: Deal, field: string) => {
      await handleMutation(deal, () =>
        confirmDealField({ dealId: deal.id, version: deal.version, field }),
      );
      toast.success("Value confirmed");
    },
    [handleMutation],
  );

  const setFiltersAndUrl = useCallback(
    (next: DealFilters) => {
      setFilters(next);
      const params = new URLSearchParams();
      if (next.clients.length) params.set("client", next.clients.join(","));
      if (next.verticals.length) params.set("vertical", next.verticals.join(","));
      if (next.markets.length) params.set("market", next.markets.join(","));
      if (next.stages.length) params.set("stage", next.stages.join(","));
      if (next.needsReview) params.set("needsReview", "true");
      if (next.hasAssumptions) params.set("assumptions", "true");
      const query = params.toString();
      router.replace(query ? `/deals?${query}` : "/deals", { scroll: false });
    },
    [router],
  );

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("deals-operations", {
        config: { presence: { key: user.id } },
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "deals" },
        (payload) => {
          const incoming = payload.new as Deal | undefined;
          if (!incoming || incoming.updated_by === user.id) return;
          replaceDeal(incoming);
          setChangedRows((current) => new Set(current).add(incoming.id));
          window.setTimeout(() => {
            setChangedRows((current) => {
              const next = new Set(current);
              next.delete(incoming.id);
              return next;
            });
          }, 2200);
        },
      )
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<PresenceMember>();
        const members = Object.values(state)
          .flat()
          .filter(
            (member, index, list) =>
              list.findIndex((candidate) => candidate.id === member.id) === index,
          );
        setOnline(members);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel.track({
            id: user.id,
            name: user.fullName,
            initials: initials(user.fullName),
          });
        }
      });

    const pollingInterval = window.setInterval(async () => {
      const { data, error } = await supabase
        .from("deals")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error || !data) return;

      const previous = new Map(dealsRef.current.map((deal) => [deal.id, deal]));
      const externallyChanged = data
        .filter((deal) => {
          const old = previous.get(deal.id);
          return (
            old &&
            deal.version > old.version &&
            deal.updated_by !== user.id
          );
        })
        .map((deal) => deal.id);
      if (externallyChanged.length) {
        setDeals(data);
        setChangedRows((current) => new Set([...current, ...externallyChanged]));
        window.setTimeout(() => {
          setChangedRows((current) => {
            const next = new Set(current);
            externallyChanged.forEach((id) => next.delete(id));
            return next;
          });
        }, 2200);
      }
    }, 5000);

    return () => {
      window.clearInterval(pollingInterval);
      void supabase.removeChannel(channel);
    };
  }, [replaceDeal, user.fullName, user.id]);

  const handleCellChange = useCallback(
    async (event: CellValueChangedEvent<Deal>) => {
      const field = event.colDef.field ?? event.colDef.colId;
      if (!event.data || !field) return;
      try {
        const result = await updateDeal({
          dealId: event.data.id,
          version: event.data.version,
          field,
          value: event.newValue as string | number | boolean | null,
        });
        replaceDeal(result.deal);
        if (result.conflict) {
          toast.error("Someone else edited this deal — reloaded");
        } else {
          toast.success("Deal saved");
        }
      } catch (error) {
        const oldDeal = await import("./actions").then(({ reloadDeal }) =>
          reloadDeal(event.data!.id),
        );
        replaceDeal(oldDeal);
        toast.error(error instanceof Error ? error.message : "Unable to save deal.");
      }
    },
    [replaceDeal],
  );

  const baseColumns = useMemo<ColDef<Deal>[]>(() => {
    const editable = (deal: Deal) => canEditDeal(user, deal);
    const editableNumeric: ColDef<Deal> = {
      editable: ({ data }) => Boolean(data && editable(data)),
      cellEditor: "agNumberCellEditor",
      valueParser: ({ newValue }) =>
        newValue === "" || newValue == null ? null : Number(newValue),
    };
    const provenanceParams = { context: { user, markAssumption, confirmField } };
    return [
      { field: "vertical", minWidth: 145, cellRenderer: ProvenanceCell },
      { field: "client", minWidth: 115, cellRenderer: ProvenanceCell },
      { field: "market", minWidth: 120, cellRenderer: ProvenanceCell },
      {
        headerName: "Address",
        field: "address",
        minWidth: 210,
        flex: 1.2,
        tooltipValueGetter: ({ data }) =>
          data ? [data.address, data.city, data.state].filter(Boolean).join(", ") : "",
        cellRenderer: (params: { data?: Deal; context: CellActionContext }) => {
          const deal = params.data;
          if (!deal) return "—";
          return (
            <button
              className="flex h-full w-full flex-col justify-center text-left leading-tight"
              onClick={(event) => {
                event.stopPropagation();
                params.context.onSelectDeal(deal);
              }}
              type="button"
            >
              <span className="truncate font-medium">{fmtOrDash(deal.address)}</span>
              <span className="truncate text-[11px] text-slate-400">
                {[deal.city, deal.state].filter(Boolean).join(", ") || "—"}
              </span>
            </button>
          );
        },
      },
      {
        field: "stage",
        minWidth: 150,
        editable: ({ data }) => Boolean(data && editable(data)),
        cellEditor: "agSelectCellEditor",
        cellEditorParams: { values: dealStages },
        tooltipValueGetter: ({ data }) =>
          data?.stage_raw && data.stage_raw !== data.stage ? `Source: ${data.stage_raw}` : "",
        cellRenderer: (params: ICellRendererParams<Deal>) => {
          const value = params.value ?? "Needs review";
          const colors: Record<string, string> = {
            Sourcing: "bg-slate-100 text-slate-700",
            "In Pipeline": "bg-sky-100 text-sky-800",
            "Pre LOI": "bg-cyan-100 text-cyan-800",
            "Negotiating LOI": "bg-indigo-100 text-indigo-800",
            "Negotiating PSA": "bg-violet-100 text-violet-800",
            "In Contract": "bg-amber-100 text-amber-800",
            Closed: "bg-emerald-100 text-emerald-800",
            "On Hold": "bg-zinc-200 text-zinc-700",
            "Needs review": "bg-red-100 text-red-800",
          };
          return (
            <ProvenanceCell
              {...params}
              displayValue={<Badge className={colors[value]}>{value}</Badge>}
            />
          );
        },
      },
      {
        field: "bldg_sf",
        headerName: "Bldg SF",
        width: 115,
        ...editableNumeric,
        valueFormatter: ({ value }) => fmtNumber(value),
        cellRenderer: ProvenanceCell,
        cellRendererParams: { ...provenanceParams },
      },
      {
        field: "list_price",
        headerName: "List price",
        width: 135,
        ...editableNumeric,
        valueFormatter: ({ value }) => money(value),
        cellRenderer: ProvenanceCell,
        cellRendererParams: { ...provenanceParams },
      },
      {
        field: "price_per_sf",
        headerName: "$/SF",
        width: 105,
        valueFormatter: ({ value }) => money(value, 2),
      },
      {
        field: "lot_sf",
        headerName: "Lot SF",
        width: 115,
        ...editableNumeric,
        valueFormatter: ({ value }) => fmtNumber(value),
        cellRenderer: ProvenanceCell,
      },
      {
        field: "broker",
        width: 135,
        editable: ({ data }) => Boolean(data && editable(data)),
        cellRenderer: ProvenanceCell,
      },
      {
        field: "notes",
        minWidth: 190,
        flex: 1,
        editable: ({ data }) => Boolean(data && editable(data)),
        tooltipValueGetter: ({ value }) => fmtOrDash(value),
        cellRenderer: ProvenanceCell,
      },
      {
        field: "broker_phone",
        headerName: "Broker phone",
        width: 145,
        editable: ({ data }) => Boolean(data && editable(data)),
        cellRenderer: ProvenanceCell,
      },
      {
        field: "weekly_note",
        headerName: "Weekly note",
        minWidth: 190,
        editable: ({ data }) => Boolean(data && editable(data)),
        tooltipValueGetter: ({ value }) => fmtOrDash(value),
        cellRenderer: ProvenanceCell,
      },
      {
        field: "show_in_weekly",
        headerName: "Weekly",
        width: 100,
        editable: ({ data }) => Boolean(data && editable(data)),
        cellEditor: "agCheckboxCellEditor",
        cellRenderer: (params: ICellRendererParams<Deal>) => (
          <ProvenanceCell
            {...params}
            displayValue={params.value ? "Yes" : "No"}
          />
        ),
      },
      {
        field: "updated_at",
        headerName: "Updated",
        width: 145,
        valueFormatter: ({ value }) => fmtDate(value, "MMM d, h:mm a"),
      },
    ];
  }, [confirmField, markAssumption, user]);

  const columns = useMemo<ColDef<Deal>[]>(() => {
    if (filters.verticals.length !== 1) return baseColumns;
    const config = configsByVertical.get(filters.verticals[0]);
    const rawColumns = Array.isArray(config?.columns)
      ? (config.columns as unknown[])
      : [];
    const dynamicColumns: ColDef<Deal>[] = rawColumns.flatMap((raw) => {
      if (!raw || typeof raw !== "object") return [];
      const definition = raw as { key?: unknown; label?: unknown; type?: unknown };
      if (typeof definition.key !== "string") return [];
      const field = `attributes.${definition.key}`;
      const moneyColumn = definition.type === "money";
      return [{
        headerName:
          typeof definition.label === "string" ? definition.label : definition.key,
        colId: field,
        minWidth: 125,
        valueGetter: ({ data }: { data?: Deal }) =>
          data ? dealFieldValue(data, field) : undefined,
        valueSetter: ({ data, newValue }) => {
          data.attributes = {
            ...jsonObject(data.attributes),
            [definition.key as string]: newValue as Json,
          };
          return true;
        },
        editable: ({ data }: { data?: Deal }) => Boolean(data && canEditDeal(user, data)),
        onCellValueChanged: undefined,
        valueFormatter: (params: ValueFormatterParams<Deal>) =>
          moneyColumn
            ? money(params.value, 2)
            : definition.type === "number"
              ? fmtNumber(params.value as number | string | null)
              : fmtOrDash(params.value),
        cellRenderer: ProvenanceCell,
      }];
    });
    return [...baseColumns, ...dynamicColumns];
  }, [baseColumns, configsByVertical, filters.verticals, user]);

  const gridContext: CellActionContext = {
    user,
    markAssumption,
    confirmField,
    onSelectDeal: (deal) => {
      setSelectedDeal(deal);
      setDrawerOpen(true);
    },
  };

  const reviewCount = deals.filter((deal) => deal.needs_review).length;

  return (
    <div className="flex min-h-screen flex-col">
      <PageHeader
        title="Operations"
        description="Filter, review, and edit every acquisition opportunity in one live pipeline."
      >
        <div className="flex items-center gap-3">
          {reviewCount ? (
            <button
              className="flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800"
              onClick={() =>
                setFiltersAndUrl({ ...filters, needsReview: true })
              }
              type="button"
            >
              <CircleAlert className="size-3.5" />
              {reviewCount} need review
            </button>
          ) : null}
          <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5">
            <Users className="size-3.5 text-emerald-600" />
            <div className="flex -space-x-1.5">
              {online.slice(0, 4).map((member) => (
                <span
                  className="grid size-6 place-items-center rounded-full border-2 border-white bg-slate-800 text-[9px] font-semibold text-white"
                  key={member.id}
                  title={member.name}
                >
                  {member.initials}
                </span>
              ))}
            </div>
            <span className="text-xs font-medium text-slate-600">
              {online.length} online
            </span>
          </div>
        </div>
      </PageHeader>

      <FilterControls
        filters={filters}
        onChange={setFiltersAndUrl}
        options={options}
        stageCounts={stageCounts}
      />

      <div className="flex-1 p-4 lg:p-6">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-xs text-slate-500">
              <strong className="font-semibold text-slate-700">
                {filteredDeals.length}
              </strong>{" "}
              of {deals.length} deals
            </p>
            <div className="flex items-center gap-4 text-[11px] text-slate-400">
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-amber-500" /> Assumed
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-violet-500" /> LLM suggested
              </span>
            </div>
          </div>
          <div className="ag-theme-quartz h-[calc(100vh-330px)] min-h-[480px] w-full">
            <AgGridReact<Deal>
              animateRows
              columnDefs={columns}
              context={gridContext}
              defaultColDef={{
                resizable: true,
                sortable: true,
                tooltipComponent: undefined,
              }}
              enableCellTextSelection
              getRowClass={({ data }) =>
                data && changedRows.has(data.id) ? "remote-deal-change" : undefined
              }
              getRowId={({ data }) => data.id}
              onCellValueChanged={handleCellChange}
              onGridReady={({ api }) => {
                gridApi.current = api;
              }}
              onGridPreDestroyed={() => {
                gridApi.current = null;
              }}
              rowData={filteredDeals}
              rowHeight={52}
              suppressCellFocus={false}
              theme="legacy"
            />
          </div>
        </div>
      </div>

      <DealDrawer
        deal={selectedDeal}
        onOpenChange={setDrawerOpen}
        open={drawerOpen}
      />
      <style jsx global>{`
        .ag-theme-quartz .remote-deal-change .ag-cell {
          animation: remote-deal-pulse 2.2s ease-out;
        }
        @keyframes remote-deal-pulse {
          0%, 25% { background-color: rgb(207 250 254); }
          100% { background-color: transparent; }
        }
      `}</style>
    </div>
  );
}
