import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const candidates = [
  join(root, ".venv", "bin", "python"),
  "python3",
  join(root, ".venv", "Scripts", "python.exe"),
];

const python = candidates.find(
  (candidate) => candidate.includes(".venv") ? existsSync(candidate) : true,
);

if (process.argv.includes("--print-python")) {
  console.log(python);
  process.exit(0);
}

const result = spawnSync(python, [join(root, "scripts", "seed.py")], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  console.error(`Unable to start Python: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
