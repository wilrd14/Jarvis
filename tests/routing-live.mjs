// ============================================================================================
// LIVE -- CUESTA DINERO. NO SE EJECUTA EN CI NI POR AGENTES. Lo corre William a mano.
// Compara la respuesta del modelo principal y del rapido en 10 casos y muestra coste y tiempos,
// para validar que el enrutador no baja la calidad. Hace 20 llamadas reales a OpenRouter
// (centavos en total, pero requiere saldo). Necesita OPENROUTER_API_KEY en el entorno.
// Uso: OPENROUTER_API_KEY=... node tests/routing-live.mjs
//   (opcional) MAIN_MODEL=anthropic/claude-sonnet-5.5 FAST_MODEL=anthropic/claude-haiku-5.5
// ============================================================================================
import { chooseModel } from "../src/lib/modelrouter.ts";

const key = process.env.OPENROUTER_API_KEY;
if (!key) {
  console.error("Falta OPENROUTER_API_KEY. Este script es LIVE y cuesta dinero; no se ejecuta sin ella.");
  process.exit(1);
}
const MAIN = process.env.MAIN_MODEL || "anthropic/claude-sonnet-5.5";
const FAST = process.env.FAST_MODEL || "anthropic/claude-haiku-5.5";
const MAX_TOKENS = Number(process.env.BRAIN_MAX_TOKENS || 2500);

const SYSTEM = `Eres Jarvis, asistente de voz de William. Respondes en español, breve y natural. Responde EXCLUSIVAMENTE con JSON {"action":null,"reply":"..."} (1 a 3 frases, sin markdown).`;

const CASES = [
  "Hola Jarvis, ¿cómo estás?",
  "¿Cuál es la capital de Australia?",
  "Cuéntame un chiste corto",
  "Sube el volumen",
  "Pon un temporizador de cinco minutos",
  "Redacta un correo breve a Juan pidiéndole la factura",
  "Recuérdame llamar a mamá el viernes a las seis",
  "¿Cuánto es el 18% de 2450?",
  "Compara en dos frases alquilar y comprar casa",
  "¿Por qué el cielo es azul?",
];

async function call(model, message) {
  const t0 = Date.now();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: message }],
    }),
  });
  const ms = Date.now() - t0;
  if (!res.ok) return { text: `ERROR ${res.status}: ${(await res.text()).slice(0, 200)}`, cost: 0, ms, out: 0 };
  const j = await res.json();
  const raw = j.choices?.[0]?.message?.content ?? "";
  let text = raw;
  try {
    text = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]).reply;
  } catch {
    text = `(JSON no valido o cortado) ${raw}`;
  }
  return { text, cost: j.usage?.cost ?? 0, ms, out: j.usage?.completion_tokens ?? 0 };
}

let costMain = 0;
let costFast = 0;
for (const [i, q] of CASES.entries()) {
  const route = chooseModel({ message: q, history: [], mainModel: MAIN, fastModel: FAST, strategy: "auto" });
  const [a, b] = [await call(MAIN, q), await call(FAST, q)];
  costMain += a.cost;
  costFast += b.cost;
  console.log(`\n#${i + 1} "${q}"`);
  console.log(`   enrutador elegiria: ${route.model === FAST ? "RAPIDO" : "PRINCIPAL"} (${route.reason})`);
  console.log(`   PRINCIPAL [${a.ms} ms, ${a.out} tok, $${a.cost.toFixed(5)}]: ${a.text}`);
  console.log(`   RAPIDO    [${b.ms} ms, ${b.out} tok, $${b.cost.toFixed(5)}]: ${b.text}`);
}
console.log(`\nCoste total: principal $${costMain.toFixed(5)} | rapido $${costFast.toFixed(5)} | ahorro ${costMain ? Math.round((1 - costFast / costMain) * 100) : 0}%`);
console.log("Revisa a mano: en los casos que el enrutador manda al RAPIDO, la respuesta rapida debe ser igual de buena.");
