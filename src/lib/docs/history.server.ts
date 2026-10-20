/**
 * Índice de documentos creados por Jarvis (docs-index.json en JARVIS_DATA_DIR). Solo servidor.
 * Es la única fuente de rutas para document_open / "Mostrar en carpeta": nunca se aceptan rutas libres.
 * Tope de 200 entradas (las más antiguas se descartan); escritura atómica con el store de jsonStore.
 */
import path from "node:path";
import crypto from "node:crypto";
import { updateCollection } from "../store/jsonStore";
import { isDocFormat, type DocFormat } from "./index";

export const INDEX_FILE = "docs-index.json";
export const MAX_INDEX = 200;

export interface DocRecord {
  id: string;
  title: string;
  format: DocFormat;
  path: string;
  /** ISO 8601 */
  date: string;
}

function sanitizeRecord(raw: unknown): DocRecord | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !/^[a-f0-9]{8,32}$/.test(r.id)) return null;
  if (typeof r.title !== "string" || r.title.length > 200) return null;
  if (!isDocFormat(r.format)) return null;
  if (typeof r.path !== "string" || r.path.length > 1000 || !path.isAbsolute(r.path)) return null;
  if (typeof r.date !== "string" || Number.isNaN(Date.parse(r.date))) return null;
  return { id: r.id, title: r.title, format: r.format, path: r.path, date: r.date };
}

export function addDocumentRecord(rec: { title: string; format: DocFormat; path: string }): Promise<DocRecord> {
  const full: DocRecord = {
    id: crypto.randomBytes(6).toString("hex"),
    title: rec.title.slice(0, 200),
    format: rec.format,
    path: rec.path,
    date: new Date().toISOString(),
  };
  return updateCollection<DocRecord, DocRecord>(INDEX_FILE, sanitizeRecord, (items) => {
    items.push(full);
    if (items.length > MAX_INDEX) items.splice(0, items.length - MAX_INDEX);
    return full;
  });
}

/** Más recientes primero. */
export function listDocumentRecords(limit = 10): Promise<DocRecord[]> {
  return updateCollection<DocRecord, DocRecord[]>(INDEX_FILE, sanitizeRecord, (items) =>
    items.slice(-Math.max(1, Math.min(limit, MAX_INDEX))).reverse()
  );
}

/** Por id, o el último si `id` es undefined. */
export async function findDocumentRecord(id?: string): Promise<DocRecord | null> {
  const all = await listDocumentRecords(MAX_INDEX);
  if (id === undefined) return all[0] ?? null;
  return all.find((d) => d.id === id) ?? null;
}
