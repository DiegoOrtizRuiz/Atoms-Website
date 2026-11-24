import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { computeDealsEditableHash } from "./helpers/db";
import { e2ePassword } from "./helpers/env";

export default async function globalSetup() {
  // Validate credentials upfront before launching browsers
  e2ePassword();
  const stateDir = path.resolve(process.cwd(), "e2e/.state");
  mkdirSync(stateDir, { recursive: true });
  const before = await computeDealsEditableHash();
  writeFileSync(
    path.join(stateDir, "before-hash.json"),
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        hash: before.hash,
        count: before.count,
        rows: before.rows,
      },
      null,
      2,
    ),
  );
  console.log(`[e2e] Before deals hash: ${before.hash} (${before.count} deals)`);
}
