// Caché de voz y manejo de formatos del TTS. NO gasta dinero: el "proveedor" es un servidor HTTP
// falso en 127.0.0.1:3934 que imita POST /audio/speech; la key es inventada.
//
// Parte A (siempre): pruebas unitarias de src/lib/ttsCache.server.ts y tts.server.ts con carpeta de datos temporal.
// Parte B (opcional): E2E contra /api/speak real si se define TTSCACHE_HTTP_URL. Arranca antes el servidor así:
//   JARVIS_DATA_DIR=<tmp> OPENROUTER_TTS_URL_OVERRIDE=http://127.0.0.1:3934/audio/speech JARVIS_ALLOW_TTS_URL_OVERRIDE=1 \
//   npx next start -p 3933 -H 127.0.0.1   y la misma carpeta en TTSCACHE_DATA_DIR (con settings.json con una key falsa).
//   Uso: TTSCACHE_HTTP_URL=http://127.0.0.1:3933 TTSCACHE_DATA_DIR=<tmp> node tests/ttscache.mjs
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { check, summary } from "./lib.mjs";

const FAKE_PORT = 3934;
const httpUrl = process.env.TTSCACHE_HTTP_URL;
const dataDir = process.env.TTSCACHE_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-ttscache-"));
if (!httpUrl) process.env.JARVIS_DATA_DIR = dataDir;
process.env.OPENROUTER_TTS_URL_OVERRIDE = `http://127.0.0.1:${FAKE_PORT}/audio/speech`;

// --- Servidor falso de /audio/speech ---------------------------------------------------------
const calls = [];
let mode = "pcm"; // pcm | wav | mp3 | badvoice | json | empty
const pcm = (n) => Buffer.alloc(n * 2, 1);
const fake = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    const j = JSON.parse(body || "{}");
    calls.push({ url: req.url, auth: req.headers.authorization, ...j });
    if (mode === "badvoice") {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: { message: `Invalid voice '${j.voice}' for model` } }));
    }
    if (mode === "json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end('{"hi":1}');
    }
    if (mode === "empty") {
      res.writeHead(200, { "Content-Type": "audio/pcm;rate=24000" });
      return res.end();
    }
    if (mode === "mp3") {
      res.writeHead(200, { "Content-Type": "audio/mpeg" });
      return res.end(Buffer.from("ID3fakemp3data"));
    }
    res.writeHead(200, { "Content-Type": "audio/pcm;rate=16000;channels=1" });
    res.end(pcm(1000));
  });
});
await new Promise((r) => fake.listen(FAKE_PORT, "127.0.0.1", r));

const settingsFile = path.join(dataDir, "settings.json");
fs.mkdirSync(dataDir, { recursive: true });
const writeCfg = (o) =>
  fs.writeFileSync(settingsFile, JSON.stringify({ openrouterApiKey: "sk-or-FAKE-test-key", ttsModel: "test/model-a", ttsVoice: "voz1", ...o }));
writeCfg({});

