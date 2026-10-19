// Robustez del almacenamiento: concurrencia, reinicios, recordatorios vencidos con el servidor apagado,
// JSON corrupto y carpeta de datos inexistente. Arranca su propio servidor standalone (sin API key)
// en un puerto aparte y una carpeta temporal. Requiere `next build` + `node electron/prepare.cjs`.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverJs = path.join(here, "..", ".next", "standalone", "server.js");
const PORT = process.env.JARVIS_ROBUST_PORT || "3824";
process.env.JARVIS_TEST_URL = `http://127.0.0.1:${PORT}`;
const { execute, check, summary, BASE } = await import("./lib.mjs");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-robust-"));
let child = null;

async function startServer(dataDir) {
  child = spawn(process.execPath, [serverJs], {
    cwd: path.dirname(serverJs),
    env: { ...process.env, PORT, HOSTNAME: "127.0.0.1", JARVIS_DATA_DIR: dataDir, NODE_ENV: "production", OPENROUTER_API_KEY: "" },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(BASE + "/api/settings");
      return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error("el servidor no arrancó");
}
async function stopServer() {
  if (!child) return;
  const c = child;
  child = null;
  c.kill();
  await new Promise((r) => c.once("exit", r));
  await sleep(300);
}
const due = async () => (await (await fetch(BASE + "/api/reminders/due")).json());

try {
  // 1. Concurrencia
  const d1 = path.join(root, "datos");
  await startServer(d1);
  const N = 60;
  const rs = await Promise.all(Array.from({ length: N }, (_, i) => execute({ type: "note_add", text: `nota concurrente ${i}` })));
  check(`${N} note_add concurrentes: todos 200`, rs.every((r) => r.status === 200), rs.filter((r) => r.status !== 200).map((r) => r.text).join("|"));
  let notes = JSON.parse(fs.readFileSync(path.join(d1, "notas.json"), "utf8"));
  check("notas.json válido con las 60 notas sin duplicados ni pérdidas",
    notes.length === N && new Set(notes.map((n) => n.id)).size === N, `len=${notes.length}`);
  const mixed = await Promise.all([
    ...Array.from({ length: 20 }, (_, i) => execute({ type: "note_add", text: `mezcla ${i}` })),
    ...Array.from({ length: 20 }, () => execute({ type: "note_list" })),
    ...Array.from({ length: 10 }, (_, i) => execute({ type: "note_delete", query: `concurrente ${i}` })),
  ]);
  notes = JSON.parse(fs.readFileSync(path.join(d1, "notas.json"), "utf8"));
  check("operaciones mezcladas concurrentes: archivo sigue siendo JSON válido", Array.isArray(notes), `len=${notes.length}`);
  console.log(`   (borrados ambiguos esperables: ${mixed.slice(40).filter((r) => r.json?.ok === false).length}/10; "concurrente 1" coincide con 1x)`);

  // 2. Persistencia tras reinicio + recordatorio vencido con el servidor apagado
  await execute({ type: "note_add", text: "persistente-xyz" });
  const soon = new Date(Date.now() + 5000).toISOString().slice(0, 19) + "Z";
  const far = new Date(Date.now() + 3600_000).toISOString().slice(0, 19) + "Z";
  await execute({ type: "reminder_add", text: "vence-apagado", at: soon });
  await execute({ type: "reminder_add", text: "lejano", at: far });
  await stopServer();
  await sleep(6000); // vence mientras el servidor está apagado
  await startServer(d1);
  const ls = await execute({ type: "note_search", query: "persistente-xyz" });
  check("notas persisten tras reiniciar", ls.json?.message?.includes("persistente-xyz"), ls.text);
  const pend = await execute({ type: "reminder_list" });
  check("recordatorio lejano sigue pendiente tras reiniciar", pend.json?.message?.includes("lejano"), pend.text);
  let dd = await due();
  check("recordatorio vencido con servidor apagado sale en la primera consulta", dd.due.length === 1 && dd.due[0].text === "vence-apagado", JSON.stringify(dd));
  dd = await due();
  check("... y solo una vez", dd.due.length === 0, JSON.stringify(dd));
  await stopServer();
  await startServer(d1);
  dd = await due();
  check("... tampoco se repite tras otro reinicio", dd.due.length === 0, JSON.stringify(dd));

  // 3. JSON corrupto
  await stopServer();
  const d2 = path.join(root, "corrupto");
  fs.mkdirSync(d2);
  fs.writeFileSync(path.join(d2, "notas.json"), '[{"id":"a","text":"hola","createdAt":"2026-01-01"},{"id":');
  fs.writeFileSync(path.join(d2, "recordatorios.json"), "\u0000\u0000basura");
  fs.writeFileSync(path.join(d2, "settings.json"), "{no es json");
  await startServer(d2);
  let r = await execute({ type: "note_list" });
  check("notas.json truncado: el servidor responde (lista vacía, sin 500)", r.status === 200, r.text);
  r = await (await fetch(BASE + "/api/reminders/due")).json();
  check("recordatorios.json corrupto: /due responde {due:[]}", Array.isArray(r.due), JSON.stringify(r));
  const settingsRes = await fetch(BASE + "/api/settings");
  check("settings.json corrupto: GET /api/settings usa valores por defecto", settingsRes.status === 200, await settingsRes.text());
  r = await execute({ type: "note_add", text: "después de corrupto" });
  check("note_add tras corrupción: ok", r.status === 200, r.text);
  const files = fs.readdirSync(d2);
  console.log("   archivos tras escribir sobre notas.json corrupto:", files.join(", "));
  check("se conserva copia del JSON corrupto (no se pierde el contenido en silencio)", files.some((f) => /notas\.json\.(corrupt|bak|corrupto)/i.test(f)), files.join(","));

  // Estructuras válidas pero raras
  await stopServer();
  fs.writeFileSync(path.join(d2, "notas.json"), JSON.stringify({ no: "es array" }));
  await startServer(d2);
  r = await execute({ type: "note_list" });
  check("notas.json con objeto en vez de array: sin 500", r.status === 200, r.text);
  await stopServer();
  fs.writeFileSync(path.join(d2, "notas.json"), JSON.stringify([null, 5, "x", { id: "ok1", text: "válida", createdAt: "2026-01-01T00:00:00Z" }, { id: 7 }]));
  await startServer(d2);
  r = await execute({ type: "note_list" });
  check("entradas inválidas se descartan, la válida se conserva", r.json?.message?.includes("1 nota") && r.json.message.includes("válida"), r.text);

  // 4. Carpeta de datos inexistente / imposible
  await stopServer();
  const d3 = path.join(root, "no", "existe", "aun");
  await startServer(d3);
  dd = await due();
  check("carpeta inexistente: /due responde sin error", Array.isArray(dd.due) && !dd.error, JSON.stringify(dd));
  r = await execute({ type: "note_add", text: "crea la carpeta" });
  check("carpeta inexistente: note_add la crea (recursivo)", r.status === 200 && fs.existsSync(path.join(d3, "notas.json")), r.text);
  await stopServer();
  const blocker = path.join(root, "soy-un-archivo");
  fs.writeFileSync(blocker, "x");
  await startServer(path.join(blocker, "sub"));
  r = await execute({ type: "note_add", text: "no se puede" });
  check("carpeta imposible (cuelga de un archivo): 500 con mensaje, el servidor sigue vivo", r.status === 500 && !!r.json?.error, r.text);
  const alive = await fetch(BASE + "/api/settings");
  check("... y sigue respondiendo", alive.status === 200);
} finally {
  await stopServer();
  fs.rmSync(root, { recursive: true, force: true });
}
process.exit(summary() ? 1 : 0);
