import { isRecord, str, type ActionDefinition } from "./types";
import { SERVER_ONLY } from "./pc-shared";

export interface ScreenAskAction {
  type: "screen_ask";
  question: string;
}

export const screenAskAction: ActionDefinition<ScreenAskAction> = {
  type: "screen_ask",
  description:
    'Mirar la pantalla de William y responder una pregunta sobre lo que se ve (captura la pantalla y la analiza un modelo de visión). Úsala ante frases como "qué dice este error", "qué hay en mi pantalla", "léeme esto", "resume lo que veo", "qué opinas de esta página", "qué significa esto que veo". "question" es lo que quiere saber, en una frase. En "reply" di solo que la dejas lista para confirmar (no inventes lo que hay en pantalla).',
  schema: `{ "type": "screen_ask", "question": "¿Qué significa el error que aparece en pantalla?" }`,
  risk: "confirm",
  label: (a) => ({
    title: "Mirar tu pantalla",
    detail: `Se enviará una captura de tu pantalla completa a un modelo de IA en internet. Pregunta: «${a.question}»`,
    confirmLabel: "Capturar y preguntar",
  }),
  parse(raw) {
    if (!isRecord(raw)) return null;
    const question = str(raw.question, 3, 300);
    return question ? { type: "screen_ask", question } : null;
  },
  execution: {
    kind: "server",
    async run(a) {
      if (typeof window !== "undefined") return SERVER_ONLY;
      const { askAboutScreen } = await import("./screen.server.ts");
      return askAboutScreen(a.question);
    },
  },
};