try {
  if (!httpUrl) {
    const C = await import("../src/lib/ttsCache.server.ts");
    const T = await import("../src/lib/tts.server.ts");
    const cdir = C.cacheDir();
    const names = () => (fs.existsSync(cdir) ? fs.readdirSync(cdir) : []);

    // --- Clave y normalización ---
    const k1 = C.cacheKey("m", "v", "Hola   mundo ");
    check("clave estable e independiente de espacios", k1 === C.cacheKey("m", "v", "Hola mundo") && /^[0-9a-f]{64}$/.test(k1));
    check("clave cambia con modelo, voz o texto", new Set([k1, C.cacheKey("m2", "v", "Hola mundo"), C.cacheKey("m", "v2", "Hola mundo"), C.cacheKey("m", "v", "hola mundo")]).size === 4);
    check("sin colisión modelo/voz ('a','bc' vs 'ab','c')", C.cacheKey("a", "bc", "x") !== C.cacheKey("ab", "c", "x"));
    check("textos > 120 caracteres no son cacheables", C.isCacheable("a".repeat(120)) && !C.isCacheable("a".repeat(121)) && !C.isCacheable("   "));

    // --- Fallo / acierto con el servidor falso ---
    let o = await T.speakCached("Hecho, señor.", "sk-or-FAKE");
    check("primera vez: miss, llama al proveedor y devuelve WAV válido",
      o.cache === "miss" && o.result.ok && calls.length === 1 && C.isValidWav(o.result.audio), JSON.stringify(o).slice(0, 120));
    check("el WAV usa la frecuencia del content-type (16000)", new DataView(o.result.audio.buffer, o.result.audio.byteOffset).getUint32(24, true) === 16000);
    check("el proveedor recibe modelo, voz, pcm y la key", calls[0].model === "test/model-a" && calls[0].voice === "voz1" && calls[0].response_format === "pcm" && calls[0].auth === "Bearer sk-or-FAKE");
    check("el archivo se llama solo con el hash (sin texto)", names().length === 1 && /^[0-9a-f]{64}\.wav$/.test(names()[0]) && !names()[0].toLowerCase().includes("hecho"));
    check("no quedan .tmp", !names().some((n) => n.endsWith(".tmp")));
    o = await T.speakCached("Hecho,   señor. ", "sk-or-FAKE");
    check("segunda vez (texto normalizado): hit y NO llama al servidor falso", o.cache === "hit" && calls.length === 1);

    // --- Voz distinta = otra entrada ---
    writeCfg({ ttsVoice: "voz2" });
    o = await T.speakCached("Hecho, señor.", "sk-or-FAKE");
    check("otra voz => miss y llamada nueva", o.cache === "miss" && calls.length === 2 && names().length === 2);
    writeCfg({});

    // --- Textos largos ---
    const long = "Esta es una respuesta larga. ".repeat(10);
    const before = names().length;
    o = await T.speakCached(long, "sk-or-FAKE");
    await T.speakCached(long, "sk-or-FAKE");
    check("texto largo: cache 'off', no se guarda, siempre llama", o.cache === "off" && names().length === before && calls.length === 4);

    // --- Ajuste ttsCache=false ---
    writeCfg({ ttsCache: false });
    const n0 = calls.length;
    await T.speakCached("Hecho, señor.", "sk-or-FAKE");
    check("ttsCache=false: ignora la caché existente y llama", calls.length === n0 + 1);
    writeCfg({});

    // --- Archivo corrupto ---
    const key = C.cacheKey("test/model-a", "voz1", "Hecho, señor.");
    const file = path.join(cdir, `${key}.wav`);
    fs.writeFileSync(file, Buffer.from("esto no es un wav"));
    check("WAV corrupto: getCached devuelve null y lo borra", C.getCached(key) === null && !fs.existsSync(file));
    fs.writeFileSync(file, Buffer.from("esto no es un wav"));
    const n1 = calls.length;
    o = await T.speakCached("Hecho, señor.", "sk-or-FAKE");
    check("corrupto: se regenera con una llamada y queda válido", o.cache === "miss" && calls.length === n1 + 1 && C.getCached(key) !== null);
    // cabecera válida pero tamaño truncado
    const good = fs.readFileSync(file);
    fs.writeFileSync(file, good.subarray(0, good.length - 10));
    check("WAV truncado se descarta", C.getCached(key) === null);

    // --- Seguridad de nombres / traversal ---
    check("putCached rechaza claves no hash (traversal)", !C.putCached("../../evil", good) && !C.putCached("a".repeat(63), good) && C.getCached("../settings") === null);
    check("putCached rechaza datos que no son WAV", !C.putCached("0".repeat(64), Buffer.from("xxxx")));
    check("settings.json intacto", fs.existsSync(settingsFile));

    // --- Expulsión por tamaño (LRU) ---
    C.clearCache();
    const mk = (n) => T.pcm16ToWav(new Uint8Array(n));
    const wav = mk(10_000); // ~10 KB
    const keys = [0, 1, 2, 3, 4].map((i) => C.cacheKey("m", "v", `f${i}`));
    const lim = wav.length * 3 + 100; // caben 3
    keys.forEach((kk, i) => {
      C.putCached(kk, wav, lim);
      const t = new Date(Date.now() - (10 - i) * 60_000); // más antigua = menor i
      fs.utimesSync(path.join(cdir, `${kk}.wav`), t, t);
    });
    check("tope de tamaño: quedan 3 de 5", names().length === 3, names().length);
    // refrescar f2 (hit) y añadir otra: f2 sobrevive, se va el menos reciente
    const old = path.join(cdir, `${keys[2]}.wav`);
    fs.utimesSync(old, new Date(Date.now() - 600_000), new Date(Date.now() - 600_000));
    check("hit marca como reciente", C.getCached(keys[2]) !== null && fs.statSync(old).mtimeMs > Date.now() - 60_000);
    C.putCached(C.cacheKey("m", "v", "nuevo"), wav, lim);
    check("expulsa el menos usado y conserva el recién usado", fs.existsSync(old) && names().length === 3 && !fs.existsSync(path.join(cdir, `${keys[3]}.wav`)));
    check("un archivo mayor que el tope no se guarda", !C.putCached(C.cacheKey("m", "v", "gigante"), mk(lim * 2), lim));
    const st = C.cacheStats();
    check("cacheStats cuenta archivos y bytes", st.files === 3 && st.bytes === wav.length * 3, JSON.stringify(st));
    check("clearCache borra todo y solo hashes", C.clearCache() === 3 && names().length === 0);
    fs.mkdirSync(cdir, { recursive: true });
    fs.writeFileSync(path.join(cdir, "ajeno.txt"), "no tocar");
    C.clearCache();
    check("clearCache no toca archivos ajenos", fs.existsSync(path.join(cdir, "ajeno.txt")));

    // --- Formatos y errores del proveedor ---
    mode = "mp3";
    o = await T.synthOpenRouter("x", "k");
    check("respuesta mp3: se respeta el content-type, no se envuelve", o.ok && o.contentType === "audio/mpeg");
    o = await T.speakCached("frase mp3 unica", "k");
    check("audio no-WAV no se cachea", !names().some((n) => n.endsWith(".wav")), names().join());
    mode = "badvoice";
    o = await T.synthOpenRouter("x", "k");
    check("voz inexistente: error claro con modelo y voz", !o.ok && o.status === 400 && /voz «voz1».*test\/model-a/.test(o.message ?? ""), o.message);
    mode = "json";
    o = await T.synthOpenRouter("x", "k");
    check("respuesta JSON con 200 no se trata como audio", !o.ok);
    mode = "empty";
    o = await T.synthOpenRouter("x", "k");
    check("audio vacío => error", !o.ok && o.status === 502);
    mode = "pcm";

    // --- Override de endpoint: seguridad ---
    const env = process.env;
    const saved = { ...env };
    env.OPENROUTER_TTS_URL_OVERRIDE = "http://evil.example.com/steal";
    check("override a host remoto se ignora", T.ttsEndpoint() === "https://openrouter.ai/api/v1/audio/speech");
    env.OPENROUTER_TTS_URL_OVERRIDE = "https://127.0.0.1:1/x";
    check("override https/no-http se ignora", T.ttsEndpoint().startsWith("https://openrouter.ai"));
    env.OPENROUTER_TTS_URL_OVERRIDE = "http://127.0.0.1.evil.com/x";
    check("127.0.0.1.evil.com se ignora", T.ttsEndpoint().startsWith("https://openrouter.ai"));
    env.OPENROUTER_TTS_URL_OVERRIDE = saved.OPENROUTER_TTS_URL_OVERRIDE;
    env.NODE_ENV = "production";
    delete env.JARVIS_ALLOW_TTS_URL_OVERRIDE;
    check("en producción sin permiso explícito el override no vale", T.ttsEndpoint().startsWith("https://openrouter.ai"));
    env.JARVIS_ALLOW_TTS_URL_OVERRIDE = "1";
    check("en producción con permiso explícito y loopback sí vale", T.ttsEndpoint() === saved.OPENROUTER_TTS_URL_OVERRIDE);
    if (saved.NODE_ENV === undefined) delete env.NODE_ENV; else env.NODE_ENV = saved.NODE_ENV;
    delete env.JARVIS_ALLOW_TTS_URL_OVERRIDE;
    // El override no puede llegar por ajustes: settings.json con esa clave se descarta.
    const S = await import("../src/lib/settings.ts");
    check("sanitize descarta intentos de fijar el endpoint por ajustes", !("ttsUrl" in S.sanitize({ ttsUrl: "http://127.0.0.1:1", OPENROUTER_TTS_URL_OVERRIDE: "x" })));

    // --- warmTtsCache ---
    C.clearCache();
    const n3 = calls.length;
    const w1 = await T.warmTtsCache(["Hecho.", "Listo.", "Hecho.", "x".repeat(200)]);
    check("warmTtsCache: genera 2, repite 1 desde caché, rechaza el largo", w1.generated === 2 && w1.cached === 1 && w1.failed === 1 && calls.length === n3 + 2, JSON.stringify(w1));
    const w2 = await T.warmTtsCache(["Hecho.", "Listo."]);
    check("warmTtsCache otra vez: todo acierto, 0 llamadas", w2.cached === 2 && w2.generated === 0 && calls.length === n3 + 2);

    // El contador de gasto (usage.server.ts usa alias "@/") se comprueba en la parte B por HTTP.
  } else {
    // --- Parte B: /api/speak real contra el servidor falso ---
    const speak = (text) =>
      fetch(httpUrl + "/api/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    // /api/usage consulta a OpenRouter si hay key; para leer solo el contador local se quita la key un momento.
    const usage = async () => {
      const cfg = fs.readFileSync(settingsFile, "utf8");
      fs.writeFileSync(settingsFile, JSON.stringify({ ...JSON.parse(cfg), openrouterApiKey: "" }));
      try {
        return (await (await fetch(httpUrl + "/api/usage")).json()).session;
      } finally {
        fs.writeFileSync(settingsFile, cfg);
      }
    };
    const u0 = await usage();
    let r = await speak("Prueba de caché HTTP");
    const b1 = Buffer.from(await r.arrayBuffer());
    check("HTTP miss: 200, WAV, X-Jarvis-Cache: miss", r.status === 200 && r.headers.get("x-jarvis-cache") === "miss" && b1.subarray(0, 4).toString() === "RIFF", r.status);
    const c1 = calls.length;
    r = await speak("Prueba de caché HTTP");
    const b2 = Buffer.from(await r.arrayBuffer());
    check("HTTP hit: X-Jarvis-Cache: hit, mismo audio, el servidor falso no recibe nada", r.headers.get("x-jarvis-cache") === "hit" && b1.equals(b2) && calls.length === c1);
    const u1 = await usage();
    check("el contador cuenta 1 llamada de voz y 1 acierto", u1.byKind.voice.calls === u0.byKind.voice.calls + 1 && u1.voiceCacheHits === (u0.voiceCacheHits ?? 0) + 1, JSON.stringify(u1.byKind.voice));
    r = await speak("x ".repeat(100));
    await r.arrayBuffer();
    check("HTTP texto largo: X-Jarvis-Cache: off", r.headers.get("x-jarvis-cache") === "off");
    r = await fetch(httpUrl + "/api/speak/cache");
    const st = await r.json();
    check("GET /api/speak/cache da tamaño", r.status === 200 && st.files >= 1 && st.bytes > 0, JSON.stringify(st));
    r = await fetch(httpUrl + "/api/speak/cache", { method: "DELETE" });
    check("DELETE sin Content-Type JSON lo bloquea proxy.ts (415)", r.status === 415, r.status);
    r = await fetch(httpUrl + "/api/speak/cache", { method: "DELETE", headers: { "Content-Type": "application/json", Origin: "http://evil.example" } });
    check("DELETE con origen ajeno => 403", r.status === 403, r.status);
    r = await fetch(httpUrl + "/api/speak/cache", { method: "DELETE", headers: { "Content-Type": "application/json" } });
    const d = await r.json();
    check("DELETE vacía la caché", r.status === 200 && d.removed >= 1 && d.files === 0, JSON.stringify(d));
    mode = "badvoice";
    r = await speak("Voz mala unica");
    const e = await r.json();
    check("HTTP voz inexistente: 400 con mensaje claro", r.status === 400 && /voz/.test(e.error), JSON.stringify(e));
    mode = "pcm";
    r = await fetch(httpUrl + "/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ttsCache: "si", OPENROUTER_TTS_URL_OVERRIDE: "http://127.0.0.1:1" }) });
    check("PUT /api/settings ignora el override y valida ttsCache", r.status === 400, r.status);
  }
} finally {
  fake.close();
  if (!process.env.TTSCACHE_DATA_DIR) fs.rmSync(dataDir, { recursive: true, force: true });
}
process.exit(summary() ? 1 : 0);
