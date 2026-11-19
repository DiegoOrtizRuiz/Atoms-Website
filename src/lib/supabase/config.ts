const fallbackUrl = "https://example.supabase.co";
const fallbackAnonKey = "ci-placeholder";

export const supabaseConfig = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? fallbackUrl,
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? fallbackAnonKey,
};

export const hasSupabaseConfig =
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
