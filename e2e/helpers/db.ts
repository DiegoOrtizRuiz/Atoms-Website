import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "./env";

export type DealSnapshot = {
  id: string;
  address: string | null;
  city: string | null;
  state: string | null;
  stage: string;
  bldg_sf: number | null;
  list_price: number | null;
  lot_sf: number | null;
  broker: string | null;
  broker_phone: string | null;
  notes: string | null;
  weekly_note: string | null;
  show_in_weekly: boolean;
  attributes: Record<string, unknown>;
  field_provenance: Record<string, unknown>;
  notes_extracted: Record<string, unknown> | null;
};

export type ProfileSnapshot = {
  id: string;
  email: string;
  role: string;
  verticals: string[];
  clients: string[];
  active: boolean;
  must_change_password: boolean;
};

const EDITABLE_COLUMNS =
  "id, address, city, state, stage, bldg_sf, list_price, lot_sf, broker, broker_phone, notes, weekly_note, show_in_weekly, attributes, field_provenance";

function getServiceClient(): SupabaseClient {
  loadLocalEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for E2E DB helpers.",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function assertResetAllowed() {
  loadLocalEnv();
  if (process.env.E2E_ALLOW_RESET !== "1") {
    throw new Error(
      "Refusing to run service-role E2E cleanup without E2E_ALLOW_RESET=1.",
    );
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return Object.fromEntries(entries.map(([k, v]) => [k, canonicalize(v)]));
  }
  return value;
}

export async function computeDealsEditableHash(): Promise<{
  hash: string;
  count: number;
  rows: Record<string, unknown>[];
}> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("deals")
    .select(EDITABLE_COLUMNS)
    .order("id", { ascending: true });
  if (error || !data) {
    throw new Error(`Unable to compute deals editable hash: ${error?.message ?? "no data"}`);
  }
  const canonical = canonicalize(data) as Record<string, unknown>[];
  const hash = createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  return { hash, count: canonical.length, rows: canonical };
}

export async function snapshotDeal(dealId: string): Promise<DealSnapshot> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("deals")
    .select(`${EDITABLE_COLUMNS}, notes_extracted`)
    .eq("id", dealId)
    .single();
  if (error || !data) {
    throw new Error(`Unable to snapshot deal ${dealId}: ${error?.message ?? "not found"}`);
  }
  return data as unknown as DealSnapshot;
}

export async function restoreDeal(snapshot: DealSnapshot): Promise<void> {
  assertResetAllowed();
  const supabase = getServiceClient();
  const { id, ...fields } = snapshot;
  const { error } = await supabase.from("deals").update(fields).eq("id", id);
  if (error) {
    throw new Error(`Unable to restore deal ${id}: ${error.message}`);
  }
}

export async function snapshotProfile(email: string): Promise<ProfileSnapshot> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, role, verticals, clients, active, must_change_password")
    .eq("email", email)
    .single();
  if (error || !data) {
    throw new Error(`Unable to snapshot profile ${email}: ${error?.message ?? "not found"}`);
  }
  return data as ProfileSnapshot;
}

export async function restoreProfile(snapshot: ProfileSnapshot): Promise<void> {
  assertResetAllowed();
  const supabase = getServiceClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      role: snapshot.role,
      verticals: snapshot.verticals,
      clients: snapshot.clients,
      active: snapshot.active,
      must_change_password: snapshot.must_change_password,
    })
    .eq("id", snapshot.id);
  if (error) {
    throw new Error(`Unable to restore profile ${snapshot.email}: ${error.message}`);
  }
}

export async function deleteTestUserByEmail(email: string): Promise<void> {
  assertResetAllowed();
  const supabase = getServiceClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email.toLowerCase())
    .maybeSingle();

  let userId = profile?.id ?? null;
  if (!userId) {
    const { data: listData } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    userId =
      listData?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ??
      null;
  }
  if (!userId) return;

  await supabase.from("activity_log").delete().eq("user_id", userId);
  await supabase.from("profiles").delete().eq("id", userId);
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) {
    throw new Error(`Unable to delete test user ${email}: ${error.message}`);
  }
}

export async function fetchDealField(dealId: string) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("deals")
    .select("id, version, notes, weekly_note, broker, field_provenance, attributes")
    .eq("id", dealId)
    .single();
  if (error || !data) throw new Error(error?.message ?? `Deal ${dealId} not found`);
  return data;
}
