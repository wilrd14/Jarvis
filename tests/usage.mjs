// /api/usage: campos esperados sin filtrar la key, caché y tope mensual con bloqueo (402).
// Requiere un servidor con OPENROUTER_API_KEY válida en el entorno y JARVIS_DATA_DIR temporal;
// la misma key en JARVIS_TEST_GOOD_KEY (solo para comprobar que no se filtra; nunca se imprime).
// No gasta saldo: el bloqueo se prueba con /api/listen (audio vacío => 400 sin llamar a OpenRouter).
import { BASE, check, summary } from "./lib.mjs";

const good = process.env.JARVIS_TEST_GOOD_KEY || "";
const put = (body) =>
  fetch(BASE + "/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const listen = () =>
  fetch(BASE + "/api/listen", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: new Uint8Array(10) });

await put({ monthlyBudgetUsd: 0, blockOnBudget: false });

let res = await fetch(BASE + "/api/usage");
let text = await res.text();
let j = JSON.parse(text);
check("GET /api/usage 200 con campos esperados",
  res.status === 200 && j.available === true && typeof j.usage === "number" && typeof j.spendMonth === "number" &&
  j.session?.byKind?.brain && j.budget && "overBudget" in j.budget, text.slice(0, 200));
check("no filtra la key ni su etiqueta", (!good || !text.includes(good)) && !/sk-or-/.test(text) && !/label/i.test(text));
check("no expone campos internos de la key", !/creator_user_id|workspace_id|organization_id/.test(text));

const first = j.fetchedAt;
const again = await (await fetch(BASE + "/api/usage")).json();
check("segunda consulta sale de la caché (mismo fetchedAt)", again.cached === true && again.fetchedAt === first);

// Validación de rangos
res = await put({ monthlyBudgetUsd: -5 });
j = await res.json();
check("tope negativo se recorta a 0", res.status === 200 && j.monthlyBudgetUsd === 0, JSON.stringify(j).slice(0, 150));
res = await put({ monthlyBudgetUsd: "abc", blockOnBudget: "si" });
check("tope/bloqueo inválidos: 400", res.status === 400);

// Sin bloqueo activo, aunque el tope esté superado no se bloquea.
await put({ monthlyBudgetUsd: 0.0001, blockOnBudget: false });
res = await listen();
check("tope superado sin blockOnBudget: no hay 402", res.status !== 402, String(res.status));
const u = await (await fetch(BASE + "/api/usage")).json();
check("usage marca overBudget con tope bajo", u.budget.overBudget === true && u.budget.percent > 100);

// Con bloqueo activo: 402 en brain, speak y listen.
await put({ monthlyBudgetUsd: 0.0001, blockOnBudget: true });
const post = (p, body) => fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
for (const [name, r] of [["brain", await post("/api/brain", { message: "hola" })], ["speak", await post("/api/speak", { text: "hola" })], ["listen", await listen()]]) {
  const b = await r.text();
  check(`bloqueo activo: /api/${name} responde 402 con mensaje claro`, r.status === 402 && b.includes("Llegaste al tope mensual de gasto que configuraste"), `${r.status} ${b.slice(0, 100)}`);
}

// Al subir el tope se desbloquea.
await put({ monthlyBudgetUsd: 100000, blockOnBudget: true });
res = await listen();
check("tope alto: se desbloquea (listen responde 400 por audio vacío, no 402)", res.status === 400, String(res.status));

await put({ monthlyBudgetUsd: 0, blockOnBudget: false });
process.exit(summary() ? 1 : 0);
