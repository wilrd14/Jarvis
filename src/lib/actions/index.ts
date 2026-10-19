/**
 * Registro de acciones de Jarvis.
 *
 * Cómo registrar una acción nueva (3 pasos):
 *  1. Crea src/lib/actions/<nombre>.ts que exporte su interfaz (con `type`
 *     literal único) y un `ActionDefinition` (description, schema, risk, label,
 *     parse estricto y execution `client` o `server`).
 *  2. Impórtala aquí y añádela al array `ACTION_DEFINITIONS`; el tipo
 *     `AssistantAction` la incorpora solo.
 *  3. Listo: el prompt del cerebro, la validación, la tarjeta de confirmación
 *     y /api/actions/execute (lista cerrada) la reconocen automáticamente.
 *     Si es `server`, su `run` no debe ejecutar comandos arbitrarios.
 */
import { calendarAction } from "./calendar";
import { emailAction } from "./email";
import { lockScreenAction } from "./lock-screen";
import { openAppAction } from "./open-app";
import { openFolderAction } from "./open-folder";
import { openUrlAction } from "./open-url";
import { screenshotAction } from "./screenshot";
import { volumeAction } from "./volume";
import type { ActionDefinition } from "./types";

export type { ActionDefinition, ActionRisk, ServerActionResult } from "./types";
export type { EmailAction } from "./email";
export type { CalendarAction } from "./calendar";

const PC_CONTROL_ACTIONS = [openAppAction, openFolderAction, openUrlAction, volumeAction, lockScreenAction, screenshotAction] as const;
const ACTION_DEFINITIONS = [emailAction, calendarAction, ...PC_CONTROL_ACTIONS] as const;

/** Unión discriminada por `type`, derivada del registro. */
export type AssistantAction = NonNullable<
  ReturnType<(typeof ACTION_DEFINITIONS)[number]["parse"]>
>;

// Lista cerrada: solo estos tipos existen. Map evita claves como "__proto__".
const REGISTRY: ReadonlyMap<string, ActionDefinition<AssistantAction>> = new Map(
  ACTION_DEFINITIONS.map((d) => [d.type, d as unknown as ActionDefinition<AssistantAction>])
);

export function getActionDefinition(type: unknown) {
  return typeof type === "string" ? REGISTRY.get(type) : undefined;
}

/** Valida una acción cruda (del modelo o de un cliente); null si es inválida o desconocida. */
export function parseAction(raw: unknown): AssistantAction | null {
  if (typeof raw !== "object" || raw === null) return null;
  const def = getActionDefinition((raw as { type?: unknown }).type);
  return def ? def.parse(raw) : null;
}

export function describeAction(action: AssistantAction) {
  return REGISTRY.get(action.type)!.label(action);
}

/** Texto del prompt del cerebro con las acciones disponibles. */
export function buildActionsPrompt(): string {
  const items = [...REGISTRY.values()]
    .map((d) => `- ${d.description}\n  "action": ${d.schema}`)
    .join("\n");
  return `Acciones disponibles (en "action" usa exactamente uno de estos objetos, o null si no aplica):
${items}

Con una acción, el JSON completo es {"reply": "...", "action": <objeto>}. Si no tienes los datos suficientes (destinatario, asunto, fecha u hora...), pregunta por los datos faltantes en "reply" y deja "action" en null.`;
}

/** Ejecuta una acción ya confirmada: en el navegador o vía la ruta del servidor. */
export async function runAssistantAction(action: AssistantAction): Promise<void> {
  const def = REGISTRY.get(action.type);
  if (!def) throw new Error("Acción desconocida.");
  if (def.execution.kind === "client") {
    await def.execution.run(action);
    return;
  }
  const res = await fetch("/api/actions/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error ?? data?.message ?? "No se pudo ejecutar la acción.");
  }
}
