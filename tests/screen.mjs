// "Entender la pantalla" (screen_ask). SEGURA: nunca manda tu pantalla real a internet.
//  - parse, 403 sin firma / firma falsa, y que el cerebro propone la acción (contra el servidor en JARVIS_TEST_URL).
//  - rate limit (importa guard.ts directamente).
//  - UNA llamada real al modelo de visión con un PNG sintético ("ERROR 404 prueba"); requiere OPENROUTER_API_KEY
//    en el entorno de este proceso (si no está, se omite).
//  - Captura real de pantalla: solo se comprueba que se genera y que el temporal se borra (no se envía a ningún sitio).
//    Solo se ejecuta con JARVIS_TEST_CAPTURE=1.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { check, post, brain, summary } from "./lib.mjs";

const root = path.resolve(import.meta.dirname, "..");
const actions = await import(pathToFileURL(path.join(root, "src/lib/actions/screen-vision.server.ts")).href);
const guard = await import(pathToFileURL(path.join(root, "src/lib/guard.ts")).href);

// ---- servidor ----
const act = { type: "screen_ask", question: "¿Qué dice este error?" };
let r = await post("/api/actions/execute", { action: act });
check("screen_ask sin firma -> 403", r.status === 403, `${r.status} ${r.text}`);
r = await post("/api/actions/execute", { action: act, actionToken: `${Date.now() + 60000}.${"a".repeat(64)}` });
check("screen_ask con firma falsa -> 403", r.status === 403, `${r.status}`);
r = await post("/api/actions/execute", { action: { type: "screen_ask", question: "x" }, actionToken: "1.a" });
check("screen_ask con pregunta inválida -> 400", r.status === 400, `${r.status}`);

r = await brain("¿Qué dice este error que tengo en pantalla?");
check(
  "el cerebro propone screen_ask firmada",
  r.json?.action?.type === "screen_ask" && typeof r.json?.actionToken === "string",
  r.text
);

// ---- rate limit ----
let allowed = 0;
for (let i = 0; i < 8; i++) if (guard.rateLimit("screen_ask_test", 6)) allowed++;
check("rate limit: 6 permitidas y luego se corta", allowed === 6, String(allowed));

// ---- PNG sintético ----
const png = path.join(os.tmpdir(), `jarvis-screen-test-${process.pid}.png`);
const ps = `
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 1200, 500
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::White)
$f = New-Object System.Drawing.Font 'Arial', 90, ([System.Drawing.FontStyle]::Bold)
$g.DrawString('ERROR 404 prueba', $f, [System.Drawing.Brushes]::DarkRed, 40, 80)
$f2 = New-Object System.Drawing.Font 'Arial', 36
$g.DrawString('Pagina no encontrada', $f2, [System.Drawing.Brushes]::Black, 40, 300)
$bmp.Save($env:T_OUT, [System.Drawing.Imaging.ImageFormat]::Png)
`;
spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(ps, "utf16le").toString("base64")], {
  env: { ...process.env, T_OUT: png },
});
const have = fs.existsSync(png);
check("PNG sintético generado", have);

const key = process.env.OPENROUTER_API_KEY;
if (!key || !have) {
  console.log("SKIP  llamada real a visión (falta OPENROUTER_API_KEY o PNG)");
} else {
  try {
    const t0 = Date.now();
    const text = await actions.askVisionModel({
      apiKey: key,
      model: process.env.OPENROUTER_VISION_MODEL || "google/gemini-3.1-flash-lite",
      image: fs.readFileSync(png),
      mime: "image/png",
      question: "¿Qué dice este error?",
    });
    console.log(`      respuesta (${Date.now() - t0} ms): ${text}`);
    check("visión entiende el PNG sintético", /404|no (se )?encontrad|no existe/i.test(text), text);
    check("respuesta sin markdown y ≤ 900 caracteres", !/[*#`]/.test(text) && text.length <= 900, text);
  } catch (e) {
    check("llamada a visión", false, `${e?.status ?? ""} ${e?.detail ?? e}`);
  }
}
try { fs.rmSync(png, { force: true }); } catch {}

// ---- captura real (sin enviarla) ----
if (process.env.JARVIS_TEST_CAPTURE === "1") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-cap-"));
  process.env.JARVIS_DATA_DIR = dir;
  const mod = await import(pathToFileURL(path.join(root, "src/lib/actions/screen.server.ts")).href);
  let tmp = "";
  const buf = await mod.captureScreenPng((f) => (tmp = f));
  check("captura real generada (PNG)", buf.length > 1000 && buf.subarray(1, 4).toString() === "PNG", `${buf.length} bytes`);
  check("el temporal se borró", tmp && !fs.existsSync(tmp), tmp);
  fs.rmSync(dir, { recursive: true, force: true });
} else {
  console.log("SKIP  captura real (JARVIS_TEST_CAPTURE=1 para probarla; no se envía a ningún sitio)");
}

process.exit(summary() ? 1 : 0);
