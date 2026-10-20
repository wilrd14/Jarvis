/**
 * Skills (habilidades): instrucciones en Markdown. Jarvis NUNCA ejecuta código de una skill, solo lee texto.
 * Patrón de memory.ts: el módulo de disco (skills.server.ts) se registra en globalThis desde
 * src/lib/store/register.ts, así que aquí no se importa `fs`.
 */
import { isRecord, str, type ActionDefinition, type ServerActionResult } from "./types";

type Skills = typeof import("../skills.server");

function skills(): Skills {
  const s = (globalThis as { __jarvisSkills?: Skills }).__jarvisSkills;
  if (!s) throw new Error("Las habilidades solo están disponibles en el servidor.");
  return s;
}

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface SkillUseAction {
  type: "skill_use";
  name: string;
}

export const skillUseAction: ActionDefinition<SkillUseAction> = {
  type: "skill_use",
  description:
    'Cargar las instrucciones de una habilidad de la lista "Habilidades disponibles" cuando la petición del usuario encaja con ella (informe, carta, acta, currículum...). Úsala ANTES de responder; el sistema te devolverá las instrucciones y entonces haces la tarea. "name" es el nombre exacto de la lista. Sin confirmación.',
  schema: `{ "type": "skill_use", "name": "informe-formal" }`,
  risk: "low",
  label: (a) => ({ title: "Habilidad", detail: a.name }),
  parse(raw) {
    if (!isRecord(raw)) return null;
    const name = str(raw.name, 1, 64);
    return name && NAME_RE.test(name) ? { type: "skill_use", name } : null;
  },
  execution: {
    kind: "server",
    async run(a): Promise<ServerActionResult> {
      const r = skills().loadSkill(a.name);
      return r.ok ? { ok: true, message: r.message, followUp: r.followUp } : { ok: false, message: r.message };
    },
  },
};

export interface SkillReadAction {
  type: "skill_read";
  name: string;
  file: string;
}

export const skillReadAction: ActionDefinition<SkillReadAction> = {
  type: "skill_read",
  description:
    'Leer un archivo de referencia (.md o .txt) de una habilidad ya cargada con skill_use, cuando sus instrucciones lo mencionan (p. ej. "references/apa.md"). Sin confirmación.',
  schema: `{ "type": "skill_read", "name": "informe-universitario", "file": "references/apa.md" }`,
  risk: "low",
  label: (a) => ({ title: "Referencia de habilidad", detail: `${a.name}/${a.file}` }),
  parse(raw) {
    if (!isRecord(raw)) return null;
    const name = str(raw.name, 1, 64);
    const file = str(raw.file, 1, 120);
    return name && NAME_RE.test(name) && file ? { type: "skill_read", name, file } : null;
  },
  execution: {
    kind: "server",
    async run(a): Promise<ServerActionResult> {
      const r = skills().readSkillFile(a.name, a.file);
      return r.ok ? { ok: true, message: r.message, followUp: r.followUp } : { ok: false, message: r.message };
    },
  },
};

export const skillActions = [skillUseAction, skillReadAction] as const;
