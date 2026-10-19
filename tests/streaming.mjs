// Voz en tiempo real: (a) parser incremental y corte en frases (unitario, sin red),
// (b) /api/brain con stream:true contra el servidor real, (c) tiempos reales vs el flujo antiguo.
// (b) y (c) necesitan un servidor con OPENROUTER_API_KEY en el entorno y JARVIS_DATA_DIR temporal
// (JARVIS_TEST_URL, por defecto :3822). Gastan unas pocas llamadas reales (cerebro y voz).
// Uso: node tests/streaming.mjs            (todo)      |  JARVIS_STREAM_UNIT_ONLY=1 solo (a)
import { ReplyStream, SentenceSplitter, normalizeSpaces } from "../src/lib/replystream.ts";
import { BASE, check, summary } from "./lib.mjs";

// ---------------------------------------------------------------- (a) parser incremental
function feed(text, cuts) {
  const rs = new ReplyStream();
  let out = "";
  let prev = 0;
  for (const c of [...cuts, text.length]) {
    out += rs.push(text.slice(prev, c));
    prev = c;
  }
  return { rs, out };
}
const rnd = (n) => Math.floor(Math.random() * n);
function randomCuts(len) {
  const k = rnd(8);
  return [...new Set(Array.from({ length: k }, () => rnd(len + 1)))].sort((a, b) => a - b);
}

const cases = {
  simple: { text: '{"action":null,"reply":"Hola William."}', reply: "Hola William." },
  escapes: { text: '{"action":null,"reply":"Línea 1\\nlínea \\"dos\\"\\t\\\\ barra \\/ fin"}', reply: 'Línea 1\nlínea "dos"\t\\ barra / fin' },
  unicode: { text: '{"action":null,"reply":"Qu\\u00e9 d\\u00eda tan \\u00fatil, se\\u00f1or \\ud83d\\ude00 ok"}', reply: "Qué día tan útil, señor 😀 ok" },
  rawUtf8: { text: '{"action":null,"reply":"¿Cómo estás? ¡Qué bien! — ñandú 日本 😀"}', reply: "¿Cómo estás? ¡Qué bien! — ñandú 日本 😀" },
  empty: { text: '{"action":null,"reply":""}', reply: "" },
  replyFirst: { text: '{"reply":"Primero la respuesta.","action":null}', reply: "Primero la respuesta." },
  withAction: {
    text: '{"action":{"type":"email","to":"a@b.com","subject":"Hola, \\"reply\\": {x}","body":"cuerpo }"},"reply":"Te dejé listo el correo."}',
    reply: "Te dejé listo el correo.",
    values: { action: '{"type":"email","to":"a@b.com","subject":"Hola, \\"reply\\": {x}","body":"cuerpo }"}' },
  },
  search: { text: '{"action": null, "search": "dólar hoy", "reply": "Déjame buscarlo."}', reply: "Déjame buscarlo.", values: { action: "null", search: '"dólar hoy"' } },
  spaces: { text: '  {\n  "action" :  null ,\n  "reply" : "con espacios" \n}\n', reply: "con espacios" },
  fenced: { text: 'Claro:\n```json\n{"action":null,"reply":"Dentro de valla."}\n```\nFin.', reply: "Dentro de valla." },
  trailing: { text: '{"action":null,"reply":"Antes."} texto extra {"reply":"NO"}', reply: "Antes." },
  nestedArr: { text: '{"extra":[1,{"reply":"no"},[2]],"action":null,"reply":"ok"}', reply: "ok" },
  numbers: { text: '{"n":12,"b":true,"reply":"x"}', reply: "x" },
};
for (const [name, c] of Object.entries(cases)) {
  let ok = true;
  let why = "";
  // byte a byte + 200 particiones aleatorias + todos los puntos de corte simples
  const variants = [Array.from({ length: c.text.length }, (_, i) => i), ...Array.from({ length: 200 }, () => randomCuts(c.text.length))];
  for (let i = 0; i <= c.text.length; i++) variants.push([i]);
  for (const cuts of variants) {
    const { rs, out } = feed(c.text, cuts);
    if (out !== c.reply || rs.reply !== c.reply) {
      ok = false;
      why = `cuts=${cuts.slice(0, 8)} got=${JSON.stringify(out)}`;
      break;
    }
    if (c.values) for (const [k, v] of Object.entries(c.values)) if (rs.values[k] !== v) { ok = false; why = `values.${k}=${rs.values[k]}`; }
    if (!ok) break;
  }
  check(`parser: ${name} (corte en cualquier punto)`, ok, why);
}
{
  const { rs } = feed('{"action":null,"reply":"hola"}', []);
  check("parser: replyStarted/replyDone/objectDone", rs.replyStarted && rs.replyDone && rs.objectDone);
  const part = new ReplyStream();
  part.push('{"action":null,"reply":"cort');
  check("parser: reply sin cerrar queda replyDone=false", part.replyStarted && !part.replyDone && part.reply === "cort");
  const noReply = new ReplyStream();
  noReply.push("Esto no es JSON, es texto plano.");
  check("parser: texto sin JSON no produce reply", !noReply.replyStarted && noReply.reply === "");
}
// Ruido hostil: nunca debe lanzar excepciones.
{
  let threw = false;
  for (let i = 0; i < 300; i++) {
    const junk = Array.from({ length: 1 + rnd(80) }, () => '{}[]":,\\u0123 abn\n'[rnd(18)]).join("");
    try { new ReplyStream().push(junk); } catch { threw = true; }
  }
  check("parser: 300 entradas basura sin excepciones", !threw);
}

