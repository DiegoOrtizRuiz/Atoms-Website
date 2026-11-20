import type { Json } from "@/lib/database.types";
import { jsonObject, type DealHistory } from "@/lib/deals";

function equalJson(a: Json | undefined, b: Json | undefined): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => equalJson(value, b[index]));
  }
  if (
    a && b && typeof a === "object" && typeof b === "object" &&
    !Array.isArray(a) && !Array.isArray(b)
  ) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && equalJson(a[key], b[key]));
  }
  return false;
}

export function expandHistoryEntry(entry: DealHistory): DealHistory[] {
  if (entry.field !== "attributes") return [entry];
  const oldAttributes = jsonObject(entry.old_value);
  const newAttributes = jsonObject(entry.new_value);
  return [...new Set([...Object.keys(oldAttributes), ...Object.keys(newAttributes)])]
    .filter((key) => !equalJson(oldAttributes[key], newAttributes[key]))
    .map((key) => ({
      ...entry,
      field: `attributes.${key}`,
      old_value: oldAttributes[key] ?? null,
      new_value: newAttributes[key] ?? null,
    }));
}
