import { execFileSync } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "backend/workflows/dist/native-preparation-family");
const members = [
  ["native-application-preparation-lambda", "native-preparation-lambda"],
  ["application-preparation-durable-lambda", "preparation-durable-lambda"],
  ["application-preparation-starter-lambda", "preparation-starter-lambda"],
  ["application-preparation-recovery-lambda", "preparation-recovery-lambda"],
];

// Preserve each standalone artifact path. The publisher consumes only this complete family
// after every original builder's source qualification and bundled refusal checks succeed.
for (const [name] of members) {
  execFileSync(process.execPath, [path.join(root, `scripts/build-${name}.mjs`)], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
}
await mkdir(output, { recursive: true });
for (const [name, directory] of members) {
  for (const suffix of ["zip", "cdx.json", "manifest.json", "sha256"]) {
    await copyFile(
      path.join(root, "backend/workflows/dist", directory, `${name}.${suffix}`),
      path.join(output, `${name}.${suffix}`),
    );
  }
}