function split(text, chunk = 7) {
  const sp = new SentenceSplitter();
  const out = [];
  for (let i = 0; i < text.length; i += chunk) out.push(...sp.push(text.slice(i, i + chunk)));
  out.push(...sp.flush());
  return out;
}
const same = (text, parts) => normalizeSpaces(parts.join(" ")) === normalizeSpaces(text);
{
  const t1 = "Hola William. Hoy tienes tres reuniones y una llamada pendiente. ¿Quieres que te las lea? Claro que sí.";
  let p = split(t1);
  check("frases: separa por . ? y conserva todo el texto", p.length >= 2 && same(t1, p), JSON.stringify(p));
  const t2 = "El Sr. Pérez llegó a las 5.30 con el Dr. García. Después hablaron de 3.5 kilos de harina.";
  p = split(t2);
  check("frases: no corta en Sr./Dr./decimales", p.length === 2 && same(t2, p), JSON.stringify(p));
  const t3 = "Sí. Vale. Listo. Entonces nos vemos mañana por la tarde en la oficina del centro.";
  p = split(t3);
  check("frases: las muy cortas se funden con la siguiente", p.length <= 2 && same(t3, p), JSON.stringify(p));
  const t4 = "Espera... ¿en serio?! No me lo creo. Bueno, vale.";
  p = split(t4);
  check("frases: puntos suspensivos y ?! no rompen texto", same(t4, p), JSON.stringify(p));
  const t5 = "Primera línea larga con contenido suficiente\nsegunda línea también con contenido bastante largo\ny tercera.";
  p = split(t5);
  check("frases: salto de línea corta si hay largo suficiente", p.length >= 2 && same(t5, p), JSON.stringify(p));
  const t6 = "palabra ".repeat(120).trim() + ".";
  p = split(t6);
  check("frases: texto interminable se corta en <= 400 caracteres", p.length >= 2 && p.every((s) => s.length <= 400) && same(t6, p), p.map((s) => s.length));
  p = split("");
  check("frases: texto vacío no emite nada", p.length === 0);
  const t7 = "Sin punto final";
  p = split(t7);
  check("frases: sin punto final se emite al hacer flush", p.length === 1 && p[0] === t7);
  // Primera frase corta pero con >= firstMin: sale pronto (latencia al primer sonido).
  const sp = new SentenceSplitter();
  const early = sp.push("Claro que sí, William. Y ade");
  check("frases: la primera frase sale en cuanto cierra", early.length === 1 && early[0] === "Claro que sí, William.", JSON.stringify(early));
}

