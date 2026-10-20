/**
 * Salida segura de documentos. Solo servidor.
 *  - Carpeta fija: <Documentos>\Jarvis (Documentos real, respeta OneDrive).
 *  - Nombre derivado del título saneado; la extensión la fija el formato, nunca el usuario.
 *  - Nunca sobrescribe ("(2)", "(3)"...) y escribe de forma atómica (temporal + rename).
 *  - No abre el documento: solo `revealInFolder` muestra el archivo en el Explorador.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

export const MAX_OUTPUT_BYTES = 25 * 1024 * 1024;
const MAX_NAME_LEN = 80;
const RESERVED = /^(con|prn|aux|nul|clock\$|com[0-9¹²³]|lpt[0-9¹²³])$/i;

let cachedDir: string | null = null;

function powershellDocsPath(): Promise<string | null> {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve(null);
    const script = "[Environment]::GetFolderPath('MyDocuments')";
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    let out = "";
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(v);
    };
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, 8000);
    child.stdout.on("data", (d) => (out += d.toString("utf8")));
    child.on("error", () => finish(null));
    child.on("close", () => {
      const p = out.split(/\r?\n/)[0]?.trim();
      finish(p && path.isAbsolute(p) ? p : null);
    });
  });
}

/** Carpeta de salida (creada si no existe). */
export async function docsDir(): Promise<string> {
  const override = process.env.JARVIS_DOCS_DIR;
  if (override && (process.env.NODE_ENV !== "production" || process.env.JARVIS_ALLOW_DOCS_DIR === "1")) {
    if (!path.isAbsolute(override)) throw new Error("JARVIS_DOCS_DIR debe ser una ruta absoluta.");
    const dir = path.resolve(override);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }
  if (!cachedDir) {
    const docs = (await powershellDocsPath()) ?? path.join(os.homedir(), "Documents");
    cachedDir = path.join(docs, "Jarvis");
  }
  await fs.mkdir(cachedDir, { recursive: true });
  return cachedDir;
}

/** Nombre de archivo seguro (sin extensión) a partir de un título arbitrario. */
export function sanitizeFileName(title: unknown): string {
  let s = typeof title === "string" ? title.slice(0, 1000).normalize("NFC") : "";
  // Solo letras, números, espacio y guion; todo lo demás (separadores, puntos, emojis...) se vuelve espacio.
  s = s.replace(/[^\p{L}\p{M}\p{N} -]+/gu, " ").replace(/\s+/g, " ");
  s = s.replace(/^[\s-]+|[\s-]+$/g, "");
  if (s.length > MAX_NAME_LEN) s = s.slice(0, MAX_NAME_LEN).replace(/[\s-]+$/g, "");
  if (!s) return "Documento";
  if (RESERVED.test(s) || RESERVED.test(s.split(" ")[0])) s = `Documento ${s}`.slice(0, MAX_NAME_LEN);
  return s;
}

export interface SavedFile {
  path: string;
  bytes: number;
}

/** En Windows, antivirus/OneDrive/indexador pueden bloquear un instante el archivo recién creado. */
async function renameRetry(from: string, to: string): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (i >= 6 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw e;
      await new Promise((r) => setTimeout(r, 150 * (i + 1)));
    }
  }
}

/** Guarda el buffer con nombre único y escritura atómica. */
export async function saveDocument(base: unknown, ext: string, data: Buffer): Promise<SavedFile> {
  if (!/^\.[a-z0-9]{2,5}$/.test(ext)) throw new Error("Extensión no válida.");
  if (data.length === 0) throw new Error("El documento generado está vacío.");
  if (data.length > MAX_OUTPUT_BYTES) {
    throw new Error(`El documento ocupa ${(data.length / 1048576).toFixed(1)} MB y el máximo permitido es 25 MB.`);
  }
  const dir = await docsDir();
  const name = sanitizeFileName(base);
  const tmp = path.join(dir, `.jarvis-${crypto.randomBytes(8).toString("hex")}.tmp`);
  let reserved: string | null = null;
  try {
    await fs.writeFile(tmp, data, { flag: "wx" });
    for (let n = 1; n < 1000; n++) {
      const candidate = path.join(/*turbopackIgnore: true*/ dir, n === 1 ? `${name}${ext}` : `${name} (${n})${ext}`);
      try {
        // Reserva el nombre sin pisar nada ("wx" falla si ya existe, también sin distinguir mayúsculas).
        const fh = await fs.open(/*turbopackIgnore: true*/ candidate, "wx");
        await fh.close();
        reserved = candidate;
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      }
    }
    if (!reserved) throw new Error("Demasiados documentos con el mismo nombre en la carpeta Jarvis.");
    await renameRetry(tmp, reserved);
    return { path: reserved, bytes: data.length };
  } catch (e) {
    if (reserved) await fs.unlink(reserved).catch(() => {});
    await fs.unlink(tmp).catch(() => {});
    throw e;
  }
}

function isInside(target: string, root: string): boolean {
  const rel = path.relative(root, target);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Abre el Explorador seleccionando el archivo. Solo rutas dentro de la carpeta de salida. */
export async function revealInFolder(file: string): Promise<{ ok: boolean; message: string }> {
  try {
    if (typeof file !== "string" || !path.isAbsolute(file) || /["\0]/.test(file)) return { ok: false, message: "Ruta no permitida." };
    const dir = await fs.realpath(/*turbopackIgnore: true*/ await docsDir());
    const real = await fs.realpath(file).catch(() => null);
    if (!real || !isInside(real, dir)) return { ok: false, message: "Solo puedo mostrar documentos de la carpeta Jarvis." };
    const st = await fs.stat(real);
    if (!st.isFile()) return { ok: false, message: "Ese archivo no existe." };
    if (process.platform !== "win32") return { ok: false, message: "Mostrar en el Explorador solo funciona en Windows." };
    // explorer.exe es el único que interpreta "/select," y necesita la ruta entre comillas.
    const child = spawn("explorer.exe", [`/select,"${real}"`], {
      shell: false,
      detached: true,
      stdio: "ignore",
      windowsVerbatimArguments: true,
    });
    child.on("error", () => {});
    child.unref();
    return { ok: true, message: "Mostrando el documento en su carpeta." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "No pude mostrar el documento." };
  }
}
