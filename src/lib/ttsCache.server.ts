// Caché de audio de voz en disco: <JARVIS_DATA_DIR>/tts-cache/<sha256>.wav
// - Clave = sha256(modelo + voz + texto normalizado). El nombre del archivo es SOLO el hash:
//   el texto del usuario nunca aparece en el disco con nombre legible (privacidad).
// - Solo textos cortos (frases tipo "Hecho, señor"); las respuestas largas no se repiten.
// - Tope de tamaño total con expulsión de los menos usados recientemente (LRU por mtime;
//   cada acierto "toca" el archivo).
// - Escritura atómica (tmp + rename) y tolerancia a archivos corruptos (se borran y regeneran).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./settings.ts";

export const CACHE_MAX_CHARS = 120;
export const CACHE_MAX_BYTES = 50 * 1024 * 1024;

const NAME_RE = /^[0-9a-f]{64}\.wav$/;

export function cacheDir(): string {
  return path.join(dataDir(), "tts-cache");
}

/** Texto canónico: Unicode NFC, espacios colapsados y recortados. Mayúsculas se respetan (cambian la locución). */
export function normalizeText(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

export function cacheKey(model: string, voice: string, text: string): string {
  // Separador NUL: evita colisiones entre ("a","bc") y ("ab","c").
  return crypto
    .createHash("sha256")
    .update(`${model}\0${voice}\0${normalizeText(text)}`)
    .digest("hex");
}

export function isCacheable(text: string): boolean {
  const n = normalizeText(text);
  return n.length > 0 && n.length <= CACHE_MAX_CHARS;
}

function fileFor(key: string): string | null {
  const name = `${key}.wav`;
  // Defensa en profundidad: solo hashes hex; así no hay traversal posible.
  return NAME_RE.test(name) ? path.join(cacheDir(), name) : null;
}

/** WAV PCM mínimo válido: RIFF/WAVE, "fmt " y "data" cuyo tamaño declarado cuadra con el archivo. */
export function isValidWav(buf: Uint8Array): boolean {
  if (buf.length <= 44) return false;
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o: number) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE" || tag(12) !== "fmt " || tag(36) !== "data") return false;
  if (v.getUint32(40, true) !== buf.length - 44) return false;
  if (v.getUint32(4, true) !== buf.length - 8) return false;
  return v.getUint16(20, true) === 1 && v.getUint32(24, true) > 0;
}

/** Devuelve el WAV guardado o null (si no existe o está corrupto, que además se elimina). */
export function getCached(key: string): Uint8Array | null {
  const file = fileFor(key);
  if (!file) return null;
  try {
    const buf = new Uint8Array(fs.readFileSync(file));
    if (!isValidWav(buf)) {
      fs.rmSync(file, { force: true });
      return null;
    }
    const now = new Date();
    try {
      fs.utimesSync(file, now, now); // marca de uso reciente para la expulsión LRU
    } catch {}
    return buf;
  } catch {
    return null;
  }
}

/** Guarda un WAV (atómico) y aplica el tope de tamaño. Nunca lanza: la caché es opcional. */
export function putCached(key: string, wav: Uint8Array, maxBytes = CACHE_MAX_BYTES): boolean {
  const file = fileFor(key);
  if (!file || !isValidWav(wav) || wav.length > maxBytes) return false;
  try {
    fs.mkdirSync(cacheDir(), { recursive: true });
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    fs.writeFileSync(tmp, wav);
    fs.renameSync(tmp, file);
    evict(maxBytes);
    return true;
  } catch {
    return false;
  }
}

interface Entry {
  file: string;
  size: number;
  mtime: number;
}

function listEntries(): Entry[] {
  const dir = cacheDir();
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: Entry[] = [];
  for (const name of names) {
    if (!NAME_RE.test(name)) {
      // Restos de escrituras interrumpidas (*.tmp) de más de una hora.
      if (name.endsWith(".tmp")) {
        try {
          const f = path.join(dir, name);
          if (Date.now() - fs.statSync(f).mtimeMs > 3_600_000) fs.rmSync(f, { force: true });
        } catch {}
      }
      continue;
    }
    try {
      const file = path.join(dir, name);
      const st = fs.statSync(file);
      out.push({ file, size: st.size, mtime: st.mtimeMs });
    } catch {}
  }
  return out;
}

/** Borra los menos usados hasta quedar por debajo del tope. */
export function evict(maxBytes = CACHE_MAX_BYTES) {
  const entries = listEntries();
  let total = entries.reduce((a, e) => a + e.size, 0);
  if (total <= maxBytes) return;
  entries.sort((a, b) => a.mtime - b.mtime);
  for (const e of entries) {
    if (total <= maxBytes) break;
    try {
      fs.rmSync(e.file, { force: true });
      total -= e.size;
    } catch {}
  }
}

export function cacheStats(): { files: number; bytes: number; maxBytes: number } {
  const entries = listEntries();
  return { files: entries.length, bytes: entries.reduce((a, e) => a + e.size, 0), maxBytes: CACHE_MAX_BYTES };
}

/** Vacía la caché (solo archivos con nombre de hash). Devuelve cuántos borró. */
export function clearCache(): number {
  let n = 0;
  for (const e of listEntries()) {
    try {
      fs.rmSync(e.file, { force: true });
      n++;
    } catch {}
  }
  return n;
}
