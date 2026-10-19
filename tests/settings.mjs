// /api/settings: no filtra la key, PUT parcial, precedencia settings.json > env y uso de key nueva sin reiniciar.
// Requiere: servidor con OPENROUTER_API_KEY válida en el entorno y un settings.json inicial con
// {"openrouterApiKey":"sk-or-v1-bogus1234"} en JARVIS_DATA_DIR. La key buena llega en JARVIS_TEST_GOOD_KEY
// (nunca se imprime).
import { BASE, post, brain, check, summary } from "./lib.mjs";

const good = process.env.JARVIS_TEST_GOOD_KEY || "";
const put = (body) =>
  fetch(BASE + "/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

let r = await (await fetch(BASE + "/api/settings")).text();
check("GET no contiene la key completa", !r.includes("bogus") && !r.includes("openrouterApiKey") && r.includes('"keyLast4":"1234"'), r);

let res = await put({ model: "anthropic/claude-sonnet-5.5", silenceMs: 99999, conversationMode: true });
let j = await res.json();
check("PUT parcial: guarda y recorta silenceMs a 5000", res.status === 200 && j.silenceMs === 5000 && j.conversationMode === true && j.hasKey, JSON.stringify(j));
check("PUT parcial conserva la key", j.keyLast4 === "1234", JSON.stringify(j));

res = await put({ openrouterApiKey: "", ttsVoice: "george" });
j = await res.json();
check("PUT con key vacía no borra la existente", res.status === 200 && j.keyLast4 === "1234", JSON.stringify(j));
res = await put({ foo: "bar", silenceMs: "x", model: "bad\nmodel" });
check("PUT sin campos válidos: 400", res.status === 400, await res.text());
res = await fetch(BASE + "/api/settings", { method: "PUT", body: "{no" });
check("PUT JSON roto: 400", res.status === 400, await res.text());
res = await put({ openrouterApiKey: "k".repeat(301) });
check("PUT key de 301 chars se ignora (400)", res.status === 400, await res.text());

// Precedencia: la key falsa de settings.json gana sobre la buena del entorno => el cerebro falla.
let b = await brain("hola");
check("settings.json gana al entorno (key falsa => OpenRouter rechaza)", b.status === 401 || b.status === 403 || (b.json?.error ?? "").includes("OpenRouter"), `${b.status} ${b.text.slice(0, 120)}`);

if (good) {
  res = await put({ openrouterApiKey: good });
  j = await res.json();
  check("PUT key nueva: GET devuelve hasKey sin exponer la key", res.status === 200 && j.hasKey && !JSON.stringify(j).includes(good), `last4=${j.keyLast4}`);
  b = await brain("Responde solo con la palabra: listo");
  check("la key nueva se usa sin reiniciar el servidor", b.status === 200 && !!b.json?.reply, `${b.status} ${b.text.slice(0, 120)}`);
  const t = await post("/api/settings/test", {});
  check("settings/test valida la key guardada", t.json?.ok === true, t.text);
  const bad = await post("/api/settings/test", { apiKey: "sk-or-v1-bogus" });
  check("settings/test rechaza key falsa sin 5xx", bad.status === 200 && bad.json?.ok === false, bad.text);
} else {
  console.log("(JARVIS_TEST_GOOD_KEY no definida: se omiten las pruebas de key nueva)");
}

process.exit(summary() ? 1 : 0);
