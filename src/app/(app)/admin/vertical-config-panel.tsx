"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Json } from "@/lib/database.types";
import { fmtDate, fmtNumber } from "@/lib/format";
import type { Database } from "@/lib/database.types";
import {
  addVerticalConfig,
  reorderVerticalConfigs,
  saveSourceTab,
  saveVerticalConfig,
} from "./actions";

type VerticalConfig = Database["public"]["Tables"]["vertical_config"]["Row"];
type SourceTab = Database["public"]["Tables"]["source_tabs"]["Row"];
type ColumnType = "number" | "string" | "boolean";
type AttributeColumn = { key: string; label: string; type: ColumnType };
type VerticalDraft = {
  tabPrefix: string;
  vertical: string;
  description: string;
  active: boolean;
  columns: AttributeColumn[];
  isNew: boolean;
};

const columnTypes: ColumnType[] = ["string", "number", "boolean"];

function isColumnType(value: string): value is ColumnType {
  return columnTypes.some((type) => type === value);
}

function isRecord(value: Json): value is { [key: string]: Json | undefined } {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readColumns(value: Json): AttributeColumn[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || Array.isArray(item) || !isRecord(item)) return [];
    const { key, label, type } = item;
    if (
      typeof key !== "string" ||
      typeof label !== "string" ||
      typeof type !== "string" ||
      !isColumnType(type)
    ) {
      return [];
    }
    return [{ key, label, type }];
  });
}

