import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const autocannon = require("autocannon");
const { createServerClient } = require("@supabase/ssr");

function loadLocalEnv() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!process.env[key]) {
      process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
    }
  }
}

loadLocalEnv();

const BASE_URL = (
  process.env.E2E_BASE_URL || "https://atoms-website-three.vercel.app"
).replace(/\/+$/, "");
const PASSWORD = process.env.E2E_PASSWORD?.trim();
const DURATION = Number(process.env.LOAD_DURATION_SEC || 60);
const CONNECTIONS = Number(process.env.LOAD_CONNECTIONS || 25);
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();

if (!PASSWORD) {
  throw new Error("E2E_PASSWORD is required to run e2e/load.mjs.");
}
if (!SUPABASE_URL) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL is required to run e2e/load.mjs.");
}

function resolveAnonKey() {
  const envKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (envKey && envKey.length > 20) return envKey;
  const projectRef = new URL(SUPABASE_URL).hostname.split(".")[0];
  const raw = execFileSync(
    "npx",
    ["-y", "supabase", "projects", "api-keys", `--remote=${projectRef}`, "-o", "json"],
    { encoding: "utf8" },
  );
  const keys = JSON.parse(raw);
  const found =
    keys.find((k) => k.name === "anon")?.api_key ??
    keys.find((k) => k.name === "default")?.api_key;
  if (!found) throw new Error("Unable to resolve Supabase anon key for load test.");
  return found;
}

const DEMO_POOL = [
  "admin@demo.test",
  "leadership@demo.test",
  "leadership.ops@demo.test",
  "leadership.partners@demo.test",
  "lead.food@demo.test",
  "lead.av@demo.test",
  "lead.catering@demo.test",
  "lead.commercial@demo.test",
  "analyst.a@demo.test",
  "analyst.03@demo.test",
  "analyst.04@demo.test",
  "analyst.05@demo.test",
  "analyst.06@demo.test",
  "analyst.07@demo.test",
  "analyst.08@demo.test",
  "analyst.09@demo.test",
  "viewer@demo.test",
];

async function signInCookieHeader(anonKey, email) {
  const jar = new Map();
  const client = createServerClient(SUPABASE_URL, anonKey, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (items) => {
        for (const item of items) {
          if (item.value) jar.set(item.name, item.value);
          else jar.delete(item.name);
        }
      },
    },
  });
  const { error } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (error) {
    throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function buildSessionPool(anonKey, count) {
  const cookies = [];
  for (let i = 0; i < count; i++) {
    const email = DEMO_POOL[i % DEMO_POOL.length];
    try {
      cookies.push(await signInCookieHeader(anonKey, email));
    } catch {
      // Fall back to admin@demo.test if an optional demo account is absent
      cookies.push(await signInCookieHeader(anonKey, "admin@demo.test"));
    }
  }
  return cookies;
}

function runAutocannon(cookiePool) {
  let cursor = 0;
  return new Promise((resolve, reject) => {
    const instance = autocannon(
      {
        url: BASE_URL,
        connections: CONNECTIONS,
        duration: DURATION,
        timeout: 20,
        requests: [
          {
            method: "GET",
            path: "/deals",
            setupRequest: (req) => {
              const idx = cursor++ % cookiePool.length;
              req.headers = {
                ...req.headers,
                cookie: cookiePool[idx],
              };
              return req;
            },
          },
          {
            method: "GET",
            path: "/weekly",
            setupRequest: (req) => {
              const idx = cursor++ % cookiePool.length;
              req.headers = {
                ...req.headers,
                cookie: cookiePool[idx],
              };
              return req;
            },
          },
        ],
      },
      (err, result) => {
        if (err) reject(err);
        else resolve(result);
      },
    );
    autocannon.track(instance, { renderProgressBar: false });
  });
}

async function main() {
  console.log(
    `[load] Authenticating ${CONNECTIONS} sessions against ${BASE_URL} (${DURATION}s)...`,
  );
  const anonKey = resolveAnonKey();
  const cookiePool = await buildSessionPool(anonKey, CONNECTIONS);
  console.log(`[load] ${cookiePool.length} authenticated sessions ready. Running load check...`);

  const result = await runAutocannon(cookiePool);
  const totalReq = result.requests.total || 0;
  const ok2xx = result["2xx"] || 0;
  const non2xx = result.non2xx || 0;
  const errors = (result.errors || 0) + (result.timeouts || 0) + non2xx;
  const errorRatePct = totalReq > 0 ? (errors / totalReq) * 100 : 100;

  let gitSha = "unknown";
  try {
    gitSha = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    // ignore
  }

  const runDate = new Date().toISOString();
  const p50 = result.latency.p50 ?? 0;
  const p95 = result.latency.p97_5 ?? result.latency.p99 ?? 0;
  const p99 = result.latency.p99 ?? 0;
  const avg = result.latency.average ?? 0;
  const max = result.latency.max ?? 0;
  const rps = result.requests.average ?? 0;

  const report = `# Load Test Report

- **Date (UTC):** ${runDate}
- **Target:** \`${BASE_URL}\`
- **Commit:** \`${gitSha}\`
- **Tool:** \`autocannon\` via \`e2e/load.mjs\`
- **Profile:** ${CONNECTIONS} concurrent authenticated sessions alternating \`GET /deals\` and \`GET /weekly\` for ${DURATION}s

## Summary Metrics

| Metric | Value |
|---|---:|
| Total requests | ${totalReq} |
| Throughput (avg req/s) | ${rps.toFixed(2)} |
| HTTP 2xx responses | ${ok2xx} |
| Non-2xx responses | ${non2xx} |
| Socket errors / timeouts | ${(result.errors || 0)} / ${(result.timeouts || 0)} |
| **Error rate** | **${errorRatePct.toFixed(2)}%** |
| Latency avg | ${avg.toFixed(1)} ms |
| Latency p50 | ${p50} ms |
| **Latency p95 (p97.5 upper bound)** | **${p95} ms** |
| Latency p99 | ${p99} ms |
| Latency max | ${max} ms |

## Interpretation

- All ${CONNECTIONS} concurrent authenticated sessions hit live SSR routes (\`/deals\` and \`/weekly\`) backed by production Supabase Postgres and Vercel serverless functions.
- Observed error rate: **${errorRatePct.toFixed(2)}%** (${errors} errors/non-2xx out of ${totalReq} requests); p95 latency upper bound: **${p95} ms**.
`;

  const docsDir = path.resolve(process.cwd(), "docs");
  mkdirSync(docsDir, { recursive: true });
  writeFileSync(path.join(docsDir, "load-test.md"), report, "utf8");
  console.log(
    `[load] Done. total=${totalReq}, 2xx=${ok2xx}, errors=${errors} (${errorRatePct.toFixed(2)}%), p50=${p50}ms, p95=${p95}ms, p99=${p99}ms`,
  );
  console.log("[load] Wrote docs/load-test.md");
}

main().catch((err) => {
  console.error("[load] Failed:", err);
  process.exit(1);
});
