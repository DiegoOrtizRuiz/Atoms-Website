"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Database, Json } from "@/lib/database.types";
import {
  canConfirmDeal,
  canEditDeal,
  dealStages,
  isUnconfirmed,
  jsonObject,
  type Deal,
} from "@/lib/deals";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const editableFields = new Set([
  "stage",
  "bldg_sf",
  "list_price",
  "lot_sf",
  "broker",
  "broker_phone",
  "notes",
  "weekly_note",
  "show_in_weekly",
]);

const updateSchema = z.object({
  dealId: z.string().min(1),
  version: z.number().int().positive(),
  field: z.string().min(1),
  value: z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
  ]),
  markAssumption: z.boolean().default(false),
});

const provenanceSchema = z.object({
  dealId: z.string().min(1),
  version: z.number().int().positive(),
  field: z.string().min(1),
});

function normalizeValue(field: string, value: string | number | boolean | null) {
  if (field === "stage") {
    return z.enum(dealStages as [string, ...string[]]).parse(value);
  }
  if (field === "show_in_weekly") {
    return z.boolean().parse(value);
  }
  if (["bldg_sf", "list_price", "lot_sf"].includes(field)) {
    if (value === null || value === "") return null;
    const numeric = typeof value === "number" ? value : Number(value);
    return z.number().finite().nonnegative().parse(numeric);
  }
  return z.string().nullable().parse(value);
}

async function loadEditableDeal(dealId: string) {
  const supabase = await createClient();
  const user = await requireUser();
  const { data, error } = await supabase
    .from("deals")
    .select("*")
    .eq("id", dealId)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Deal not found.");
  if (!canEditDeal(user, data)) {
    throw new Error("You do not have permission to edit this deal.");
  }
  return { data, supabase, user };
}

async function logDealEdit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  dealId: string,
  field: string,
) {
  const { error } = await supabase.from("activity_log").insert({
    user_id: userId,
    event: "deal_edit",
    path: "/deals",
    detail: { deal_id: dealId, field },
  });
  if (error) {
    throw new Error(`Deal was updated but activity logging failed: ${error.message}`);
  }
}

export async function updateDeal(input: z.input<typeof updateSchema>) {
  const parsed = updateSchema.parse(input);
  const { data: current, supabase, user } = await loadEditableDeal(parsed.dealId);
  if (parsed.version !== current.version) {
    return {
      conflict: true as const,
      deal: await reloadDeal(parsed.dealId),
    };
  }

  const isAttribute = parsed.field.startsWith("attributes.");
  if (!isAttribute && !editableFields.has(parsed.field)) {
    throw new Error("This field cannot be edited.");
  }

  const patch: Database["public"]["Tables"]["deals"]["Update"] = {};
  const provenanceKey = isAttribute
    ? parsed.field.slice("attributes.".length)
    : parsed.field;
  if (isAttribute) {
    if (!current.vertical) {
      throw new Error("Cannot edit attributes without a deal vertical.");
    }
    const { data: config, error: configError } = await supabase
      .from("vertical_config")
      .select("columns")
      .eq("vertical", current.vertical)
      .maybeSingle();
    if (configError) throw new Error(configError.message);
    if (!config || !Array.isArray(config.columns)) {
      throw new Error("The deal's vertical configuration is unavailable.");
    }
    const column = config.columns
      .map((item) => jsonObject(item))
      .find((item) => item.key === provenanceKey);
    if (!column || typeof column.type !== "string") {
      throw new Error("Unknown attribute for this deal's vertical.");
    }

    const text = parsed.value === null ? "" : String(parsed.value).trim();
    let value: string | number | boolean | null = text || null;
    if (column.type === "number" && text) {
      if (typeof parsed.value === "boolean" || !Number.isFinite(Number(text))) {
        throw new Error("Enter a valid number for this attribute.");
      }
      value = Number(text);
    } else if (column.type === "boolean" && text) {
      if (text.toLowerCase() !== "true" && text.toLowerCase() !== "false") {
        throw new Error("Enter true or false for this attribute.");
      }
      value = text.toLowerCase() === "true";
    }
    const attributes = {
      ...jsonObject(current.attributes),
      [provenanceKey]: value,
    };
    patch.attributes = attributes;
  } else {
    Object.assign(patch, {
      [parsed.field]: normalizeValue(parsed.field, parsed.value),
    });
  }

  if (parsed.markAssumption) {
    patch.field_provenance = {
      ...(current.field_provenance as Record<string, Json>),
      [provenanceKey]: "assumed",
    };
  }

  const { data, error } = await supabase
    .from("deals")
    .update(patch)
    .eq("id", parsed.dealId)
    .eq("version", parsed.version)
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) {
    return {
      conflict: true as const,
      deal: await reloadDeal(parsed.dealId),
    };
  }

  await logDealEdit(supabase, user.id, parsed.dealId, parsed.field);
  revalidatePath("/deals");
  return {
    conflict: false as const,
    deal: data,
    provenanceKept:
      !parsed.markAssumption &&
      isUnconfirmed(jsonObject(current.field_provenance)[provenanceKey]),
  };
}