function move<T>(items: T[], index: number, offset: number) {
  const target = index + offset;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function columnCount(counts: Record<string, number>, key: string) {
  return counts[key] ?? 0;
}

export function VerticalConfigPanel({
  attributeValueCounts,
  sourceTabs,
  verticalConfigs,
}: {
  attributeValueCounts: Record<string, Record<string, number>>;
  sourceTabs: SourceTab[];
  verticalConfigs: VerticalConfig[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<VerticalDraft | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [savingTab, setSavingTab] = useState<string | null>(null);
  const [tabEdits, setTabEdits] = useState<Record<string, SourceTab>>({});
  const [newVerticalOrder, setNewVerticalOrder] = useState(10);

  function beginEdit(config: VerticalConfig) {
    setDraft({
      tabPrefix: config.tab_prefix,
      vertical: config.vertical,
      description: config.description ?? "",
      active: config.active,
      columns: readColumns(config.columns),
      isNew: false,
    });
  }

  function beginAdd() {
    const nextOrder = Math.max(0, ...verticalConfigs.map((item) => item.sort_order)) + 10;
    setNewVerticalOrder(nextOrder);
    setDraft({
      tabPrefix: "",
      vertical: "",
      description: "",
      active: true,
      columns: [],
      isNew: true,
    });
  }

  function changeColumn(index: number, field: keyof AttributeColumn, value: string) {
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        columns: current.columns.map((column, columnIndex) => {
          if (columnIndex !== index) return column;
          if (field === "key") return { ...column, key: value };
          if (field === "label") return { ...column, label: value };
          return isColumnType(value) ? { ...column, type: value } : column;
        }),
      };
    });
  }

  async function saveDraft() {
    if (!draft) return;
    setSavingDraft(true);
    try {
      const input = {
        tabPrefix: draft.tabPrefix,
        vertical: draft.vertical,
        description: draft.description,
        active: draft.active,
        columns: draft.columns,
      };
      if (draft.isNew) {
        await addVerticalConfig({ ...input, sortOrder: newVerticalOrder });
      } else {
        await saveVerticalConfig(input);
      }
      toast.success(draft.isNew ? "Vertical added" : "Vertical settings saved");
      setDraft(null);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save vertical settings.");
    } finally {
      setSavingDraft(false);
    }
  }

  async function saveTab(tab: SourceTab) {
    const edited = tabEdits[tab.tab_name] ?? tab;
    setSavingTab(tab.tab_name);
    try {
      await saveSourceTab({
        tabName: edited.tab_name,
        tabPrefix: edited.tab_prefix,
        client: edited.client,
        market: edited.market,
        active: edited.active,
      });
      toast.success(`Saved ${tab.tab_name}`);
      setTabEdits((current) => {
        const next = { ...current };
        delete next[tab.tab_name];
        return next;
      });
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save source tab.");
    } finally {
      setSavingTab(null);
    }
  }

  async function reorder(index: number, offset: number) {
    const ordered = move(verticalConfigs, index, offset);
    try {
      await reorderVerticalConfigs(ordered.map((item) => item.tab_prefix));
      toast.success("Vertical order saved");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to reorder verticals.");
    }
  }

  function updateTab(tab: SourceTab, change: Partial<SourceTab>) {
    setTabEdits((current) => ({
      ...current,
      [tab.tab_name]: { ...(current[tab.tab_name] ?? tab), ...change },
    }));
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>Verticals</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              This order controls Weekly Review and Rollup.
            </p>
          </div>
          <Button onClick={beginAdd}>Add vertical</Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="p-2 font-medium">Order</th>
                <th className="p-2 font-medium">Vertical</th>
                <th className="p-2 font-medium">Tab prefix</th>
                <th className="p-2 font-medium">Status</th>
                <th className="p-2 font-medium">Attributes</th>
                <th className="p-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {verticalConfigs.map((config, index) => {
                const columns = readColumns(config.columns);
                return (
                  <tr className="border-b last:border-0" key={config.tab_prefix}>
                    <td className="p-2">
                      <div className="flex gap-1">
                        <Button
                          aria-label={`Move ${config.vertical} up`}
                          disabled={index === 0}
                          onClick={() => reorder(index, -1)}
                          size="sm"
                          variant="outline"
                        >↑</Button>
                        <Button
                          aria-label={`Move ${config.vertical} down`}
                          disabled={index === verticalConfigs.length - 1}
                          onClick={() => reorder(index, 1)}
                          size="sm"
                          variant="outline"
                        >↓</Button>
                      </div>
                    </td>
                    <td className="p-2 font-medium">{config.vertical}</td>
                    <td className="p-2 font-mono text-xs">{config.tab_prefix}</td>
                    <td className="p-2">
                      <Badge variant={config.active ? "default" : "outline"}>
                        {config.active ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                    <td className="p-2">{fmtNumber(columns.length)}</td>
                    <td className="p-2 text-right">
                      <Button onClick={() => beginEdit(config)} size="sm" variant="outline">
                        Edit
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {!verticalConfigs.length && (
                <tr><td className="p-4 text-muted-foreground" colSpan={6}>No verticals configured.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Source tabs</CardTitle>
          <p className="text-sm text-muted-foreground">
            Assign workbook tabs to a vertical, client, and market. Inactive tabs are retained in the registry.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[1040px] text-left text-sm">
            <thead>
              <tr className="border-b">
                {["Tab name", "Vertical", "Client", "Market", "Rows", "Last imported", "Active", ""].map((heading) => (
                  <th className="p-2 font-medium" key={heading}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sourceTabs.map((tab) => {
                const row = tabEdits[tab.tab_name] ?? tab;
                const unmapped = row.tab_prefix === null;
                return (
                  <tr
                    className={`border-b last:border-0 ${unmapped ? "bg-amber-50" : ""}`}
                    key={tab.tab_name}
                  >
                    <td className="p-2 font-medium">
                      {tab.tab_name}
                      {unmapped && (
                        <span className="ml-2 text-xs font-semibold text-amber-800">Assign a vertical</span>
                      )}
                    </td>
                    <td className="p-2">
                      <select
                        aria-label={`Vertical for ${tab.tab_name}`}
                        className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                        onChange={(event) => updateTab(tab, { tab_prefix: event.target.value || null })}
                        value={row.tab_prefix ?? ""}
                      >
                        <option value="">Unassigned</option>
                        {verticalConfigs.map((config) => (
                          <option key={config.tab_prefix} value={config.tab_prefix}>{config.vertical}</option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2">
                      <Input
                        aria-label={`Client for ${tab.tab_name}`}
                        onChange={(event) => updateTab(tab, { client: event.target.value || null })}
                        value={row.client ?? ""}
                      />
                    </td>
                    <td className="p-2">
                      <Input
                        aria-label={`Market for ${tab.tab_name}`}
                        onChange={(event) => updateTab(tab, { market: event.target.value || null })}
                        value={row.market ?? ""}
                      />
                    </td>
                    <td className="p-2">{row.row_count === null ? "—" : fmtNumber(row.row_count)}</td>
                    <td className="p-2">{fmtDate(row.last_imported_at, "PPpp")}</td>
                    <td className="p-2">
                      <input
                        aria-label={`${tab.tab_name} active`}
                        checked={row.active}
                        onChange={(event) => updateTab(tab, { active: event.target.checked })}
                        type="checkbox"
                      />
                    </td>
                    <td className="p-2 text-right">
                      <Button
                        disabled={savingTab === tab.tab_name}
                        onClick={() => saveTab(tab)}
                        size="sm"
                        variant="outline"
                      >
                        {savingTab === tab.tab_name ? "Saving…" : "Save"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {!sourceTabs.length && (
                <tr><td className="p-4 text-muted-foreground" colSpan={8}>No source tabs registered yet.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog onOpenChange={(open) => { if (!open) setDraft(null); }} open={Boolean(draft)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{draft?.isNew ? "Add vertical" : "Edit vertical"}</DialogTitle>
            <DialogDescription>
              Configure the vertical name, visibility, and dynamic deal attributes.
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-sm font-medium">
                  Vertical name
                  <Input
                    onChange={(event) => setDraft({ ...draft, vertical: event.target.value })}
                    value={draft.vertical}
                  />
                </label>
                <label className="grid gap-1 text-sm font-medium">
                  Stable tab prefix
                  <Input
                    disabled={!draft.isNew}
                    onChange={(event) => setDraft({ ...draft, tabPrefix: event.target.value })}
                    value={draft.tabPrefix}
                  />
                </label>
              </div>
              <label className="grid gap-1 text-sm font-medium">
                Description
                <Input
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  value={draft.description}
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  checked={draft.active}
                  onChange={(event) => setDraft({ ...draft, active: event.target.checked })}
                  type="checkbox"
                />
                Active (inactive verticals are hidden from Weekly Review and Rollup)
              </label>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">Attribute columns</h3>
                    <p className="text-xs text-muted-foreground">
                      Removing a column hides it from the grid; stored deal values are kept.
                    </p>
                  </div>
                  <Button
                    onClick={() => setDraft({ ...draft, columns: [...draft.columns, { key: "", label: "", type: "string" }] })}
                    size="sm"
                    variant="outline"
                  >
                    Add column
                  </Button>
                </div>
                <div className="space-y-2">
                  {draft.columns.map((column, index) => {
                    const count = columnCount(attributeValueCounts[draft.tabPrefix] ?? {}, column.key);
                    return (
                      <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_130px_auto_auto_auto]" key={`${index}:${column.key}`}>
                        <label className="grid gap-1 text-xs font-medium">
                          Key
                          <Input onChange={(event) => changeColumn(index, "key", event.target.value)} value={column.key} />
                        </label>
                        <label className="grid gap-1 text-xs font-medium">
                          Label
                          <Input onChange={(event) => changeColumn(index, "label", event.target.value)} value={column.label} />
                        </label>
                        <label className="grid gap-1 text-xs font-medium">
                          Type
                          <select
                            className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                            onChange={(event) => changeColumn(index, "type", event.target.value)}
                            value={column.type}
                          >
                            {columnTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                          </select>
                        </label>
                        <span className="self-end pb-2 text-xs text-muted-foreground">
                          {fmtNumber(count)} deals with a value
                        </span>
                        <Button
                          aria-label={`Move ${column.label || column.key || "column"} up`}
                          disabled={index === 0}
                          onClick={() => setDraft({ ...draft, columns: move(draft.columns, index, -1) })}
                          size="sm"
                          variant="outline"
                        >↑</Button>
                        <div className="flex gap-1">
                          <Button
                            aria-label={`Move ${column.label || column.key || "column"} down`}
                            disabled={index === draft.columns.length - 1}
                            onClick={() => setDraft({ ...draft, columns: move(draft.columns, index, 1) })}
                            size="sm"
                            variant="outline"
                          >↓</Button>
                          <Button
                            onClick={() => {
                              if (count > 0 && !window.confirm(
                                `${count} deal(s) have a value for "${column.key}". Removing this column only hides it; the values will remain stored. Continue?`,
                              )) return;
                              setDraft({ ...draft, columns: draft.columns.filter((_, columnIndex) => columnIndex !== index) });
                            }}
                            size="sm"
                            variant="destructive"
                          >Remove</Button>
                        </div>
                      </div>
                    );
                  })}
                  {!draft.columns.length && (
                    <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                      No vertical-specific columns configured.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button disabled={savingDraft} onClick={saveDraft}>
              {savingDraft ? "Saving…" : draft?.isNew ? "Add vertical" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
