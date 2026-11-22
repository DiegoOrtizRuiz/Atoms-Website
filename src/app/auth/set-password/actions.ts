"use server";

import { redirect } from "next/navigation";
import { passwordSchema } from "@/lib/password";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type PasswordState = { error?: string };

export async function setPassword(_previous: PasswordState, formData: FormData): Promise<PasswordState> {
  const parsed = passwordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid password." };

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect("/login");

  const { data: profile, error: profileError } = await supabase
    .from("profiles").select("id, active").eq("id", user.id).maybeSingle();
  if (profileError) return { error: `Unable to verify your profile: ${profileError.message}` };
  if (!profile?.active) return { error: "Your account is inactive or has no profile. Contact an administrator." };

  const admin = createAdminClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: error.message };

  const { error: logError } = await supabase.from("activity_log").insert({
    user_id: user.id,
    event: "password_set",
    path: "/auth/set-password",
  });
  if (logError) return { error: `Password updated, but activity logging failed: ${logError.message}. Try a different password or contact an administrator.` };

  const { data: updated, error: updateError } = await admin.from("profiles")
    .update({ must_change_password: false })
    .eq("id", user.id).eq("active", true).select("id").maybeSingle();
  if (updateError || !updated) {
    return { error: `Password updated, but account activation failed: ${updateError?.message ?? "profile not found or inactive"}. Please contact an administrator.` };
  }
  redirect("/deals");
}
