"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import type { Json } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

const snapshotSchema = z.object({
  weekStart: z.iso.date(),
  data: z.custom<Json>((value) => value !== undefined),
});

export async function saveWeeklySnapshot(input: z.input<typeof snapshotSchema>) {
  const user = await requireUser();
  if (user.role !== "admin" && user.role !== "leadership") {
    throw new Error("Only administrators and leadership can save snapshots.");
  }
  const parsed = snapshotSchema.parse(input);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("weekly_snapshots")
    .upsert(
      {
        week_start: parsed.weekStart,
        created_by: user.id,
        data: parsed.data,
      },
      { onConflict: "week_start" },
    )
    .select("id, week_start, created_at, data")
    .single();
  if (error) throw new Error(error.message);
  const { error: activityError } = await supabase.from("activity_log").insert({
    user_id: user.id,
    event: "snapshot",
    path: "/weekly",
    detail: { snapshot_id: data.id, week_start: data.week_start },
  });
  if (activityError) {
    throw new Error(`Snapshot was saved but activity logging failed: ${activityError.message}`);
  }
  revalidatePath("/weekly");
  return data;
}
