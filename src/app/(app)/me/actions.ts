"use server";

import { requireUser } from "@/lib/auth";
import { authCallbackUrl } from "@/lib/auth-redirect";
import { createClient } from "@/lib/supabase/server";

export async function requestPasswordReset() {
  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
    redirectTo: authCallbackUrl(),
  });
  if (error) throw new Error(error.message);
  return { ok: true };
}