// ---------------------------------------------------------------- (b) y (c) servidor real
let up = false;
if (!process.env.JARVIS_STREAM_UNIT_ONLY) {
  try {
    up = (await fetch(BASE + "/api/settings")).ok;
  } catch {}
  if (!up) console.log(`SKIP  servidor no disponible en ${BASE}: se omiten (b) y (c)`);
}

/** Llama a /api/brain en streaming y devuelve eventos con marcas de tiempo (ms desde el envío). */
async function streamCall(message, history = []) {
  const t0 = performance.now();
  const res = await fetch(BASE + "/api/brain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history, stream: true }),
  });
  const events = [];
  if (!res.ok || !res.body) return { res, events, t0, text: await res.text() };
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (ev && data) events.push({ ev, data: JSON.parse(data), t: performance.now() - t0 });
    }
  }
  return { res, events, t0 };
}

async function speakMs(text) {
  const t0 = performance.now();
  const res = await fetch(BASE + "/api/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  const bytes = (await res.arrayBuffer()).byteLength;
  return { ms: performance.now() - t0, ok: res.ok && bytes > 1000 };
}

if (up) {
  // ---- (b) contrato
  let r = await streamCall("Cuéntame en tres frases por qué el cielo es azul.");
  let sentences = r.events.filter((e) => e.ev === "sentence");
  let done = r.events.filter((e) => e.ev === "done");
  check("stream: content-type text/event-stream", (r.res.headers.get("content-type") || "").includes("text/event-stream"));
  check("stream: orden de eventos (frases... y un único done al final)",
    done.length === 1 && r.events.at(-1).ev === "done" && r.events.slice(0, -1).every((e) => e.ev === "sentence"),
    r.events.map((e) => e.ev).join(","));
  check("stream: índices de frase consecutivos", sentences.every((e, i) => e.data.index === i));
  check("stream: suma de frases == reply final", done[0] && same(done[0].data.reply, sentences.map((e) => e.data.text)),
    JSON.stringify({ s: sentences.map((e) => e.data.text), reply: done[0]?.data.reply }));
  check("stream: charla normal sin acción", done[0]?.data.action === null && !done[0]?.data.actionToken);

  r = await streamCall("Mándale un correo a ana@example.com con asunto Reunión diciendo que llego tarde");
  done = r.events.filter((e) => e.ev === "done");
  sentences = r.events.filter((e) => e.ev === "sentence");
  check("stream: acción email válida en done (se ejecuta en el cliente: sin firma)",
    done[0]?.data.action?.type === "email" && done[0].data.action.to === "ana@example.com",
    JSON.stringify(done[0]?.data).slice(0, 200));
  check("stream: con acción de confirmación la frase llega antes que done o coincide con reply",
    sentences.length === 0 || same(done[0].data.reply, sentences.map((e) => e.data.text)));

  // Acción de confirmación que ejecuta el servidor: debe llegar firmada (solo se propone, no se ejecuta).
  r = await streamCall("Pon el volumen de la computadora al 20 por ciento");
  done = r.events.filter((e) => e.ev === "done");
  sentences = r.events.filter((e) => e.ev === "sentence");
  check("stream: acción volume (confirm/servidor) con actionToken firmado en done",
    done[0]?.data.action?.type === "volume" && typeof done[0].data.actionToken === "string" && done[0].data.actionToken.length > 20,
    JSON.stringify(done[0]?.data).slice(0, 200));
  check("stream: con volume la suma de frases == reply", sentences.length === 0 || same(done[0].data.reply, sentences.map((e) => e.data.text)));

  r = await streamCall("Anota una nota que diga zzstream prueba");
  done = r.events.filter((e) => e.ev === "done");
  sentences = r.events.filter((e) => e.ev === "sentence");
  check("stream: acción que se ejecuta sola -> solo done (sin frases)", done.length === 1 && sentences.length === 0 && done[0].data.action?.type?.startsWith("note"),
    r.events.map((e) => e.ev).join(",") + " " + JSON.stringify(done[0]?.data.action));

  // Búsqueda web: segundo paso sin streaming parcial -> done con fuentes y sin frases del "Déjame buscarlo".
  r = await streamCall("¿Cuál es el resultado del último partido de la selección argentina de fútbol?");
  done = r.events.filter((e) => e.ev === "done");
  sentences = r.events.filter((e) => e.ev === "sentence");
  check("stream: búsqueda web -> done con respuesta y fuentes, sin frases previas",
    done.length === 1 && r.events.length === 1 && sentences.length === 0 && done[0].data.reply.length > 20 && (done[0].data.sources === undefined || Array.isArray(done[0].data.sources)),
    r.events.map((e) => e.ev).join(",") + " " + JSON.stringify(done[0]?.data).slice(0, 200));

  // Peticiones inválidas siguen respondiendo JSON normal (no SSE).
  let bad = await fetch(BASE + "/api/brain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stream: true }) });
  check("stream: sin mensaje -> 400 JSON", bad.status === 400);
  bad = await fetch(BASE + "/api/brain", { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ message: "x", stream: true }) });
  check("stream: text/plain sigue rechazado (415)", bad.status === 415);

  // Cancelar a mitad no deja el servidor colgado.
  {
    const ac = new AbortController();
    const res = await fetch(BASE + "/api/brain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "Cuéntame algo largo sobre la historia de Roma", stream: true }), signal: ac.signal });
    const reader = res.body.getReader();
    await reader.read();
    ac.abort();
    await new Promise((r2) => setTimeout(r2, 300));
    const ping = await fetch(BASE + "/api/settings");
    check("stream: abortar el cliente a mitad no rompe el servidor", ping.ok);
  }

  // ---- (c) tiempos reales
  const questions = [
    "Cuéntame en tres frases por qué el cielo es azul.",
    "Dame tres consejos breves para dormir mejor.",
    "Explícame en pocas frases cómo funciona un motor de combustión.",
  ];
  const rows = [];
  for (const q of questions) {
    // Flujo antiguo: cerebro completo -> /api/speak con todo el texto.
    const t0 = performance.now();
    const old = await (await fetch(BASE + "/api/brain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: q, history: [] }) })).json();
    const oldBrain = performance.now() - t0;
    const oldSpeak = await speakMs(old.reply);
    const oldFirstSound = oldBrain + oldSpeak.ms;

    // Flujo nuevo: primera frase -> /api/speak de esa frase (el audio de la siguiente va en paralelo).
    const s = await streamCall(q);
    const sents = s.events.filter((e) => e.ev === "sentence");
    const dn = s.events.find((e) => e.ev === "done");
    const firstSentenceAt = sents[0]?.t ?? NaN;
    const firstSpeak = sents[0] ? await speakMs(sents[0].data.text) : { ms: NaN, ok: false };
    rows.push({ q: q.slice(0, 38), frases: sents.length, brainTotalAntiguo: oldBrain, sonidoAntiguo: oldFirstSound, primeraFrase: firstSentenceAt, doneStream: dn?.t, sonidoStream: firstSentenceAt + firstSpeak.ms, ttsOk: oldSpeak.ok && firstSpeak.ok });
    check(`tiempos: "${q.slice(0, 30)}" -> primera frase llega antes que done`, sents.length >= 1 && firstSentenceAt < dn.t, `${Math.round(firstSentenceAt)}ms vs ${Math.round(dn?.t)}ms`);
  }
  console.log("\nTiempos reales (ms): sonido = hasta que HABRÍA audio listo (cerebro + TTS), sin contar la reproducción");
  console.table(rows.map((r2) => Object.fromEntries(Object.entries(r2).map(([k, v]) => [k, typeof v === "number" ? Math.round(v) : v]))));
  const avg = (k) => Math.round(rows.reduce((a, b) => a + b[k], 0) / rows.length);
  console.log(`Media: primer sonido antiguo ${avg("sonidoAntiguo")} ms | primer sonido streaming ${avg("sonidoStream")} ms | primera frase ${avg("primeraFrase")} ms | done ${avg("doneStream")} ms`);
}

process.exit(summary() ? 1 : 0);
