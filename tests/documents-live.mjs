// LIVE: llama a OpenRouter DE VERDAD y CUESTA DINERO (unos centavos por documento). NO forma parte de run-all
// ni de la validación habitual. Pide un informe real con la skill informe-formal (Word) y una tabla de gastos (Excel)
// e imprime coste, tiempo y la ruta generada.
//
// Requisitos: una API key real en OPENROUTER_API_KEY o en settings.json de JARVIS_DATA_DIR, y confirmación explícita:
//   JARVIS_LIVE=1 OPENROUTER_API_KEY=sk-or-... node tests/documents-live.mjs
// Los archivos se guardan en una carpeta temporal (JARVIS_DOCS_DIR), no en tu Documentos. Usa el modelo de ajustes
// (docModel o model); para abaratar: JARVIS_DATA_DIR con {"docModel":"anthropic/claude-haiku-5.5"}.
import "./ts-register.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

if (process.env.JARVIS_LIVE !== "1") {
  console.error("Esta prueba cuesta dinero real. Ejecútala con JARVIS_LIVE=1 si de verdad quieres hacerlo.");
  process.exit(2);
}
if (process.env.OPENROUTER_CHAT_URL_OVERRIDE) {
  console.error("Quita OPENROUTER_CHAT_URL_OVERRIDE: esta prueba debe ir al OpenRouter real.");
  process.exit(2);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-live-"));
process.env.JARVIS_DOCS_DIR = process.env.JARVIS_DOCS_DIR || path.join(tmp, "docs");
process.env.JARVIS_TEST_NO_SPAWN = "1"; // no abrir ventanas
process.env.JARVIS_DATA_DIR = process.env.JARVIS_DATA_DIR || path.join(tmp, "data");
fs.mkdirSync(process.env.JARVIS_DATA_DIR, { recursive: true });
if (!fs.existsSync(path.join(process.env.JARVIS_DATA_DIR, "settings.json"))) {
  fs.writeFileSync(path.join(process.env.JARVIS_DATA_DIR, "settings.json"), JSON.stringify({ docReveal: false }));
}

const create = await import("../src/lib/docs/create.server.ts");
const usage = await import("../src/lib/usage.server.ts");

const cases = [
  {
    name: "Informe Word con la skill informe-formal",
    input: {
      format: "docx",
      title: "Informe de ventas del tercer trimestre",
      brief: "Informe formal para la gerencia sobre las ventas del tercer trimestre de una tienda de ropa: resumen ejecutivo, resultados por mes, análisis y recomendaciones. No tengo cifras: usa marcadores [COMPLETAR].",
      skill: "informe-formal",
    },
  },
  {
    name: "Excel de gastos mensuales",
    input: {
      format: "xlsx",
      title: "Gastos mensuales",
      brief: "Tabla de gastos mensuales del hogar con columnas Concepto, Categoría, Monto y Fecha; 12 filas de ejemplo con montos ficticios y una fila de total.",
    },
  },
];

let failed = 0;
for (const c of cases) {
  const before = usage.sessionUsage().byKind.doc.costUsd;
  const t0 = Date.now();
  const r = await create.createDocument(c.input);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const rec = (await (await import("../src/lib/docs/history.server.ts")).listDocumentRecords(1))[0];
  const spent = usage.sessionUsage().byKind.doc.costUsd - before;
  console.log(`\n== ${c.name}\n  ok=${r.ok}  tiempo=${secs}s  coste=$${spent.toFixed(4)}\n  mensaje: ${r.message}\n  ruta: ${r.ok ? rec?.path : "(ninguna)"}`);
  if (!r.ok || !rec || !fs.existsSync(rec.path)) failed++;
}
console.log(`\nCoste total de la sesión (doc): $${usage.sessionUsage().byKind.doc.costUsd.toFixed(4)}`);
process.exit(failed ? 1 : 0);
