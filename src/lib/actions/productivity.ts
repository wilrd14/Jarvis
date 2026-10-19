/**
 * Notas, recordatorios, temporizadores y alarmas. Se ejecutan en el servidor
 * (almacenamiento local en JSON). Este módulo también entra al bundle del
 * navegador, así que no puede importar `fs`: el store lo registra en
 * `globalThis` el módulo solo-servidor `@/lib/store/register` (importado por
 * /api/actions/execute) y aquí solo se importan sus tipos.
 */
import { isRecord, isoDate, str, type ActionDefinition, type ServerActionResult } from "./types";
import { TIMEZONE as TZ } from "../config";

type Store = typeof import("../store/notes") & typeof import("../store/reminders");
function store(): Store {
  const s = (globalThis as { __jarvisStore?: Store }).__jarvisStore;
  if (!s) throw new Error("El almacenamiento local solo está disponible en el servidor.");
  return s;
}


function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", { timeZone: TZ, dateStyle: "full", timeStyle: "short" });
}

function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} ${h === 1 ? "hora" : "horas"}`);
  if (m) parts.push(`${m} ${m === 1 ? "minuto" : "minutos"}`);
  if (s) parts.push(`${s} ${s === 1 ? "segundo" : "segundos"}`);
  return parts.join(" y ");
}

const MAX_PAST_SKEW_MS = 30_000;
const MAX_FUTURE_MS = 366 * 24 * 3600 * 1000;

/** Valida que la fecha esté en el futuro cercano (con tolerancia de reloj). */
function checkFuture(iso: string): string | null {
  const t = Date.parse(iso);
  if (t < Date.now() - MAX_PAST_SKEW_MS) return "Esa fecha y hora ya pasó.";
  if (t > Date.now() + MAX_FUTURE_MS) return "Esa fecha está demasiado lejos (máximo un año).";
  return null;
}

// ---------- Notas ----------

export interface NoteAddAction {
  type: "note_add";
  text: string;
  title?: string;
}

export const noteAddAction: ActionDefinition<NoteAddAction> = {
  type: "note_add",
  description: "Guardar una nota de texto (\"anota que...\", \"apunta...\"). Se guarda sin pedir confirmación.",
  schema: `{ "type": "note_add", "text": "comprar leche mañana", "title": "Compras (opcional)" }`,
  risk: "low",
  label: (a) => ({ title: "Nota", detail: a.title ? `${a.title}: ${a.text}` : a.text }),
  parse(raw) {
    if (!isRecord(raw)) return null;
    const text = str(raw.text, 1, 5000);
    if (!text) return null;
    const out: NoteAddAction = { type: "note_add", text };
    if (raw.title != null && raw.title !== "") {
      const title = str(raw.title, 1, 200);
      if (!title) return null;
      out.title = title;
    }
    return out;
  },
  execution: {
    kind: "server",
    async run(a): Promise<ServerActionResult> {
      const { addNote } = store();
      await addNote(a.text, a.title);
      return { ok: true, message: "Nota guardada." };
    },
  },
};

export interface NoteListAction {
  type: "note_list";
}

export const noteListAction: ActionDefinition<NoteListAction> = {
  type: "note_list",
  description: "Listar todas las notas guardadas (\"qué notas tengo\"). Se ejecuta sin confirmación y Jarvis dice el resultado.",
  schema: `{ "type": "note_list" }`,
  risk: "low",
  label: () => ({ title: "Notas", detail: "Listar mis notas" }),
  parse: (raw) => (isRecord(raw) ? { type: "note_list" } : null),
  execution: {
    kind: "server",
    async run(): Promise<ServerActionResult> {
      const { listNotes } = store();
      const notes = await listNotes();
      if (!notes.length) return { ok: true, message: "No tienes notas guardadas." };
      const shown = notes.slice(0, 10).map((n) => (n.title ? `${n.title}: ${n.text}` : n.text));
      const more = notes.length > shown.length ? ` Y ${notes.length - shown.length} más.` : "";
      return {
        ok: true,
        message: `Tienes ${notes.length} ${notes.length === 1 ? "nota" : "notas"}. ${shown.join(". ")}.${more}`,
      };
    },
  },
};

export interface NoteSearchAction {
  type: "note_search";
  query: string;
}

export const noteSearchAction: ActionDefinition<NoteSearchAction> = {
  type: "note_search",
  description: "Buscar notas por palabras (\"qué anoté sobre la leche\"). Sin confirmación; Jarvis dice el resultado.",
  schema: `{ "type": "note_search", "query": "leche" }`,
  risk: "low",
  label: (a) => ({ title: "Buscar notas", detail: a.query }),
  parse(raw) {
    if (!isRecord(raw)) return null;
    const query = str(raw.query, 1, 200);
    return query ? { type: "note_search", query } : null;
  },
  execution: {
    kind: "server",
    async run(a): Promise<ServerActionResult> {
      const { listNotes } = store();
      const notes = await listNotes(a.query);
      if (!notes.length) return { ok: true, message: `No encontré notas sobre ${a.query}.` };
      const shown = notes.slice(0, 10).map((n) => (n.title ? `${n.title}: ${n.text}` : n.text));
      return {
        ok: true,
        message: `Encontré ${notes.length} ${notes.length === 1 ? "nota" : "notas"}. ${shown.join(". ")}.`,
      };
    },
  },
};

export interface NoteDeleteAction {
  type: "note_delete";
  /** Id exacto de la nota (si se conoce). */
  id?: string;
  /** Palabras que identifican la nota; debe coincidir con una sola. */
  query?: string;
}

export const noteDeleteAction: ActionDefinition<NoteDeleteAction> = {
  type: "note_delete",
  description: "Borrar una nota, por id o por palabras que la identifiquen. Pide confirmación al usuario.",
  schema: `{ "type": "note_delete", "query": "leche" }`,
  risk: "confirm",
  label: (a) => ({ title: "Borrar nota", detail: a.id ? `Nota ${a.id}` : `Nota que contiene: ${a.query}` }),
  parse(raw) {
    if (!isRecord(raw)) return null;
    const out: NoteDeleteAction = { type: "note_delete" };
    if (raw.id != null && raw.id !== "") {
      const id = str(raw.id, 1, 64);
      if (!id || !/^[\w-]+$/.test(id)) return null;
      out.id = id;
    }
    if (raw.query != null && raw.query !== "") {
      const query = str(raw.query, 1, 200);
      if (!query) return null;
      out.query = query;
    }
    return out.id || out.query ? out : null;
  },
  execution: {
    kind: "server",
    async run(a): Promise<ServerActionResult> {
      const { deleteNote } = store();
      const res = await deleteNote({ id: a.id, query: a.query });
      return res.ok ? { ok: true, message: `Nota borrada: ${res.note.text}.` } : { ok: false, message: res.reason };
    },
  },
};

// ---------- Recordatorios ----------

export interface ReminderAddAction {
  type: "reminder_add";
  text: string;
  /** ISO 8601 con zona, p. ej. 2026-08-15T10:00:00-03:00 */
  at: string;
}

export const reminderAddAction: ActionDefinition<ReminderAddAction> = {
  type: "reminder_add",
  description:
    "Programar un recordatorio para una fecha y hora concretas (\"recuérdame en 20 minutos...\", \"recuérdame mañana a las 9...\"). Calcula la fecha/hora ISO con la fecha actual. Sin confirmación. \"text\" es lo que hay que recordar.",
  schema: `{ "type": "reminder_add", "text": "sacar la ropa", "at": "2026-08-15T10:00:00-03:00" }`,
  risk: "low",
  label: (a) => ({ title: "Recordatorio", detail: `${a.text} — ${fmtWhen(a.at)}` }),
  parse(raw) {
    if (!isRecord(raw)) return null;
    const text = str(raw.text, 1, 500);
    const at = isoDate(raw.at);
    return text && at ? { type: "reminder_add", text, at: at.value } : null;
  },
  execution: {
    kind: "server",
    async run(a): Promise<ServerActionResult> {
      const bad = checkFuture(a.at);
      if (bad) return { ok: false, message: bad };
      const { addReminder } = store();
      await addReminder("reminder", a.text, Date.parse(a.at));
      return { ok: true, message: `Listo, te lo recordaré el ${fmtWhen(a.at)}.` };
    },
  },
};

export interface ReminderListAction {
  type: "reminder_list";
}

export const reminderListAction: ActionDefinition<ReminderListAction> = {
  type: "reminder_list",
  description: "Listar recordatorios, temporizadores y alarmas pendientes. Sin confirmación; Jarvis dice el resultado.",
  schema: `{ "type": "reminder_list" }`,
  risk: "low",
  label: () => ({ title: "Recordatorios", detail: "Listar pendientes" }),
  parse: (raw) => (isRecord(raw) ? { type: "reminder_list" } : null),
  execution: {
    kind: "server",
    async run(): Promise<ServerActionResult> {
      const { listPending } = store();
      const items = await listPending();
      if (!items.length) return { ok: true, message: "No tienes nada pendiente." };
      const shown = items.slice(0, 10).map((r) => {
        const kind = r.kind === "timer" ? "Temporizador" : r.kind === "alarm" ? "Alarma" : "Recordatorio";
        return `${kind}: ${r.text}, ${fmtWhen(r.dueAt)}`;
      });
      return {
        ok: true,
        message: `Tienes ${items.length} ${items.length === 1 ? "pendiente" : "pendientes"}. ${shown.join(". ")}.`,
      };
    },
  },
};

export interface ReminderCancelAction {
  type: "reminder_cancel";
  /** Palabras del recordatorio/alarma a cancelar; sin ellas, el único pendiente. */
  query?: string;
}

export const reminderCancelAction: ActionDefinition<ReminderCancelAction> = {
  type: "reminder_cancel",
  description:
    "Cancelar un recordatorio o alarma pendiente, identificado por palabras de su texto. Sin \"query\" solo cancela si hay uno único.",
  schema: `{ "type": "reminder_cancel", "query": "ropa" }`,
  risk: "low",
  label: (a) => ({ title: "Cancelar recordatorio", detail: a.query ?? "El pendiente" }),
  parse(raw) {
    if (!isRecord(raw)) return null;
    const out: ReminderCancelAction = { type: "reminder_cancel" };
    if (raw.query != null && raw.query !== "") {
      const query = str(raw.query, 1, 200);
      if (!query) return null;
      out.query = query;
    }
    return out;
  },
  execution: {
    kind: "server",
    async run(a): Promise<ServerActionResult> {
      const { cancelReminders } = store();
      const done = await cancelReminders({ query: a.query, kinds: ["reminder", "alarm"] });
      if (!done.length) {
        return { ok: false, message: "No encontré un recordatorio pendiente que coincida." };
      }
      return { ok: true, message: `Cancelado: ${done.map((r) => r.text).join(", ")}.` };
    },
  },
};

// ---------- Temporizadores y alarmas ----------

export interface TimerStartAction {
  type: "timer_start";
  /** Duración en segundos (1 a 86400). */
  seconds: number;
  label?: string;
}

export const timerStartAction: ActionDefinition<TimerStartAction> = {
  type: "timer_start",
  description: "Iniciar un temporizador de cuenta atrás (\"temporizador de 10 minutos\"). Sin confirmación.",
  schema: `{ "type": "timer_start", "seconds": 600, "label": "pasta (opcional)" }`,
  risk: "low",
  label: (a) => ({ title: "Temporizador", detail: `${fmtDuration(a.seconds)}${a.label ? ` — ${a.label}` : ""}` }),
  parse(raw) {
    if (!isRecord(raw)) return null;
    const seconds = raw.seconds;
    if (typeof seconds !== "number" || !Number.isInteger(seconds) || seconds < 1 || seconds > 86400) return null;
    const out: TimerStartAction = { type: "timer_start", seconds };
    if (raw.label != null && raw.label !== "") {
      const label = str(raw.label, 1, 200);
      if (!label) return null;
      out.label = label;
    }
    return out;
  },
  execution: {
    kind: "server",
    async run(a): Promise<ServerActionResult> {
      const { addReminder } = store();
      await addReminder("timer", a.label ?? `Temporizador de ${fmtDuration(a.seconds)}`, Date.now() + a.seconds * 1000);
      return { ok: true, message: `Temporizador de ${fmtDuration(a.seconds)} en marcha.` };
    },
  },
};

export interface TimerCancelAction {
  type: "timer_cancel";
}

export const timerCancelAction: ActionDefinition<TimerCancelAction> = {
  type: "timer_cancel",
  description: "Cancelar los temporizadores en marcha.",
  schema: `{ "type": "timer_cancel" }`,
  risk: "low",
  label: () => ({ title: "Temporizador", detail: "Cancelar los temporizadores en marcha" }),
  parse: (raw) => (isRecord(raw) ? { type: "timer_cancel" } : null),
  execution: {
    kind: "server",
    async run(): Promise<ServerActionResult> {
      const { cancelReminders } = store();
      const done = await cancelReminders({ kinds: ["timer"], all: true });
      return done.length
        ? { ok: true, message: done.length === 1 ? "Temporizador cancelado." : `${done.length} temporizadores cancelados.` }
        : { ok: false, message: "No hay temporizadores en marcha." };
    },
  },
};

export interface AlarmSetAction {
  type: "alarm_set";
  /** ISO 8601 con zona de la próxima vez que debe sonar. */
  at: string;
  label?: string;
}

export const alarmSetAction: ActionDefinition<AlarmSetAction> = {
  type: "alarm_set",
  description:
    "Poner una alarma a una hora de hoy o mañana (\"despiértame a las 7\"). Calcula la próxima ocurrencia de esa hora en ISO con la fecha actual. Suena con sonido. Sin confirmación.",
  schema: `{ "type": "alarm_set", "at": "2026-08-16T07:00:00-03:00", "label": "Despertar (opcional)" }`,
  risk: "low",
  label: (a) => ({ title: "Alarma", detail: `${fmtWhen(a.at)}${a.label ? ` — ${a.label}` : ""}` }),
  parse(raw) {
    if (!isRecord(raw)) return null;
    const at = isoDate(raw.at);
    if (!at) return null;
    const out: AlarmSetAction = { type: "alarm_set", at: at.value };
    if (raw.label != null && raw.label !== "") {
      const label = str(raw.label, 1, 200);
      if (!label) return null;
      out.label = label;
    }
    return out;
  },
  execution: {
    kind: "server",
    async run(a): Promise<ServerActionResult> {
      const bad = checkFuture(a.at);
      if (bad) return { ok: false, message: bad };
      const { addReminder } = store();
      await addReminder("alarm", a.label ?? "Alarma", Date.parse(a.at));
      return { ok: true, message: `Alarma puesta para el ${fmtWhen(a.at)}.` };
    },
  },
};

export const productivityActions = [
  noteAddAction,
  noteListAction,
  noteSearchAction,
  noteDeleteAction,
  reminderAddAction,
  reminderListAction,
  reminderCancelAction,
  timerStartAction,
  timerCancelAction,
  alarmSetAction,
] as const;
