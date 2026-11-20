"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function requestPasswordReset() {
  const user = await requireUser();
  const requestHeaders = await headers();
  const configuredOrigin = process.env.NEXT_PUBLIC_SITE_URL;
  const requestOrigin = requestHeaders.get("origin");
  const originValue = configuredOrigin ?? requestOrigin;
  if (!originValue) {
    throw new Error("The application URL is not configured for password reset.");
  }

  const origin = z.url().parse(originValue);
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
    redirectTo: new URL("/login", origin).toString(),
  });
  if (error) throw new Error(error.message);
  return { ok: true };
}
