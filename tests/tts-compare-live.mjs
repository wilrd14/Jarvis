// LIVE - COSTES DINERO REAL - NO SE EJECUTA EN CI NI POR AGENTES.
// Genera la MISMA frase con cada preset de voz de Ajustes y guarda los WAV en una carpeta
// temporal para que William los escuche y compare. Imprime el coste estimado de cada uno.
// Cada ejecución hace una llamada de pago por preset (5 en total, unos céntimos como mucho).
//
// Uso:  OPENROUTER_API_KEY=sk-or-... node tests/tts-compare-live.mjs ["frase opcional"]
// Estado: NO verificado (nunca ejecutado). Las voces de Kokoro (em_alex) y Gemini (Kore) salen de la
// documentación de cada modelo; si OpenRouter rechaza alguna, el script lo muestra y sigue con las demás.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const key = process.env.OPENROUTER_API_KEY;
if (!key) {
  console.error("Falta OPENROUTER_API_KEY. (Este script gasta dinero real; no lo ejecutes sin querer.)");
  process.exit(2);
}
const phrase = process.argv[2] || "Buenos días, señor. Son las nueve y cuarto y tiene tres recordatorios para hoy.";

// Mantener sincronizado con VOICE_PRESETS de src/components/VoiceCostSettings.tsx.
// usdPerMChars: precio publicado ($/M caracteres); para Gemini es una estimación por tokens de audio.
const PRESETS = [
  { name: "eleven-flash-george", model: "elevenlabs/eleven-flash-v2.5", voice: "george", usdPerMChars: 40 },
  { name: "kokoro-em_alex", model: "hexgrad/kokoro-82m", voice: "em_alex", usdPerMChars: 0.62 },
  { name: "gemini-3.8-flash-lite-kore", model: "google/gemini-3.8-flash-lite-tts", voice: "Kore", usdPerMChars: 10 },
  { name: "gemini-3.8-flash-kore", model: "google/gemini-3.8-flash-tts", voice: "Kore", usdPerMChars: 15 },
  { name: "deepgram-aura2-alvaro", model: "deepgram/aura-2", voice: "aura-2-alvaro-es", usdPerMChars: 30 },
];

function pcm16ToWav(pcm, rate = 24000) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const out = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-tts-compare-"));
console.log(`Frase (${phrase.length} caracteres): ${phrase}\nCarpeta: ${out}\n`);

let total = 0;
for (const p of PRESETS) {
  const est = (phrase.length * p.usdPerMChars) / 1e6;
  try {
    const t0 = Date.now();
    const res = await fetch("https://openrouter.ai/api/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: p.model, voice: p.voice, input: phrase, response_format: "pcm" }),
    });
    if (!res.ok) {
      console.log(`${p.name}: ERROR ${res.status} ${(await res.text()).slice(0, 200)}`);
      continue;
    }
    const type = res.headers.get("content-type") || "";
    const buf = Buffer.from(await res.arrayBuffer());
    const rate = Number(type.match(/rate=(\d+)/)?.[1]) || 24000;
    const isWav = buf.subarray(0, 4).toString() === "RIFF";
    const file = path.join(out, `${p.name}.wav`);
    fs.writeFileSync(file, isWav ? buf : pcm16ToWav(buf, rate));
    const secs = isWav ? "?" : (buf.length / 2 / rate).toFixed(1);
    total += est;
    console.log(`${p.name}: OK ${Date.now() - t0} ms, ${secs} s de audio, ${type}, coste estimado $${est.toFixed(6)} -> ${file}`);
  } catch (e) {
    console.log(`${p.name}: FALLO ${e.message}`);
  }
}
console.log(`\nTotal estimado: $${total.toFixed(6)}. Comprueba el gasto real en https://openrouter.ai/activity`);
