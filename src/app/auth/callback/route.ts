import { NextResponse } from "next/server";
import { safeNextPath } from "@/lib/auth-redirect";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(safeNextPath(url.searchParams.get("next")), url.origin));
    console.error("Unable to exchange the authentication code.", error);
  } else if (tokenHash && (type === "invite" || type === "recovery")) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(new URL(safeNextPath(url.searchParams.get("next")), url.origin));
    console.error("Unable to verify the authentication email.", error);
  } else if (!tokenHash && !url.searchParams.has("error")) {
    const complete = new URL("/auth/complete", url.origin);
    complete.searchParams.set("next", safeNextPath(url.searchParams.get("next")));
    return NextResponse.redirect(complete);
  }

  return NextResponse.redirect(new URL("/login?error=auth_link", url.origin));
}
