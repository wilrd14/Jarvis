import { isRecord, type ActionDefinition } from "./types";
import { normalizeAlias, SERVER_ONLY } from "./pc-shared";

export type VolumeMode = "up" | "down" | "mute" | "unmute" | "set";

export interface VolumeAction {
  type: "volume";
  mode: VolumeMode;
  /** Solo con mode "set": 0-100. */
  level?: number;
}

const MODE_ALIASES: Record<string, VolumeMode> = {
  up: "up", subir: "up", sube: "up",
  down: "down", bajar: "down", baja: "down",
  mute: "mute", silenciar: "mute", silencio: "mute",
  unmute: "unmute", "quitar silencio": "unmute", "activar sonido": "unmute",
  set: "set", fijar: "set",
};

export const volumeAction: ActionDefinition<VolumeAction> = {
  type: "volume",
  description:
    'Controlar el volumen del sistema. "mode": up (sube 10), down (baja 10), mute, unmute o set (con "level" entero 0-100).',
  schema: `{ "type": "volume", "mode": "set", "level": 40 }  (para up/down/mute/unmute omite "level")`,
  risk: "confirm",
  label: (a) => ({
    title: "Volumen",
    detail:
      a.mode === "set" ? `Fijar volumen al ${a.level}%`
      : a.mode === "up" ? "Subir el volumen"
      : a.mode === "down" ? "Bajar el volumen"
      : a.mode === "mute" ? "Silenciar el sonido"
      : "Quitar el silencio",
  }),
  parse(raw) {
    if (!isRecord(raw)) return null;
    const n = normalizeAlias(raw.mode);
    const mode = n && Object.hasOwn(MODE_ALIASES, n) ? MODE_ALIASES[n] : undefined;
    if (!mode) return null;
    if (mode === "set") {
      const level = raw.level;
      if (typeof level !== "number" || !Number.isInteger(level) || level < 0 || level > 100) return null;
      return { type: "volume", mode, level };
    }
    if (raw.level != null) return null;
    return { type: "volume", mode };
  },
  execution: {
    kind: "server",
    async run(a) {
      if (typeof window === "undefined") {
        const { setVolume } = await import("./pc-control.server");
        return setVolume(a.mode, a.level);
      }
      return SERVER_ONLY;
    },
  },
};
