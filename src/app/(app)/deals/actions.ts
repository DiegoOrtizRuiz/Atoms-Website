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
import {
  AI_SECTION_KEYS,
  withUpdatedSectionProvenance,
  type AiSectionKey,
} from "@/lib/ai-suggestions";
import { requireUser } from "@/lib/auth";
import { geocodeDealById } from "@/lib/geo/service";
import {
  checkUserRateLimit,
  generateDealSuggestion,
} from "@/lib/llm/server-enrich";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const editableFields = new Set([
  "address",
  "city",
  "state",
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

const addressFields = new Set(["address", "city", "state"]);

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

const aiSectionSchema = z.enum(AI_SECTION_KEYS as [AiSectionKey, ...AiSectionKey[]]);

const aiActionSchema = z.object({
  dealId: z.string().min(1),
  version: z.number().int().positive(),
  section: aiSectionSchema,
});

const aiEditAcceptSchema = aiActionSchema.extend({
  editedText: z.string().trim().min(1).max(500),
});

const regenerateSchema = z.object({
  dealId: z.string().min(1),
  version: z.number().int().positive(),
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

  let latestDeal: Deal = data;
  if (addressFields.has(parsed.field)) {
    try {
      latestDeal = await geocodeDealById(parsed.dealId);
    } catch (geoError) {
      console.error(`Unable to re-geocode deal ${parsed.dealId} after address edit.`, geoError);
    }
  }

  revalidatePath("/deals");
  return {
    conflict: false as const,
    deal: latestDeal,
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

async function loadConfirmableDeal(dealId: string) {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: current, error } = await supabase
    .from("deals")
    .select("*")
    .eq("id", dealId)
    .single();
  if (error || !current) throw new Error(error?.message ?? "Deal not found.");
  if (!canConfirmDeal(user, current)) {
    throw new Error("You do not have permission to review AI suggestions.");
  }
  return { current, supabase, user };
}

function revalidateAiViews() {
  for (const path of ["/deals", "/weekly", "/admin"]) {
    revalidatePath(path);
  }
}

export async function acceptAiSuggestion(input: z.input<typeof aiActionSchema>) {
  const parsed = aiActionSchema.parse(input);
  const { current, supabase, user } = await loadConfirmableDeal(parsed.dealId);
  if (parsed.version !== current.version) {
    return { conflict: true as const, deal: current };
  }

  const nextProvenance = withUpdatedSectionProvenance(
    current.field_provenance,
    current,
    parsed.section,
    "confirmed",
  );

  const { data, error } = await supabase
    .from("deals")
    .update({ field_provenance: nextProvenance })
    .eq("id", parsed.dealId)
    .eq("version", parsed.version)
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) {
    return { conflict: true as const, deal: await reloadDeal(parsed.dealId) };
  }

  const { error: logError } = await supabase.from("activity_log").insert({
    user_id: user.id,
    event: "ai_review",
    path: "/deals",
    detail: {
      deal_id: parsed.dealId,
      section: parsed.section,
      action: "accept",
    },
  });
  if (logError) throw new Error(`Suggestion accepted but audit logging failed: ${logError.message}`);

  revalidateAiViews();
  return { conflict: false as const, deal: data };
}

export async function editAndAcceptAiSuggestion(
  input: z.input<typeof aiEditAcceptSchema>,
) {
  const parsed = aiEditAcceptSchema.parse(input);
  const { current, supabase, user } = await loadConfirmableDeal(parsed.dealId);
  if (parsed.version !== current.version) {
    return { conflict: true as const, deal: current };
  }

  const nextProvenance = withUpdatedSectionProvenance(
    current.field_provenance,
    current,
    parsed.section,
    "confirmed",
  );

  const patch: Database["public"]["Tables"]["deals"]["Update"] = {
    field_provenance: nextProvenance,
  };
  if (parsed.section === "weekly_note") {
    patch.weekly_note = parsed.editedText;
  }

  const { data: sessionUpdated, error } = await supabase
    .from("deals")
    .update(patch)
    .eq("id", parsed.dealId)
    .eq("version", parsed.version)
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!sessionUpdated) {
    return { conflict: true as const, deal: await reloadDeal(parsed.dealId) };
  }

  let latestDeal = sessionUpdated;
  if (parsed.section !== "weekly_note") {
    const extracted = {
      ...(jsonObject(sessionUpdated.notes_extracted) as Record<string, Json>),
    };
    if (parsed.section === "price_context") {
      extracted.price_context = parsed.editedText;
    } else if (parsed.section === "next_step") {
      extracted.next_step = parsed.editedText;
    } else if (parsed.section === "risks") {
      extracted.risks = parsed.editedText
        .split(/[;\n]+/)
        .map((item) => item.trim())
        .filter(Boolean);
    } else if (parsed.section === "deal_type") {
      const lowered = parsed.editedText.toLowerCase();
      extracted.deal_type =
        lowered === "buy" || lowered === "lease" ? lowered : "unknown";
    } else if (parsed.section === "suggested_stage") {
      extracted.suggested_stage = parsed.editedText;
    } else if (parsed.section === "key_dates") {
      extracted.key_dates = parsed.editedText
        .split(/[;\n]+/)
        .map((chunk) => chunk.trim())
        .filter(Boolean)
        .map((chunk) => {
          const [labelPart, ...rest] = chunk.split(":");
          const dateText = rest.join(":").trim() || chunk;
          return {
            label: rest.length ? labelPart.trim() : "Key date",
            date_text: dateText,
            iso_guess: null,
          };
        });
    }

    const adminClient = createAdminClient();
    const { data: adminUpdated, error: adminError } = await adminClient
      .from("deals")
      .update({ notes_extracted: extracted })
      .eq("id", parsed.dealId)
      .select("*")
      .single();
    if (adminError || !adminUpdated) {
      throw new Error(adminError?.message ?? "Unable to save edited AI extraction.");
    }
    latestDeal = adminUpdated;
  }

  const { error: logError } = await supabase.from("activity_log").insert({
    user_id: user.id,
    event: "ai_review",
    path: "/deals",
    detail: {
      deal_id: parsed.dealId,
      section: parsed.section,
      action: "edit_accept",
      edited_value: parsed.editedText,
    },
  });
  if (logError) throw new Error(`Suggestion saved but audit logging failed: ${logError.message}`);

  revalidateAiViews();
  return { conflict: false as const, deal: latestDeal };
}

export async function dismissAiSuggestion(input: z.input<typeof aiActionSchema>) {
  const parsed = aiActionSchema.parse(input);
  const { current, supabase, user } = await loadConfirmableDeal(parsed.dealId);
  if (parsed.version !== current.version) {
    return { conflict: true as const, deal: current };
  }

  const nextProvenance = withUpdatedSectionProvenance(
    current.field_provenance,
    current,
    parsed.section,
    "dismissed",
  );
  const extracted = {
    ...(jsonObject(current.notes_extracted) as Record<string, Json>),
  };
  const existingDismissed = Array.isArray(extracted._dismissed)
    ? extracted._dismissed.filter((item): item is string => typeof item === "string")
    : [];
  extracted._dismissed = [...new Set([...existingDismissed, parsed.section])];

  const sessionPatch: Database["public"]["Tables"]["deals"]["Update"] = {
    field_provenance: nextProvenance,
  };
  if (parsed.section === "weekly_note") {
    sessionPatch.weekly_note = null;
  }

  const { data: sessionUpdated, error } = await supabase
    .from("deals")
    .update(sessionPatch)
    .eq("id", parsed.dealId)
    .eq("version", parsed.version)
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!sessionUpdated) {
    return { conflict: true as const, deal: await reloadDeal(parsed.dealId) };
  }

  const adminClient = createAdminClient();
  const { data: adminUpdated, error: adminError } = await adminClient
    .from("deals")
    .update({ notes_extracted: extracted })
    .eq("id", parsed.dealId)
    .select("*")
    .single();
  if (adminError || !adminUpdated) {
    throw new Error(adminError?.message ?? "Unable to record dismissed AI suggestion.");
  }

  const { error: logError } = await supabase.from("activity_log").insert({
    user_id: user.id,
    event: "ai_review",
    path: "/deals",
    detail: {
      deal_id: parsed.dealId,
      section: parsed.section,
      action: "dismiss",
      previous_weekly_note: parsed.section === "weekly_note" ? current.weekly_note : null,
    },
  });
  if (logError) throw new Error(`Suggestion dismissed but audit logging failed: ${logError.message}`);

  revalidateAiViews();
  return { conflict: false as const, deal: adminUpdated };
}

export async function regenerateDealSuggestion(
  input: z.input<typeof regenerateSchema>,
) {
  const parsed = regenerateSchema.parse(input);
  const { current, supabase, user } = await loadConfirmableDeal(parsed.dealId);

  const rate = checkUserRateLimit(user.id);
  if (!rate.allowed) {
    return {
      ok: false as const,
      configured: true,
      message: `Rate limit reached — please wait ${rate.retryAfterSec}s before regenerating again.`,
      deal: current,
    };
  }

  const generated = await generateDealSuggestion({
    dealId: current.id,
    stage: current.stage,
    notes: current.notes ?? "",
  });

  if (!generated.ok) {
    return {
      ok: false as const,
      configured: generated.configured,
      message: generated.message,
      deal: current,
    };
  }

  const nextProvenance: Record<string, Json> = {
    ...(jsonObject(current.field_provenance) as Record<string, Json>),
    notes_extracted: "llm_suggested",
    weekly_note: "llm_suggested",
  };
  for (const key of Object.keys(nextProvenance)) {
    if (key.startsWith("ai:")) delete nextProvenance[key];
  }

  const adminClient = createAdminClient();
  const { data: updated, error } = await adminClient
    .from("deals")
    .update({
      notes_extracted: generated.extraction,
      weekly_note: generated.weeklyNote,
      field_provenance: nextProvenance,
    })
    .eq("id", current.id)
    .select("*")
    .single();

  if (error || !updated) {
    throw new Error(error?.message ?? "Unable to save regenerated AI suggestion.");
  }

  const { error: logError } = await supabase.from("activity_log").insert({
    user_id: user.id,
    event: "ai_review",
    path: "/deals",
    detail: {
      deal_id: current.id,
      action: "regenerate",
      provider: generated.provider,
      model: generated.model,
      cached: generated.cached,
    },
  });
  if (logError) {
    console.error("Unable to audit AI regeneration.", logError);
  }

  revalidateAiViews();
  return {
    ok: true as const,
    configured: true,
    cached: generated.cached,
    deal: updated,
  };
}
