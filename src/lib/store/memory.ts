import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { dataDir } from "../settings";
import { updateCollection } from "./jsonStore";
import { isRecord, str } from "../actions/types";

export interface Memory {
  id: string;
  text: string;
  createdAt: string;
  tag?: string;
}

const FILE = "memorias.json";
export const MAX_MEMORIES = 200;
export const MAX_MEMORY_CHARS = 300;

function sanitize(raw: unknown): Memory | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id, 1, 64);
  const text = str(raw.text, 1, MAX_MEMORY_CHARS);
  const createdAt = str(raw.createdAt, 1, 40);
  if (!id || !text || !createdAt) return null;
  const m: Memory = { id, text, createdAt };
  const tag = str(raw.tag, 1, 40);
  if (tag) m.tag = tag;
  return m;
}

/**
 * Lectura síncrona y validada (para el prompt, que se construye de forma
 * síncrona). El archivo se reemplaza con rename atómico, así que siempre es
 * consistente; si falta o está corrupto devuelve []. Más recientes primero.
 */
export function readMemoriesSync(): Memory[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path.join(dataDir(), FILE), "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitize).filter((m): m is Memory => m !== null).reverse();
  } catch {
    return [];
  }
}

export const normText = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

function matches(m: Memory, query: string) {
  const hay = normText(`${m.tag ?? ""} ${m.text}`);
  return normText(query)
    .split(" ")
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

export type AddMemoryResult =
  | { ok: true; memory: Memory; duplicate: boolean }
  | { ok: false; reason: string };

export function addMemory(text: string, tag?: string): Promise<AddMemoryResult> {
  const clean = text.trim();
  return updateCollection(FILE, sanitize, (items): AddMemoryResult => {
    if (!clean || clean.length > MAX_MEMORY_CHARS) {
      return { ok: false, reason: `El recuerdo debe tener entre 1 y ${MAX_MEMORY_CHARS} caracteres.` };
    }
    const dup = items.find((m) => normText(m.text) === normText(clean));
    if (dup) return { ok: true, memory: dup, duplicate: true };
    if (items.length >= MAX_MEMORIES) {
      return { ok: false, reason: `Ya tengo ${MAX_MEMORIES} recuerdos guardados; olvida alguno primero.` };
    }
    const memory: Memory = { id: randomUUID().slice(0, 8), text: clean, createdAt: new Date().toISOString() };
    const t = tag?.trim();
    if (t) memory.tag = t.slice(0, 40);
    items.push(memory);
    return { ok: true, memory, duplicate: false };
  });
}

/** Más recientes primero. */
export function listMemories(query?: string): Promise<Memory[]> {
  return updateCollection(FILE, sanitize, (items) =>
    (query ? items.filter((m) => matches(m, query)) : [...items]).reverse()
  );
}

/** Borra por id exacto o por consulta que coincida con un solo recuerdo. */
export function deleteMemory(by: {
  id?: string;
  query?: string;
}): Promise<{ ok: true; memory: Memory } | { ok: false; reason: string }> {
  return updateCollection(FILE, sanitize, (items) => {
    let idx = -1;
    if (by.id) idx = items.findIndex((m) => m.id === by.id);
    else if (by.query) {
      const q = by.query;
      const found = items.map((m, i) => (matches(m, q) ? i : -1)).filter((i) => i >= 0);
      if (found.length > 1) {
        return { ok: false as const, reason: "Hay varios recuerdos que coinciden; sé más específico." };
      }
      idx = found[0] ?? -1;
    }
    if (idx < 0) return { ok: false as const, reason: "No encontré ese recuerdo." };
    const [memory] = items.splice(idx, 1);
    return { ok: true as const, memory };
  });
}
