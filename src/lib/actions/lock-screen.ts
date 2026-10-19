import { isRecord, type ActionDefinition } from "./types";
import { SERVER_ONLY } from "./pc-shared";

export interface LockScreenAction {
  type: "lock_screen";
}

export const lockScreenAction: ActionDefinition<LockScreenAction> = {
  type: "lock_screen",
  description: "Bloquear la sesión de Windows (pantalla de bloqueo).",
  schema: `{ "type": "lock_screen" }`,
  risk: "confirm",
  label: () => ({ title: "Bloquear pantalla", detail: "Se bloqueará la sesión de Windows" }),
  parse(raw) {
    return isRecord(raw) ? { type: "lock_screen" } : null;
  },
  execution: {
    kind: "server",
    async run() {
      if (typeof window === "undefined") {
        const { lockScreen } = await import("./pc-control.server");
        return lockScreen();
      }
      return SERVER_ONLY;
    },
  },
};
