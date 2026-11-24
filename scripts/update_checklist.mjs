#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const RESULTS_PATH =
  process.argv[2] || path.resolve(ROOT, "e2e/report/results.json");
const HASH_PATH = path.resolve(ROOT, "e2e/.state/hash-check.json");
const LOG_PATH = path.resolve(ROOT, "PROCESS_LOG.md");
const REPORT_LINK =
  process.env.E2E_REPORT_URL || "e2e/report/index.html";

if (!existsSync(RESULTS_PATH)) {
  console.error(`Playwright JSON report not found at ${RESULTS_PATH}`);
  process.exit(1);
}

const report = JSON.parse(readFileSync(RESULTS_PATH, "utf8"));

function collectSpecs(suite, results = new Map()) {
  const file = suite.file || "";
  if (Array.isArray(suite.specs)) {
    for (const spec of suite.specs) {
      const tests = spec.tests || [];
      const ok =
        tests.length > 0 &&
        tests.every((t) =>
          (t.results || []).some((r) => r.status === "passed"),
        );
      const prev = results.get(file);
      results.set(file, prev === undefined ? ok : prev && ok);
    }
  }
  if (Array.isArray(suite.suites)) {
    for (const child of suite.suites) {
      collectSpecs(child, results);
    }
  }
  return results;
}

const byFile = new Map();
for (const suite of report.suites || []) {
  collectSpecs(suite, byFile);
}

function specPassed(...fileNames) {
  const statuses = fileNames.map((name) => {
    for (const [k, v] of byFile.entries()) {
      if (k === name || k.endsWith(`/${name}`)) return v;
    }
    return false;
  });
  return statuses.every(Boolean);
}

const hashCheck = existsSync(HASH_PATH)
  ? JSON.parse(readFileSync(HASH_PATH, "utf8"))
  : null;

let commitSha = "unknown";
try {
  commitSha = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    encoding: "utf8",
  }).trim();
} catch {
  // ignore
}

const runDate = new Date().toISOString().slice(0, 10);

const items = [
  {
    num: 1,
    pass: specPassed("scopes.spec.ts", "permissions-matrix.spec.ts"),
    text: "Role/RLS enforcement and dynamic client-scope editing (`scopes.spec.ts`, `permissions-matrix.spec.ts`) — analyst Client A/B scope enforcement, live scope grant without re-login, revert, `admin_change` audit rows, and 5-role route access matrix verified.",
  },
  {
    num: 2,
    pass: specPassed("assumptions.spec.ts"),
    text: "Admin confirmation and `lead.food` assumption actions (`assumptions.spec.ts`) — admin confirmed `400A` on `635 Angier Ave` (styling cleared + named history row), `lead.food` marked a Food assumption, and `analyst.a` had no Confirm action.",
  },
  {
    num: 3,
    pass: specPassed("realtime.spec.ts", "pptx.spec.ts"),
    text: "Live cross-browser updates and PPTX export parity (`realtime.spec.ts`, `pptx.spec.ts`) — admin's Chicago weekly note edit appeared in leadership's `/weekly` context within 10 s without reload with updated `as of` timestamp, and unzipped PPTX slide XML matched on-screen row counts, Market/Address/Status, and exact unconfirmed italic cells.",
  },
  {
    num: 4,
    pass: specPassed("weekly-content.spec.ts"),
    text: "Weekly Review content & formatting integrity (`weekly-content.spec.ts`) — `Needs attention` shows Seattle Nov 25, Seattle renders `$217.77/SF`, `Listed` renders as `Needs review` (`Source: Listed`), and no `null`/`NaN`/`undefined`/`$0` text appears.",
  },
  {
    num: 5,
    pass: specPassed("presence.spec.ts", "csv.spec.ts", "deactivation.spec.ts", "role-preview.spec.ts"),
    text: "Admin live presence, activity CSV export, deactivation, and role preview (`presence.spec.ts`, `csv.spec.ts`, `deactivation.spec.ts`, `role-preview.spec.ts`) — simultaneous `Online now` shows admin (`/admin`) and `analyst.a` (`/deals`) within 10 s and removes closed sessions; filtered CSV has UTF-8 BOM, valid headers, rows > 0, and no formula-injection cells; viewer deactivation redirects to `/login`; View as Analyst hides Admin nav & edit controls.",
  },
  {
    num: 6,
    pass: specPassed("concurrency.spec.ts"),
    text: "Optimistic-lock concurrent editing (`concurrency.spec.ts`) — simultaneous edits to the same cell trigger the conflict toast (`Someone else edited this deal — reloaded`) and reload the winning value.",
  },
  {
    num: 7,
    pass: specPassed("onboarding.spec.ts"),
    text: "Auth & temporary-password onboarding (`onboarding.spec.ts`) — admin-created temp-password user is forced to `/auth/set-password`, blocked from `/deals` until password is changed, then lands on `/deals` and is deleted cleanly in teardown.",
  },
];

const allPass =
  items.every((item) => item.pass) && (hashCheck ? hashCheck.matched : true);

const hashLine = hashCheck
  ? `Before/after deals editable hash: \`${hashCheck.beforeHash.slice(0, 12)}\` → \`${hashCheck.afterHash.slice(0, 12)}\` (**${hashCheck.matched ? "MATCH" : "MISMATCH"}**, ${hashCheck.afterCount} deals).`
  : "Before/after deals editable hash: not recorded.";

const checklistLines = [
  "## Phase 12 production checklist",
  "",
  `Verified via automated Playwright E2E suite on **${runDate}** (commit \`${commitSha}\`) · Report: [Playwright HTML report](${REPORT_LINK}). ${hashLine}`,
  "",
  ...items.map(
    (item) => `${item.num}. **${item.pass ? "PASS" : "FAIL"}** — ${item.text}`,
  ),
  "",
];

let content = readFileSync(LOG_PATH, "utf8");
const sectionRegex =
  /## Phase 12 production checklist[\s\S]*?(?=\n## |\n$|$)/;
if (!sectionRegex.test(content)) {
  console.error("Could not find '## Phase 12 production checklist' in PROCESS_LOG.md");
  process.exit(1);
}
content = content.replace(sectionRegex, checklistLines.join("\n").trimEnd() + "\n");

if (allPass) {
  content = content.replace(
    /^- Complete any remaining signed-in multi-browser checks.*\r?\n/m,
    "",
  );
}

writeFileSync(LOG_PATH, content, "utf8");
console.log(
  `[checklist] Updated PROCESS_LOG.md (${items.filter((i) => i.pass).length}/${items.length} PASS, hash=${hashCheck?.matched ?? "n/a"})`,
);
