import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import type { Database } from "@/lib/database.types";
import { hasSupabaseConfig, supabaseConfig } from "./config";

const publicRoutes = ["/login", "/api/health", "/auth"];

export async function updateSession(request: NextRequest) {
  const isPublicRoute = publicRoutes.some(
    (route) =>
      request.nextUrl.pathname === route ||
      request.nextUrl.pathname.startsWith(`${route}/`),
  );

  if (!hasSupabaseConfig) {
    if (isPublicRoute) return NextResponse.next({ request });

    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient<Database>(
    supabaseConfig.url,
    supabaseConfig.anonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  function redirectTo(path: string) {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = "";
    const redirectResponse = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    return redirectResponse;
  }

  let activeUser = user;
  if (user) {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, role, must_change_password")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || !profile) {
      await supabase.auth.signOut();
      activeUser = null;
    } else if (
      profile.must_change_password &&
      request.nextUrl.pathname !== "/auth/set-password" &&
      request.nextUrl.pathname !== "/auth/callback" &&
      request.nextUrl.pathname !== "/auth/complete" &&
      request.nextUrl.pathname !== "/api/health"
    ) {
      return redirectTo("/auth/set-password");
    } else if (
      (request.nextUrl.pathname === "/admin" ||
        request.nextUrl.pathname.startsWith("/admin/")) &&
      profile.role !== "admin"
    ) {
      return redirectTo("/deals");
    }
  }

  if (!activeUser && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  if (activeUser && request.nextUrl.pathname === "/login") {
    return redirectTo("/deals");
  }

  return response;
}
