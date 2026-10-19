// Ajustes persistentes (solo servidor). Prioridad de cada valor:
// settings.json > variable de entorno > valor por defecto.
// Contrato con la app de escritorio: JARVIS_DATA_DIR define la carpeta y
// openrouterApiKey vive en settings.json.
import fs from "node:fs";
import path from "node:path";

export interface Settings {
  openrouterApiKey: string;
  model: string;
  ttsModel: string;
  ttsVoice: string;
  sttModel: string;
  silenceMs: number;
  conversationMode: boolean;
  wakeWord: boolean;
}

export type SettingName = keyof Settings;

export const DEFAULTS: Settings = {
  openrouterApiKey: "",
  model: "anthropic/claude-sonnet-5.5",
  ttsModel: "elevenlabs/eleven-flash-v2.5",
  ttsVoice: "george",
  sttModel: "google/gemini-3.1-flash-lite",
  silenceMs: 1200,
  conversationMode: false,
  wakeWord: false,
};

const ENV_NAMES: Partial<Record<SettingName, string>> = {
  openrouterApiKey: "OPENROUTER_API_KEY",
  model: "OPENROUTER_MODEL",
  ttsModel: "OPENROUTER_TTS_MODEL",
  ttsVoice: "OPENROUTER_TTS_VOICE",
  sttModel: "OPENROUTER_STT_MODEL",
};

export function dataDir(): string {
  return process.env.JARVIS_DATA_DIR || path.join(process.cwd(), ".jarvis-data");
}

function settingsFile(): string {
  return path.join(dataDir(), "settings.json");
}

const STRING_FIELDS = ["openrouterApiKey", "model", "ttsModel", "ttsVoice", "sttModel"] as const;
const BOOL_FIELDS = ["conversationMode", "wakeWord"] as const;

// Valida un objeto arbitrario: devuelve solo los campos válidos (los demás se ignoran).
export function sanitize(input: unknown): Partial<Settings> {
  const out: Partial<Settings> = {};
  if (!input || typeof input !== "object") return out;
  const src = input as Record<string, unknown>;
  for (const k of STRING_FIELDS) {
    const v = src[k];
    if (typeof v === "string" && v.length <= 300 && !/[\r\n]/.test(v)) out[k] = v.trim();
  }
  for (const k of BOOL_FIELDS) {
    if (typeof src[k] === "boolean") out[k] = src[k] as boolean;
  }
  const s = src.silenceMs;
  if (typeof s === "number" && Number.isFinite(s)) {
    out.silenceMs = Math.min(5000, Math.max(500, Math.round(s)));
  }
  return out;
}

export function readSettingsFile(): Partial<Settings> {
  try {
    return sanitize(JSON.parse(fs.readFileSync(settingsFile(), "utf8")));
  } catch {
    return {};
  }
}

export function writeSettings(patch: Partial<Settings>): Partial<Settings> {
  const merged = { ...readSettingsFile(), ...sanitize(patch) };
  const file = settingsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), "utf8");
  fs.renameSync(tmp, file); // escritura atómica
  return merged;
}

export function getSetting<K extends SettingName>(name: K): Settings[K] {
  const fromFile = readSettingsFile()[name];
  // Un string vacío en el archivo significa "sin definir": cae a env/default.
  if (fromFile !== undefined && fromFile !== "") return fromFile as Settings[K];
  const envName = ENV_NAMES[name];
  const fromEnv = envName ? process.env[envName] : undefined;
  if (fromEnv) return fromEnv as Settings[K];
  return DEFAULTS[name];
}

export function getAllSettings(): Settings {
  const out = {} as Record<string, unknown>;
  for (const k of Object.keys(DEFAULTS) as SettingName[]) out[k] = getSetting(k);
  return out as unknown as Settings;
}
