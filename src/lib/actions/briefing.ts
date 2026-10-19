import { isRecord, type ActionDefinition } from "./types";
import { SERVER_ONLY } from "./pc-shared";

export interface DailyBriefingAction {
  type: "daily_briefing";
  /** Incluir el clima de hoy (por defecto sí). */
  includeWeather?: boolean;
}

export const dailyBriefingAction: ActionDefinition<DailyBriefingAction> = {
  type: "daily_briefing",
  description:
    'Resumen del día: fecha y hora, recordatorios y temporizadores de hoy, últimas notas y clima. Úsala ante "buenos días", "buenas tardes", "resumen del día", "qué tengo hoy", "ponme al día". Sin confirmación; después redactas tú un saludo natural de 3 a 4 frases con los datos que te lleguen. En "reply" pon solo una frase breve como "Un segundo, te pongo al día".',
  schema: `{ "type": "daily_briefing" }  (opcional "includeWeather": false para omitir el clima)`,
  risk: "low",
  label: () => ({ title: "Resumen del día", detail: "Preparar tu resumen de hoy" }),
  parse(raw) {
    if (!isRecord(raw)) return null;
    const out: DailyBriefingAction = { type: "daily_briefing" };
    if (raw.includeWeather != null) {
      if (typeof raw.includeWeather !== "boolean") return null;
      out.includeWeather = raw.includeWeather;
    }
    return out;
  },
  execution: {
    kind: "server",
    async run(a) {
      if (typeof window !== "undefined") return SERVER_ONLY;
      const { buildBriefing } = await import("../briefing.server");
      const { followUp } = await buildBriefing({ includeWeather: a.includeWeather !== false });
      return { ok: true, followUp };
    },
  },
};
