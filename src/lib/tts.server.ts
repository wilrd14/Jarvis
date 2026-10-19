// Síntesis de voz por OpenRouter (/audio/speech) con caché en disco. Lo comparten
// /api/speak y warmTtsCache. No depende de Next: se puede probar con Node directo.
import { getSetting } from "./settings.ts";
import { cacheKey, getCached, isCacheable, isValidWav, putCached } from "./ttsCache.server.ts";

const OPENROUTER_TTS_URL = "https://openrouter.ai/api/v1/audio/speech";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Endpoint de /audio/speech. SOLO para pruebas: OPENROUTER_TTS_URL_OVERRIDE (variable de entorno
 * del proceso) se respeta si NODE_ENV no es producción o si además se define
 * JARVIS_ALLOW_TTS_URL_OVERRIDE=1, y únicamente si apunta a http en loopback (127.0.0.1/localhost/::1),
 * de modo que la API key nunca pueda enviarse a un host remoto. No se lee de ajustes ni de
 * ninguna petición: solo el dueño del proceso puede fijarla.
 */
export function ttsEndpoint(): string {
  const o = process.env.OPENROUTER_TTS_URL_OVERRIDE;
  if (o && (process.env.NODE_ENV !== "production" || process.env.JARVIS_ALLOW_TTS_URL_OVERRIDE === "1")) {
    try {
      const u = new URL(o);
      if (u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname)) return o;
    } catch {}
  }
  return OPENROUTER_TTS_URL;
}

// OpenRouter devuelve PCM16 mono (24 kHz por defecto); lo envolvemos en WAV para el navegador.
export function pcm16ToWav(pcm: Uint8Array, sampleRate = 24000): Uint8Array {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + pcm.length, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, pcm.length, true);
  const out = new Uint8Array(44 + pcm.length);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}

export type SynthResult =
  | { ok: true; audio: Uint8Array; contentType: string }
  | { ok: false; status: number; detail: string; message?: string };

/** Mensaje claro cuando el proveedor rechaza la combinación modelo/voz. */
function voiceHint(status: number, detail: string, model: string, voice: string): string | undefined {
  if ([400, 404, 422].includes(status) && /voice/i.test(detail)) {
    return `La voz «${voice || "(vacía)"}» no existe para el modelo ${model}. Elige otra voz en Ajustes.`;
  }
  if (status === 404 || (status === 400 && /model/i.test(detail))) {
    return `El modelo de voz ${model} no está disponible. Elige otro en Ajustes.`;
  }
  return undefined;
}

/**
 * Pide el audio al proveedor y lo normaliza. Pedimos PCM; si el proveedor responde con otro
 * formato (wav/mp3) se respeta su content-type en vez de envolver bytes que no son PCM.
 */
export async function synthOpenRouter(text: string, apiKey: string): Promise<SynthResult> {
  const model = getSetting("ttsModel");
  const voice = getSetting("ttsVoice");
  const response = await fetch(ttsEndpoint(), {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(45_000),
    body: JSON.stringify({
      model,
      ...(voice ? { voice } : {}),
      input: text,
      response_format: "pcm",
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    return { ok: false, status: response.status || 502, detail, message: voiceHint(response.status, detail, model, voice) };
  }

  const type = (response.headers.get("content-type") ?? "").toLowerCase();
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length) return { ok: false, status: 502, detail: "", message: "OpenRouter no devolvió audio." };
  if (/json|text\//.test(type)) {
    return { ok: false, status: 502, detail: new TextDecoder().decode(bytes.slice(0, 500)), message: "El servicio de voz devolvió una respuesta que no es audio." };
  }
  if (/wav/.test(type) || (bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF")) {
    return { ok: true, audio: bytes, contentType: "audio/wav" };
  }
  if (/mpeg|mp3|ogg|opus|aac|flac/.test(type)) {
    return { ok: true, audio: bytes, contentType: type.split(";")[0] };
  }
  // "audio/pcm;rate=24000;channels=1" (o sin cabecera útil): PCM16 mono, 24 kHz por defecto.
  const rate = Number(type.match(/rate=(\d+)/)?.[1]) || 24000;
  const even = bytes.length % 2 ? bytes.slice(0, bytes.length - 1) : bytes;
  return { ok: true, audio: pcm16ToWav(even, rate), contentType: "audio/wav" };
}

export interface SpeakOutcome {
  result: SynthResult;
  /** hit = servido de disco; miss = llamó al proveedor; off = no cacheable o caché desactivada. */
  cache: "hit" | "miss" | "off";
}

/** Caché primero; si no está, proveedor y guardado. */
export async function speakCached(text: string, apiKey: string): Promise<SpeakOutcome> {
  const useCache = getSetting("ttsCache") && isCacheable(text);
  const key = useCache ? cacheKey(getSetting("ttsModel"), getSetting("ttsVoice"), text) : "";
  if (useCache) {
    const hit = getCached(key);
    if (hit) return { result: { ok: true, audio: hit, contentType: "audio/wav" }, cache: "hit" };
  }
  const result = await synthOpenRouter(text, apiKey);
  if (useCache && result.ok && result.contentType === "audio/wav" && isValidWav(result.audio)) {
    putCached(key, result.audio);
  }
  return { result, cache: useCache ? "miss" : "off" };
}

/**
 * Pregenera frases fijas (p. ej. las plantillas de órdenes locales) para que luego salgan gratis.
 * ATENCIÓN: cada frase que no esté ya en caché cuesta una llamada de pago al proveedor.
 * No se invoca desde ningún sitio automáticamente.
 */
export async function warmTtsCache(texts: string[]): Promise<{ cached: number; generated: number; failed: number }> {
  const apiKey = getSetting("openrouterApiKey");
  const out = { cached: 0, generated: 0, failed: 0 };
  if (!apiKey || !getSetting("ttsCache")) return { ...out, failed: texts.length };
  for (const t of texts) {
    if (!isCacheable(t)) {
      out.failed++;
      continue;
    }
    try {
      const { result, cache } = await speakCached(t, apiKey);
      if (!result.ok) out.failed++;
      else if (cache === "hit") out.cached++;
      else out.generated++;
    } catch {
      out.failed++;
    }
  }
  return out;
}
