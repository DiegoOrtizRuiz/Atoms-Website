"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Database, Json } from "@/lib/database.types";
import { canConfirmDeal, canEditDeal, dealStages, type Deal } from "@/lib/deals";
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

export async function updateDeal(input: z.input<typeof updateSchema>) {
  const parsed = updateSchema.parse(input);
  const { data: current, supabase } = await loadEditableDeal(parsed.dealId);
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
    const attributes = {
      ...(current.attributes as Record<string, Json>),
      [provenanceKey]: parsed.value as Json,
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

  revalidatePath("/deals");
  return { conflict: false as const, deal: data };
}

export async function setDealAssumption(
  input: z.input<typeof provenanceSchema>,
) {
  const parsed = provenanceSchema.parse(input);
  const { data: current, supabase } = await loadEditableDeal(parsed.dealId);
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
    .order("changed_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return data;
}
