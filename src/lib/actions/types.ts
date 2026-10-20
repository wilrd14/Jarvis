/**
 * Tipos base de la capa de acciones. Una acción es una propuesta del cerebro
 * (el modelo) que el usuario confirma antes de ejecutarse.
 */

export type ActionRisk = "low" | "confirm";

export interface ServerActionResult {
  ok: boolean;
  message?: string;
  /** Texto que vuelve al cerebro como siguiente turno (ya acotado y etiquetado). */
  followUp?: string;
  /** Código HTTP si falla (/api/actions/execute lo usa en lugar de 500). */
  status?: number;
}

/** Resultado opcional de una acción de cliente. */
export interface ClientActionOutcome {
  followUp?: string;
}

/** Ejecución en el navegador (mailto:, window.open, ...). */
export interface ClientExecution<T> {
  kind: "client";
  run: (action: T) => void | ClientActionOutcome | Promise<void | ClientActionOutcome>;
}

/**
 * Ejecución en servidor vía POST /api/actions/execute. Debe ser una operación
 * acotada y tipada: nunca ejecutar comandos o rutas arbitrarias recibidas del
 * modelo. Pensado para que Electron/Node ejecute acciones de sistema después.
 */
export interface ServerExecution<T> {
  kind: "server";
  /** `ctx.token` es la firma de la propuesta (si la hubo). */
  run: (action: T, ctx?: { token?: string }) => Promise<ServerActionResult>;
  /** Tiempo máximo que espera el navegador (por defecto sin límite propio). Solo para acciones lentas. */
  timeoutMs?: number;
}

export interface ActionDefinition<T extends { type: string }> {
  /** Identificador único; es el discriminante de la unión. */
  type: T["type"];
  /** Para qué sirve (se inyecta en el prompt del cerebro). */
  description: string;
  /** Ejemplo JSON del objeto `action` (se inyecta en el prompt). */
  schema: string;
  /** "confirm": el usuario debe confirmar con un clic. "low": inocua. */
  risk: ActionRisk;
  /** Título y detalle para la tarjeta de confirmación. */
  label: (action: T) => { title: string; detail: string; confirmLabel?: string; busyText?: string };
  /** Valida estrictamente lo que devolvió el modelo; null si es inválido. */
  parse: (raw: unknown) => T | null;
  execution: ClientExecution<T> | ServerExecution<T>;
}

// ---------- Helpers de validación ----------

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** String recortado dentro de [min, max]; undefined si no cumple. */
export function str(v: unknown, min: number, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s.length >= min && s.length <= max ? s : undefined;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/** Fecha ISO 8601 con zona horaria; devuelve el string y su timestamp. */
export function isoDate(v: unknown): { value: string; time: number } | undefined {
  if (typeof v !== "string" || !ISO_RE.test(v)) return undefined;
  const time = Date.parse(v);
  return Number.isNaN(time) ? undefined : { value: v, time };
}
