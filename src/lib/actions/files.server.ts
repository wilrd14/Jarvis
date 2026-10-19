/**
 * Lógica de disco para file_search / file_open. Solo servidor: se carga con
 * `await import("./files.server")` dentro de `run`.
 *
 * Reglas duras:
 *  - Solo trabaja dentro de una lista cerrada de carpetas del usuario.
 *  - Solo mira NOMBRES de archivo; nunca lee su contenido.
 *  - No sigue symlinks/junctions al buscar y valida con realpath al abrir.
 *  - Nunca devuelve ni abre archivos sensibles ni ejecutables.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ServerActionResult } from "./types";

const MAX_DEPTH = 4;
const MAX_VISITED = 30000;
const MAX_RESULTS = 10;
const TIME_BUDGET_MS = 5000;

// Nombre estándar y variantes en español, también bajo OneDrive.
const FOLDER_NAMES = [
  ["Documents", "Documentos"],
  ["Downloads", "Descargas"],
  ["Desktop", "Escritorio"],
  ["Pictures", "Imágenes", "Imagenes"],
];

const SKIP_DIRS = new Set(["node_modules", ".git", "appdata", "$recycle.bin", "system volume information"]);

// Archivos que nunca se listan ni se abren.
const SENSITIVE_RE =
  /(api[ _-]?keys?|\.env|passw|contrase|secret|credential|token|id_rsa|id_ed25519|\.pem$|\.key$|\.pfx$|\.kdbx?$|wallet|seed ?phrase)/i;

// Solo se abren tipos de documento/medio que no ejecutan código al abrirse
// (se excluyen html, svg, macros de Office, chm, iso, scripts, ejecutables, etc.).
const ALLOWED_EXT = new Set([
  ".pdf", ".txt", ".md", ".csv", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp",
  ".mp3", ".wav", ".m4a", ".mp4", ".mkv", ".mov", ".avi", ".docx", ".xlsx", ".pptx", ".zip",
]);

export interface FoundFile {
  name: string;
  path: string;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Carpetas permitidas ya resueltas con realpath (lista cerrada). */
export async function allowedRoots(): Promise<string[]> {
  const home = os.homedir();
  const bases = [home, path.join(home, "OneDrive")];
  const roots = new Set<string>();
  for (const base of bases) {
    for (const names of FOLDER_NAMES) {
      for (const n of names) {
        const candidate = path.join(base, n);
        if (!(await exists(candidate))) continue;
        try {
          const real = await fs.realpath(candidate);
          // El destino debe seguir bajo el home o su OneDrive: nada de enlaces a otros discos.
          if (isInside(real, home) || isInside(real, path.join(home, "OneDrive"))) roots.add(real);
        } catch {
          /* se ignora */
        }
      }
    }
  }
  return [...roots];
}

function isInside(target: string, root: string): boolean {
  const rel = path.relative(root, target);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function isSensitive(name: string): boolean {
  return SENSITIVE_RE.test(name);
}

export async function searchFiles(query: string): Promise<FoundFile[]> {
  const tokens = norm(query)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2)
    .slice(0, 6);
  if (!tokens.length) return [];

  const roots = await allowedRoots();
  const deadline = Date.now() + TIME_BUDGET_MS;
  let visited = 0;
  const hits: { name: string; path: string; mtime: number; starts: boolean }[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || visited >= MAX_VISITED || Date.now() > deadline) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const subdirs: string[] = [];
    for (const e of entries) {
      if (++visited > MAX_VISITED) return;
      if (e.isSymbolicLink()) continue; // no seguir enlaces ni junctions
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith(".") || SKIP_DIRS.has(e.name.toLowerCase())) continue;
        subdirs.push(full);
        continue;
      }
      if (!e.isFile()) continue;
      if (isSensitive(e.name) || !ALLOWED_EXT.has(path.extname(e.name).toLowerCase())) continue;
      const n = norm(e.name);
      if (!tokens.every((t) => n.includes(t))) continue;
      let mtime = 0;
      try {
        mtime = (await fs.stat(full)).mtimeMs;
      } catch {
        /* se ignora */
      }
      hits.push({ name: e.name, path: full, mtime, starts: n.startsWith(tokens[0]) });
    }
    for (const d of subdirs) await walk(d, depth + 1);
  }

  for (const root of roots) await walk(root, 0);

  hits.sort((a, b) => Number(b.starts) - Number(a.starts) || b.mtime - a.mtime);
  return hits.slice(0, MAX_RESULTS).map(({ name, path: p }) => ({ name, path: p }));
}

export async function openAllowedFile(rawPath: string): Promise<ServerActionResult> {
  const deny = (message: string): ServerActionResult => ({ ok: false, message });

  if (rawPath.includes("\0") || rawPath.split(/[\\/]+/).includes("..")) {
    return deny("Ruta no permitida.");
  }
  const resolved = path.resolve(rawPath);
  if (!path.isAbsolute(rawPath)) return deny("Ruta no permitida.");

  let real: string;
  try {
    real = await fs.realpath(resolved);
  } catch {
    return deny("No encontré ese archivo.");
  }

  const roots = await allowedRoots();
  // Tanto la ruta pedida como su destino real deben quedar dentro de la lista.
  const ok = roots.some((r) => isInside(real, r)) && roots.some((r) => isInside(resolved, r));
  if (!ok) return deny("Esa ruta está fuera de las carpetas permitidas.");

  const name = path.basename(real);
  if (isSensitive(name) || isSensitive(path.basename(resolved))) return deny("Ese archivo está protegido.");
  if (!ALLOWED_EXT.has(path.extname(real).toLowerCase())) return deny("No abro ese tipo de archivo.");

  let stat;
  try {
    stat = await fs.stat(real);
  } catch {
    return deny("No encontré ese archivo.");
  }
  if (!stat.isFile()) return deny("Eso no es un archivo.");

  // Sin shell: se pasa la ruta como argumento a un programa que abre con la app predeterminada.
  let cmd: string;
  let args: string[];
  if (process.platform === "win32") {
    cmd = "explorer.exe";
    args = [real];
  } else if (process.platform === "darwin") {
    cmd = "open";
    args = [real];
  } else {
    cmd = "xdg-open";
    args = [real];
  }
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: false });
    child.on("error", () => {});
    child.unref();
  } catch {
    return deny("No pude abrir el archivo.");
  }
  return { ok: true, message: `Abierto: ${name}` };
}
