"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser, userRoles } from "@/lib/auth";
import { authCallbackUrl } from "@/lib/auth-redirect";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const profileSchema = z.object({
  id: z.uuid(),
  role: z.enum(userRoles),
  verticals: z.array(z.string().trim().min(1)).max(100),
  clients: z.array(z.string().trim().min(1)).max(100),
  active: z.boolean(),
});

const inviteSchema = z.object({
  email: z.email(),
  fullName: z.string().trim().min(1).max(200),
  role: z.enum(userRoles),
  verticals: z.array(z.string().trim().min(1)).max(100),
  clients: z.array(z.string().trim().min(1)).max(100),
  mode: z.enum(["temporary", "email"]).default("temporary"),
});

const activityFilterSchema = z.object({
  userId: z.uuid().optional(),
  event: z.enum(["login", "page_view", "deal_edit", "admin_change", "snapshot", "csv_export", "password_set"]).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  page: z.number().int().min(1).default(1),
});

async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") {
    throw new Error("Only administrators can perform this action.");
  }
  return user;
}

async function validateScopes(verticals: string[], clients: string[]) {
  const supabase = await createClient();
  const [verticalRows, clientRows] = await Promise.all([
    supabase.from("vertical_config").select("vertical"),
    clients.length
      ? supabase.from("deals").select("client").in("client", clients)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (verticalRows.error) throw new Error(verticalRows.error.message);
  if (clientRows.error) throw new Error(clientRows.error.message);

  const configuredVerticals = new Set(verticalRows.data.map((item) => item.vertical));
  const existingClients = new Set(clientRows.data.flatMap((item) => item.client ? [item.client] : []));
  if (verticals.some((vertical) => !configuredVerticals.has(vertical))) {
    throw new Error("One or more selected verticals are not configured.");
  }
  if (clients.some((client) => !existingClients.has(client))) {
    throw new Error("One or more selected clients do not exist.");
  }
}

export async function updateAdminProfile(input: z.input<typeof profileSchema>) {
  const admin = await requireAdmin();
  const parsed = profileSchema.parse(input);
  if (parsed.id === admin.id && (parsed.role !== "admin" || !parsed.active)) {
    throw new Error("You cannot demote or deactivate your own account.");
  }
  await validateScopes(parsed.verticals, parsed.clients);

  const supabase = await createClient();
  const { data: oldProfile, error: readError } = await supabase
    .from("profiles")
    .select("role, verticals, clients, active")
    .eq("id", parsed.id)
    .single();
  if (readError) throw new Error(readError.message);

  const nextProfile = {
    role: parsed.role,
    verticals: [...new Set(parsed.verticals)],
    clients: [...new Set(parsed.clients)],
    active: parsed.active,
  };
  const { error } = await supabase
    .from("profiles")
    .update(nextProfile)
    .eq("id", parsed.id);
  if (error) throw new Error(error.message);

  const changes = (
    Object.keys(nextProfile) as (keyof typeof nextProfile)[]
  ).filter(
    (field) =>
      JSON.stringify(oldProfile[field]) !== JSON.stringify(nextProfile[field]),
  );
  if (changes.length) {
    const { error: logError } = await supabase.from("activity_log").insert(
      changes.map((field) => ({
        user_id: admin.id,
        event: "admin_change",
        path: "/admin",
        detail: {
          target_user: parsed.id,
          field,
          old: oldProfile[field],
          new: nextProfile[field],
        },
      })),
    );
    if (logError) throw new Error(`Profile updated but audit logging failed: ${logError.message}`);
  }

  revalidatePath("/admin");
  return { ok: true };
}

export async function inviteAdminUser(input: z.input<typeof inviteSchema>) {
  const admin = await requireAdmin();
  const parsed = inviteSchema.parse(input);
  await validateScopes(parsed.verticals, parsed.clients);
  const sessionClient = await createClient();
  const adminClient = createAdminClient();

  let userId: string | undefined;
  const temporaryPassword = parsed.mode === "temporary"
    ? randomBytes(24).toString("base64url")
    : null;
  if (temporaryPassword) {
    const { data: created, error: createError } =
      await adminClient.auth.admin.createUser({
        email: parsed.email,
        password: temporaryPassword,
        email_confirm: true,
        user_metadata: { full_name: parsed.fullName },
      });
    if (createError) throw new Error(`User creation failed: ${createError.message}`);
    userId = created.user?.id;
  } else {
    const { data: invited, error: inviteError } =
      await adminClient.auth.admin.inviteUserByEmail(parsed.email, {
        data: { full_name: parsed.fullName },
        redirectTo: authCallbackUrl(),
      });
    if (inviteError) throw new Error(`Invite failed: ${inviteError.message}`);
    userId = invited.user?.id;
  }

  if (!userId) throw new Error("Supabase did not return an ID for the invited user.");

  const { error: profileError } = await sessionClient.from("profiles").insert({
    id: userId,
    email: parsed.email,
    full_name: parsed.fullName,
    role: parsed.role,
    verticals: [...new Set(parsed.verticals)],
    clients: [...new Set(parsed.clients)],
    active: true,
    must_change_password: Boolean(temporaryPassword),
  });
  if (profileError) {
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteError) {
      console.error("Could not remove the auth account after profile creation failed.", deleteError);
    }
    throw new Error(`The account was created but its profile could not be saved: ${profileError.message}`);
  }

  const { error: logError } = await sessionClient.from("activity_log").insert({
    user_id: admin.id,
    event: "admin_change",
    path: "/admin",
    detail: {
      target_user: userId,
      field: "invite",
      new: { email: parsed.email, role: parsed.role, mode: parsed.mode },
    },
  });
  if (logError) {
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteError) throw new Error(`Audit logging failed and the new account could not be removed: ${deleteError.message}`);
    throw new Error(`Account creation was rolled back because audit logging failed: ${logError.message}`);
  }

  revalidatePath("/admin");
  return { temporaryPassword };
}

export async function getAdminActivity(input: z.input<typeof activityFilterSchema>) {
  await requireAdmin();
  const filters = activityFilterSchema.parse(input);
  const supabase = await createClient();
  let query = supabase
    .from("activity_log")
    .select("id, user_id, event, path, detail, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (filters.userId) query = query.eq("user_id", filters.userId);
  if (filters.event) query = query.eq("event", filters.event);
  if (filters.from) query = query.gte("created_at", `${filters.from}T00:00:00.000Z`);
  if (filters.to) {
    const endExclusive = new Date(
      new Date(`${filters.to}T00:00:00.000Z`).getTime() + 86400000,
    ).toISOString();
    query = query.lt("created_at", endExclusive);
  }

  const first = (filters.page - 1) * 50;
  const { data, error, count } = await query.range(first, first + 49);
  if (error) throw new Error(error.message);

  const userIds = [...new Set((data ?? []).map((entry) => entry.user_id))];
  const { data: names, error: namesError } = userIds.length
    ? await supabase.from("profiles").select("id, full_name, role").in("id", userIds)
    : { data: [], error: null };
  if (namesError) throw new Error(namesError.message);

  return {
    rows: (data ?? []).map((entry) => ({
      ...entry,
      user: names?.find((profile) => profile.id === entry.user_id) ?? null,
    })),
    count: count ?? 0,
  };
}
