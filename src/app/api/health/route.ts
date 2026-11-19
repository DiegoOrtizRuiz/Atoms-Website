import { NextResponse } from "next/server";
import { hasSupabaseConfig } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const version = process.env.VERCEL_GIT_COMMIT_SHA ?? "development";
  if (!hasSupabaseConfig) {
    return NextResponse.json({ ok: true, db: false, deals: 0, version });
  }

  const supabase = await createClient();
  const { count, error } = await supabase
    .from("deals")
    .select("id", { count: "exact", head: true });

  if (error) {
    if (error.code !== "42P01") {
      console.error("Health check could not query the deals table.", error);
    }
    return NextResponse.json({ ok: true, db: false, deals: 0, version });
  }

  return NextResponse.json({
    ok: true,
    db: true,
    deals: count ?? 0,
    version,
  });
}