export async function setDealAssumption(
  input: z.input<typeof provenanceSchema>,
) {
  const parsed = provenanceSchema.parse(input);
  const { data: current, supabase, user } = await loadEditableDeal(parsed.dealId);
  if (parsed.version !== current.version) {
    return {
      conflict: true as const,
      deal: await reloadDeal(parsed.dealId),
    };
  }

  const { data, error } = await supabase
    .from("deals")
    .update({
      field_provenance: {
        ...(current.field_provenance as Record<string, Json>),
        [parsed.field]: "assumed",
      },
    })
    .eq("id", parsed.dealId)
    .eq("version", parsed.version)
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) {
    return {
      conflict: true as const,
      deal: await reloadDeal(parsed.dealId),
    };
  }
  await logDealEdit(supabase, user.id, parsed.dealId, parsed.field);
  revalidatePath("/deals");
  return { conflict: false as const, deal: data };
}

export async function confirmDealField(
  input: z.input<typeof provenanceSchema>,
) {
  const parsed = provenanceSchema.parse(input);
  const user = await requireUser();
  const supabase = await createClient();
  const { data: current, error: readError } = await supabase
    .from("deals")
    .select("*")
    .eq("id", parsed.dealId)
    .single();
  if (readError || !current) throw new Error(readError?.message ?? "Deal not found.");
  if (!canConfirmDeal(user, current)) {
    throw new Error("You do not have permission to confirm assumptions.");
  }
  if (parsed.version !== current.version) {
    return {
      conflict: true as const,
      deal: current,
    };
  }

  const { data, error } = await supabase
    .from("deals")
    .update({
      field_provenance: {
        ...(current.field_provenance as Record<string, Json>),
        [parsed.field]: "confirmed",
      },
    })
    .eq("id", parsed.dealId)
    .eq("version", parsed.version)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    return {
      conflict: true as const,
      deal: await reloadDeal(parsed.dealId),
    };
  }
  await logDealEdit(supabase, user.id, parsed.dealId, parsed.field);
  revalidatePath("/deals");
  return { conflict: false as const, deal: data };
}

export async function reloadDeal(dealId: string): Promise<Deal> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deals")
    .select("*")
    .eq("id", dealId)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Deal not found.");
  return data;
}

export async function loadDealHistory(dealId: string) {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deal_history")
    .select("*")
    .eq("deal_id", dealId)
    .not(
      "field",
      "in",
      "(version,updated_at,updated_by,stage_entered_at,price_per_sf,price_per_lot_sf,created_at)",
    )
    .order("changed_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  const authorIds = [...new Set(data.flatMap((entry) => entry.changed_by ? [entry.changed_by] : []))];
  if (!authorIds.length) return { entries: data, authors: [] };
  const { data: authors, error: authorsError } = await supabase
    .from("profile_names")
    .select("id, full_name, role")
    .in("id", authorIds);
  if (authorsError) throw new Error(authorsError.message);
  return { entries: data, authors };
}
