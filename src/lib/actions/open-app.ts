import { isRecord, type ActionDefinition } from "./types";
import { resolveAlias, SERVER_ONLY } from "./pc-shared";

/** Lista cerrada de apps: id -> alias en español (normalizados, sin acentos). */
export const APP_ALIASES = {
  browser: ["navegador", "chrome", "google chrome", "el navegador", "internet"],
  notepad: ["bloc de notas", "notepad", "bloc notas", "editor de texto"],
  calculator: ["calculadora", "calc", "calculator"],
  explorer: ["explorador de archivos", "explorador", "archivos", "explorer", "mis archivos"],
  spotify: ["spotify"],
  discord: ["discord"],
  vscode: ["vs code", "vscode", "visual studio code", "code", "editor de codigo"],
  terminal: ["terminal", "windows terminal", "consola", "powershell"],
  settings: ["configuracion", "ajustes", "settings", "ajustes de windows"],
  taskmgr: ["administrador de tareas", "task manager", "gestor de tareas", "taskmgr"],
} as const satisfies Record<string, readonly string[]>;

export type AppId = keyof typeof APP_ALIASES;
const APP_LABELS: Record<AppId, string> = {
  browser: "el navegador",
  notepad: "el Bloc de notas",
  calculator: "la Calculadora",
  explorer: "el Explorador de archivos",
  spotify: "Spotify",
  discord: "Discord",
  vscode: "VS Code",
  terminal: "la Terminal",
  settings: "Configuración",
  taskmgr: "el Administrador de tareas",
};

export interface OpenAppAction {
  type: "open_app";
  app: AppId;
}

export const openAppAction: ActionDefinition<OpenAppAction> = {
  type: "open_app",
  description: `Abrir una aplicación del PC de una lista cerrada. Valores de "app": ${Object.keys(APP_ALIASES).join(", ")} (navegador, bloc de notas, calculadora, explorador de archivos, Spotify, Discord, VS Code, terminal, configuración, administrador de tareas). No se pueden abrir otras apps.`,
  schema: `{ "type": "open_app", "app": "calculator" }`,
  risk: "confirm",
  label: (a) => ({ title: "Abrir aplicación", detail: `Abrir ${APP_LABELS[a.app]}` }),
  parse(raw) {
    if (!isRecord(raw)) return null;
    const app = resolveAlias(raw.app, APP_ALIASES);
    return app ? { type: "open_app", app } : null;
  },
  execution: {
    kind: "server",
    async run(a) {
      if (typeof window === "undefined") {
        const { openApp } = await import("./pc-control.server");
        return openApp(a.app);
      }
      return SERVER_ONLY;
    },
  },
};
