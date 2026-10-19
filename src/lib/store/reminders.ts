import { randomUUID } from "crypto";
import { updateCollection } from "./jsonStore";
import { isRecord, str } from "../actions/types";

export type ReminderKind = "reminder" | "timer" | "alarm";

export interface Reminder {
  id: string;
  kind: ReminderKind;
  text: string;
  /** Instante de disparo (ISO UTC). */
  dueAt: string;
  createdAt: string;
  /** Se rellena al entregarse a un cliente; evita repetir. */
  firedAt?: string;
  canceledAt?: string;
}

const FILE = "recordatorios.json";
const KINDS: readonly string[] = ["reminder", "timer", "alarm"];
const KEEP_MS = 7 * 24 * 3600 * 1000;

function sanitize(raw: unknown): Reminder | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id, 1, 64);
  const text = str(raw.text, 1, 500);
  const dueAt = str(raw.dueAt, 1, 40);
  const createdAt = str(raw.createdAt, 1, 40);
  if (!id || !text || !dueAt || !createdAt || Number.isNaN(Date.parse(dueAt))) return null;
  if (typeof raw.kind !== "string" || !KINDS.includes(raw.kind)) return null;
  const r: Reminder = { id, kind: raw.kind as ReminderKind, text, dueAt, createdAt };
  const firedAt = str(raw.firedAt, 1, 40);
  const canceledAt = str(raw.canceledAt, 1, 40);
  if (firedAt) r.firedAt = firedAt;
  if (canceledAt) r.canceledAt = canceledAt;
  return r;
}

const pending = (r: Reminder) => !r.firedAt && !r.canceledAt;
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function addReminder(kind: ReminderKind, text: string, dueAtMs: number): Promise<Reminder> {
  const now = Date.now();
  const r: Reminder = {
    id: randomUUID().slice(0, 8),
    kind,
    text,
    dueAt: new Date(dueAtMs).toISOString(),
    createdAt: new Date(now).toISOString(),
  };
  return updateCollection(FILE, sanitize, (items) => {
    // Poda lo viejo ya resuelto para que el archivo no crezca sin límite.
    for (let i = items.length - 1; i >= 0; i--) {
      if (!pending(items[i]) && Date.parse(items[i].dueAt) < now - KEEP_MS) items.splice(i, 1);
    }
    items.push(r);
    return r;
  });
}

export function listPending(kinds?: ReminderKind[]): Promise<Reminder[]> {
  return updateCollection(FILE, sanitize, (items) =>
    items
      .filter((r) => pending(r) && (!kinds || kinds.includes(r.kind)))
      .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))
  );
}

/** Entrega los vencidos una sola vez: los marca como disparados al devolverlos. */
export function takeDue(nowMs = Date.now()): Promise<Reminder[]> {
  return updateCollection(FILE, sanitize, (items) => {
    const due = items.filter((r) => pending(r) && Date.parse(r.dueAt) <= nowMs);
    const stamp = new Date(nowMs).toISOString();
    for (const r of due) r.firedAt = stamp;
    return due.map((r) => ({ ...r }));
  });
}

/**
 * Cancela por id, por texto, o todos los de los tipos dados (`all`).
 * Sin criterio ni `all`, solo cancela si hay exactamente uno pendiente.
 */
export function cancelReminders(opts: {
  id?: string;
  query?: string;
  kinds?: ReminderKind[];
  all?: boolean;
}): Promise<Reminder[]> {
  return updateCollection(FILE, sanitize, (items) => {
    let cand = items.filter((r) => pending(r) && (!opts.kinds || opts.kinds.includes(r.kind)));
    if (opts.id) cand = cand.filter((r) => r.id === opts.id);
    else if (opts.query) {
      const words = norm(opts.query).split(/\s+/).filter(Boolean);
      cand = cand.filter((r) => words.every((w) => norm(r.text).includes(w)));
    } else if (!opts.all && cand.length !== 1) cand = [];
    const stamp = new Date().toISOString();
    for (const r of cand) r.canceledAt = stamp;
    return cand.map((r) => ({ ...r }));
  });
}
