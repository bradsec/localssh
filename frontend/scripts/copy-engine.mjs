import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const engineDist = path.resolve(__dirname, "../../engine/dist");
const publicDir = path.resolve(__dirname, "../public");

if (!existsSync(engineDist)) {
  console.error(`engine/dist not found at ${engineDist}. Build the engine first:\n\n  cd engine && ./build.sh\n`);
  process.exit(1);
}

mkdirSync(publicDir, { recursive: true });
for (const file of ["engine.wasm", "wasm_exec.js"]) {
  copyFileSync(path.join(engineDist, file), path.join(publicDir, file));
}
console.log("copied engine.wasm and wasm_exec.js into public/");
