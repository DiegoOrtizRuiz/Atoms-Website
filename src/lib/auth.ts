import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

export const userRoles = [
  "admin",
  "leadership",
  "acq_lead",
  "analyst",
  "viewer",
] as const;

export type UserRole = Database["public"]["Enums"]["user_role"];

export type CurrentUser = {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  verticals: string[];
  clients: string[];
};

function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && userRoles.includes(value as UserRole);
}

export function userFromAuth(authUser: User): CurrentUser {
  const role = isUserRole(authUser.app_metadata.role)
    ? authUser.app_metadata.role
    : "viewer";

  return {
    id: authUser.id,
    email: authUser.email ?? "",
    fullName:
      typeof authUser.user_metadata.full_name === "string"
        ? authUser.user_metadata.full_name
        : (authUser.email?.split("@")[0] ?? "Team member"),
    role,
    verticals: [],
    clients: [],
  };
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    console.error("Unable to load the authenticated user.", error);
    return null;
  }

  if (!user) return null;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("full_name, email, role, verticals, clients, active, must_change_password")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("Unable to load the user profile.", profileError);
    return null;
  }

  if (!profile) {
    console.warn("An authenticated user has no active application profile.");
    return null;
  }
  if (!profile.active) {
    console.warn("An inactive user attempted to enter the application.");
    return null;
  }
  if (profile.must_change_password) redirect("/auth/set-password");

  const fallback = userFromAuth(user);
  return {
    id: fallback.id,
    fullName: profile.full_name,
    email: profile.email,
    role: isUserRole(profile.role) ? profile.role : fallback.role,
    verticals: profile.verticals,
    clients: profile.clients,
  };
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
