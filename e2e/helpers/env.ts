import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

let loaded = false;

export function loadLocalEnv() {
  if (loaded) return;
  loaded = true;
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

export function e2eBaseUrl() {
  loadLocalEnv();
  return (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

export function e2ePassword() {
  loadLocalEnv();
  const password = process.env.E2E_PASSWORD?.trim();
  if (!password) {
    throw new Error(
      "E2E_PASSWORD is required to run Playwright tests (credentials are never hardcoded).",
    );
  }
  return password;
}
