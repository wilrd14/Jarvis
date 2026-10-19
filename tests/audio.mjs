// /api/speak y /api/listen: WAV válido, ida y vuelta (TTS -> STT) y fallos con mensaje claro.
import { BASE, post, check, summary } from "./lib.mjs";

function wavInfo(buf) {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") return null;
  const rate = buf.readUInt32LE(24);
  const dataLen = buf.readUInt32LE(40);
  return { rate, dataLen, riffLen: buf.readUInt32LE(4), seconds: dataLen / (rate * 2), total: buf.length };
}

async function speak(text) {
  const res = await fetch(BASE + "/api/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, buf, type: res.headers.get("content-type") };
}

function checkWav(name, r, minSec, maxSec) {
  const info = r.status === 200 ? wavInfo(r.buf) : null;
  check(
    `${name}: WAV válido y duración razonable`,
    !!info && info.riffLen === info.total - 8 && info.dataLen === info.total - 44 && info.seconds >= minSec && info.seconds <= maxSec,
    info ? `${info.seconds.toFixed(1)} s @${info.rate} Hz` : `status ${r.status} ${r.buf.toString("utf8").slice(0, 200)}`
  );
  return info;
}

let r = await speak("Hola William, esta es una prueba.");
checkWav("speak corto", r, 0.8, 8);
const shortWav = r.buf;

const long = "El asistente Jarvis revisa tus notas, recordatorios y correos cada mañana para que no se te pase nada importante. ".repeat(5).slice(0, 600);
r = await speak(long);
checkWav("speak 600 chars", r, 15, 120);

r = await speak('Dijo "¡Cañón!" y 😀 se fue.\nSegunda línea con acentos: áéíóú ü ñ — «comillas» \'simples\'.');
checkWav("speak comillas/acentos/emoji/saltos", r, 2, 30);

r = await speak("");
check("speak vacío: 400 con error", r.status === 400, r.buf.toString("utf8").slice(0, 150));
r = await post("/api/speak", "{roto");
check("speak JSON roto: 400", r.status === 400, `${r.status} ${r.text.slice(0, 100)}`);
r = await post("/api/speak", { text: 42 });
check("speak text no-string: 400", r.status === 400, `${r.status}`);

r = await speak("palabra ".repeat(6250)); // ~50k chars
console.log(`   speak 50k chars -> status ${r.status}, ${r.buf.length} bytes, ${r.buf.toString("utf8", 0, 160).replace(/\n/g, " ")}`);
check("speak enorme: respuesta controlada (no 500 opaco)", r.status === 200 || (r.status >= 400 && r.status < 500) || r.buf.toString("utf8").includes("error"), `${r.status}`);

// STT: transcribir el audio generado
const heard = await fetch(BASE + "/api/listen", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: shortWav });
const hj = await heard.json().catch(() => null);
console.log("   transcripción:", JSON.stringify(hj));
check("listen: transcribe el audio de speak", heard.status === 200 && /prueba/i.test(hj?.text ?? "") && /william|hola/i.test(hj?.text ?? ""), JSON.stringify(hj));

let lr = await fetch(BASE + "/api/listen", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: Buffer.alloc(0) });
check("listen vacío: 400 'No llegó audio'", lr.status === 400, await lr.text());
lr = await fetch(BASE + "/api/listen", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: Buffer.alloc(30) });
check("listen 30 bytes: 400", lr.status === 400, await lr.text());

// Silencio (WAV válido de 1 s de ceros) y ruido
function makeWav(pcm) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
lr = await fetch(BASE + "/api/listen", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: makeWav(Buffer.alloc(32000)) });
let lj = await lr.json().catch(() => null);
console.log("   silencio ->", lr.status, JSON.stringify(lj));
check("listen silencio: sin 5xx, texto vacío o error claro", lr.status < 500 && (lj?.text === "" || !!lj?.error), JSON.stringify(lj));
const noise = Buffer.alloc(32000);
for (let i = 0; i < noise.length; i++) noise[i] = Math.floor(Math.random() * 256);
lr = await fetch(BASE + "/api/listen", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: makeWav(noise) });
lj = await lr.json().catch(() => null);
console.log("   ruido ->", lr.status, JSON.stringify(lj));
check("listen ruido: sin 5xx opaco", lr.status < 500 || !!lj?.error, JSON.stringify(lj));
lr = await fetch(BASE + "/api/listen", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: Buffer.from("esto no es un wav pero tiene mas de cien bytes ".repeat(5)) });
lj = await lr.json().catch(() => null);
console.log("   corrupto ->", lr.status, JSON.stringify(lj));
check("listen corrupto: error claro en JSON", lr.status !== 500 && (!!lj?.error || lj?.text === ""), JSON.stringify(lj));
lr = await fetch(BASE + "/api/listen", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: Buffer.alloc(9 * 1024 * 1024) });
check("listen >8 MB: 413", lr.status === 413, await lr.text());

process.exit(summary() ? 1 : 0);
