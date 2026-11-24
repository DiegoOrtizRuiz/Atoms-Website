import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { computeDealsEditableHash } from "./helpers/db";

export default async function globalTeardown() {
  const stateDir = path.resolve(process.cwd(), "e2e/.state");
  const beforeFile = path.join(stateDir, "before-hash.json");
  if (!existsSync(beforeFile)) {
    throw new Error("Missing e2e/.state/before-hash.json from globalSetup.");
  }
  const before = JSON.parse(readFileSync(beforeFile, "utf8")) as {
    hash: string;
    count: number;
    rows: Record<string, unknown>[];
  };
  const after = await computeDealsEditableHash();
  const matched = before.hash === after.hash && before.count === after.count;

  const diffs: Array<{ id: string; before: unknown; after: unknown }> = [];
  if (!matched) {
    const beforeMap = new Map(before.rows.map((r) => [String(r.id), r]));
    const afterMap = new Map(after.rows.map((r) => [String(r.id), r]));
    const allIds = new Set([...beforeMap.keys(), ...afterMap.keys()]);
    for (const id of allIds) {
      const b = beforeMap.get(id);
      const a = afterMap.get(id);
      if (JSON.stringify(b) !== JSON.stringify(a)) {
        diffs.push({ id, before: b, after: a });
      }
    }
  }

  writeFileSync(
    path.join(stateDir, "hash-check.json"),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        beforeHash: before.hash,
        afterHash: after.hash,
        beforeCount: before.count,
        afterCount: after.count,
        matched,
        diffs,
      },
      null,
      2,
    ),
  );

  console.log(
    `[e2e] After deals hash:  ${after.hash} (${after.count} deals) — ${matched ? "MATCH" : "MISMATCH"}`,
  );
  if (!matched) {
    throw new Error(
      `Deals editable hash mismatch after E2E run! before=${before.hash}, after=${after.hash}, diffs=${JSON.stringify(diffs).slice(0, 800)}`,
    );
  }
}
