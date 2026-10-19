// Ejecuta las pruebas E2E seguras. Requisitos:
//   1) `npx next build` y `node electron/prepare.cjs`.
//   2) Para flows/audio/security: servidor standalone en JARVIS_TEST_URL (por defecto :3822) con
//      OPENROUTER_API_KEY en su entorno y JARVIS_DATA_DIR temporal.
//   3) settings.mjs necesita su propio servidor (ver cabecera del archivo). robustness.mjs arranca el suyo.
// Uso: node tests/run-all.mjs [flows|audio|security|robustness|settings ...]
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const all = ["security", "flows", "audio", "robustness"];
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : all;
let failed = 0;
for (const name of wanted) {
  console.log(`\n===== ${name} =====`);
  const r = spawnSync(process.execPath, [path.join(dir, `${name}.mjs`)], { stdio: "inherit" });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} suite(s) con fallos` : "\nTodas las suites pasaron");
process.exit(failed ? 1 : 0);
