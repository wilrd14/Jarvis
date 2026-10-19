import { isRecord, type ActionDefinition } from "./types";
import { SERVER_ONLY } from "./pc-shared";

export interface ScreenshotAction {
  type: "screenshot";
}

export const screenshotAction: ActionDefinition<ScreenshotAction> = {
  type: "screenshot",
  description:
    "Tomar una captura de pantalla completa; se guarda en Imágenes\\Jarvis con la fecha en el nombre.",
  schema: `{ "type": "screenshot" }`,
  risk: "confirm",
  label: () => ({ title: "Captura de pantalla", detail: "Guardar en Imágenes\\Jarvis" }),
  parse(raw) {
    return isRecord(raw) ? { type: "screenshot" } : null;
  },
  execution: {
    kind: "server",
    async run() {
      if (typeof window === "undefined") {
        const { takeScreenshot } = await import("./pc-control.server");
        return takeScreenshot();
      }
      return SERVER_ONLY;
    },
  },
};
