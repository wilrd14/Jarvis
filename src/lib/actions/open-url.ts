import { isRecord, str, type ActionDefinition } from "./types";

export interface OpenUrlAction {
  type: "open_url";
  url: string;
}

/** Solo http/https, sin credenciales embebidas; devuelve la URL normalizada. */
export function safeHttpUrl(v: unknown): string | undefined {
  const s = str(v, 4, 2048);
  if (!s || /[\u0000-\u001f\s]/.test(s)) return undefined;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    if (u.username || u.password || !u.hostname) return undefined;
    return u.href;
  } catch {
    return undefined;
  }
}

// Se ejecuta en el navegador (window.open): abre en el navegador que el usuario
// ya usa, no necesita servidor ni child_process y el sandbox del navegador
// aplica; la URL se revalida aquí antes de abrirla.
export const openUrlAction: ActionDefinition<OpenUrlAction> = {
  type: "open_url",
  description: "Abrir una página web (URL http o https completa) en el navegador del usuario.",
  schema: `{ "type": "open_url", "url": "https://www.youtube.com" }`,
  risk: "confirm",
  label: (a) => ({ title: "Abrir página web", detail: a.url }),
  parse(raw) {
    if (!isRecord(raw)) return null;
    const url = safeHttpUrl(raw.url);
    return url ? { type: "open_url", url } : null;
  },
  execution: {
    kind: "client",
    run(a) {
      const url = safeHttpUrl(a.url);
      if (!url) throw new Error("URL no válida.");
      window.open(url, "_blank", "noopener,noreferrer");
    },
  },
};
