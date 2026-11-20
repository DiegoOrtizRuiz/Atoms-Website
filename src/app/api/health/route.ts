import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const version = process.env.VERCEL_GIT_COMMIT_SHA ?? "development";
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: true, db: false, deals: 0, version });
  }

  const supabase = createAdminClient();
  const { count, error } = await supabase
    .from("deals")
    .select("id", { count: "exact", head: true });

  if (error) {
    console.error("Health check could not query the deals table.", error);
    return NextResponse.json({ ok: true, db: false, deals: 0, version });
  }

  return NextResponse.json({
    ok: true,
    db: true,
    deals: count ?? 0,
    version,
  });
}
