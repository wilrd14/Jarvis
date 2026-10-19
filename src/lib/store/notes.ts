import { randomUUID } from "crypto";
import { updateCollection } from "./jsonStore";
import { isRecord, str } from "../actions/types";

export interface Note {
  id: string;
  title?: string;
  text: string;
  createdAt: string;
}

const FILE = "notas.json";

function sanitize(raw: unknown): Note | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id, 1, 64);
  const text = str(raw.text, 1, 5000);
  const createdAt = str(raw.createdAt, 1, 40);
  if (!id || !text || !createdAt) return null;
  const note: Note = { id, text, createdAt };
  const title = str(raw.title, 1, 200);
  if (title) note.title = title;
  return note;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function matches(n: Note, query: string) {
  const hay = norm(`${n.title ?? ""} ${n.text}`);
  return norm(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

export function addNote(text: string, title?: string): Promise<Note> {
  const note: Note = { id: randomUUID().slice(0, 8), text, createdAt: new Date().toISOString() };
  if (title) note.title = title;
  return updateCollection(FILE, sanitize, (items) => {
    items.push(note);
    return note;
  });
}

/** Más recientes primero. */
export function listNotes(query?: string): Promise<Note[]> {
  return updateCollection(FILE, sanitize, (items) =>
    (query ? items.filter((n) => matches(n, query)) : [...items]).reverse()
  );
}

/** Borra por id exacto o, si no, por consulta que coincida con una sola nota. */
export function deleteNote(by: {
  id?: string;
  query?: string;
}): Promise<{ ok: true; note: Note } | { ok: false; reason: string }> {
  return updateCollection(FILE, sanitize, (items) => {
    let idx = -1;
    if (by.id) idx = items.findIndex((n) => n.id === by.id);
    else if (by.query) {
      const q = by.query;
      const found = items.map((n, i) => (matches(n, q) ? i : -1)).filter((i) => i >= 0);
      if (found.length > 1) {
        return { ok: false as const, reason: "Hay varias notas que coinciden; sé más específico." };
      }
      idx = found[0] ?? -1;
    }
    if (idx < 0) return { ok: false as const, reason: "No encontré esa nota." };
    const [note] = items.splice(idx, 1);
    return { ok: true as const, note };
  });
}
