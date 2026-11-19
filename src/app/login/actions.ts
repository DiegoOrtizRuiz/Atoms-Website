"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { hasSupabaseConfig } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

const loginSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export type LoginState = {
  error?: string;
};

export async function signIn(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  if (!hasSupabaseConfig) {
    return {
      error:
        "Supabase is not configured. Add the public URL and anonymous key to the environment.",
    };
  }

  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid credentials." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) {
    return { error: error?.message ?? "Unable to sign in." };
  }

  const requestHeaders = await headers();
  const { error: activityError } = await supabase.from("activity_log").insert({
    user_id: data.user.id,
    event: "login",
    path: "/login",
    detail: {
      user_agent: requestHeaders.get("user-agent"),
    },
  });

  if (activityError) {
    await supabase.auth.signOut();
    console.error("Unable to record the login activity.", activityError);
    return {
      error:
        "Signed in, but the activity log was unavailable. Contact an administrator.",
    };
  }

  const requestedPath = formData.get("next");
  const destination =
    typeof requestedPath === "string" &&
    requestedPath.startsWith("/") &&
    !requestedPath.startsWith("//")
      ? requestedPath
      : "/deals";
  redirect(destination);
}

export async function signOut() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) console.error("Unable to sign out.", error);
  redirect("/login");
}
