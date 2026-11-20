import { existsSync } from "node:fs";
import { createServerClient } from "@supabase/ssr";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const baseUrl = process.env.SMOKE_APP_URL ?? "https://atoms-website-three.vercel.app";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const password = process.env.DEMO_PASSWORD;

if (!supabaseUrl || !anonKey || !password) {
  throw new Error(
    "Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and DEMO_PASSWORD in .env.local or the environment.",
  );
}

const accounts = [
  "admin@demo.test",
  "leadership@demo.test",
  "lead.food@demo.test",
  "analyst.a@demo.test",
  "viewer@demo.test",
];
const paths = ["/deals", "/weekly", "/rollup"];
const renderedTextErrors = [
  ["null", /\bnull\b/i],
  ["NaN", /\bNaN\b/],
  ["undefined", /\bundefined\b/i],
  ["$0", /\$0(?:\.00)?(?![\d])/],
];

function visibleText(html) {
  return html
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

for (const email of accounts) {
  const cookies = new Map();
  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
      setAll: (updates) => {
        for (const { name, value } of updates) cookies.set(name, value);
      },
    },
  });
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Could not sign in demo role ${email}: ${error.message}`);
  const cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  if (!cookie) throw new Error(`Supabase did not return an auth cookie for ${email}.`);

  for (const path of paths) {
    const response = await fetch(new URL(path, baseUrl), {
      headers: { cookie },
      redirect: "manual",
    });
    if (!response.ok) {
      throw new Error(`${email} received HTTP ${response.status} for ${path}.`);
    }

    const text = visibleText(await response.text());
    const matches = renderedTextErrors
      .filter(([, pattern]) => pattern.test(text))
      .map(([label]) => label);
    if (matches.length) {
      throw new Error(`${email} sees forbidden rendered text on ${path}: ${matches.join(", ")}.`);
    }
    if (
      path === "/weekly" &&
      (!text.includes("37 S Hudson St") || !text.includes("Nov 25"))
    ) {
      throw new Error(`${email} does not see the expected Seattle Nov 25 attention item.`);
    }
    if (
      path === "/rollup" &&
      (!text.includes("Deals by vertical and stage") ||
        !text.includes("Longest in current stage") ||
        !text.includes("Contact outreach"))
    ) {
      throw new Error(`${email} does not see the expected rollup sections.`);
    }
    console.log(`PASS ${email} ${path}: HTTP ${response.status}, rendered text clean`);
  }

  if (email === "admin@demo.test") {
    const response = await fetch(new URL("/api/admin/activity.csv", baseUrl), {
      headers: { cookie },
      redirect: "manual",
    });
    const contentType = response.headers.get("content-type") ?? "";
    const csv = await response.text();
    const expectedHeader = "created_at,user_id,user_name,event,path,detail";
    if (!response.ok || !contentType.includes("text/csv") || !csv.replace(/^\uFEFF/, "").startsWith(expectedHeader)) {
      throw new Error(
        `Admin CSV export failed validation (HTTP ${response.status}, content type ${contentType}, header ${JSON.stringify(csv.slice(0, 60))}).`,
      );
    }
    console.log("PASS admin@demo.test activity CSV: HTTP 200, CSV header verified");
  }
}
