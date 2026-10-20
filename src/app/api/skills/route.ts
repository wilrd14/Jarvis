import { spawn } from "node:child_process";
import fs from "node:fs";
import { rejectForeignRequest } from "@/lib/guard";
import { getSetting, writeSettings } from "@/lib/settings";
import {
  MAX_SKILLS,
  createUserSkill,
  deleteUserSkill,
  getSkillsSnapshot,
  skillUsage,
  userSkillsDir,
  NAME_RE,
} from "@/lib/skills.server";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

/** Lista de skills (sin rutas del sistema), rechazadas con su motivo y contadores. */
function listing() {
  const snap = getSkillsSnapshot({ fresh: true });
  const enabled = getSetting("skillsEnabled");
  const off = new Set(getSetting("disabledSkills"));
  const usage = skillUsage();
  const skills = snap.skills.map((s) => ({
    name: s.name,
    description: s.description.slice(0, 300),
    origin: s.origin,
    kind: s.kind,
    enabled: !off.has(s.name),
    uses: usage[s.name] ?? 0,
  }));
  return {
    enabled,
    skills,
    rejected: snap.rejected.slice(0, 100),
    active: enabled ? skills.filter((s) => s.enabled).length : 0,
    max: MAX_SKILLS,
  };
}

export async function GET(req: Request) {
  const blocked = rejectForeignRequest(req);
  if (blocked) return blocked;
  try {
    return json(listing());
  } catch {
    return json({ error: "No se pudieron leer las skills." }, 500);
  }
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = await req.json();
    return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Activar/desactivar: { name, enabled }. */
export async function PUT(req: Request) {
  const blocked = rejectForeignRequest(req);
  if (blocked) return blocked;
  const body = await readBody(req);
  if (!body) return json({ error: "JSON inválido." }, 400);
  const { name, enabled } = body;
  if (typeof name !== "string" || name.length > 64 || !NAME_RE.test(name) || typeof enabled !== "boolean") {
    return json({ error: "Faltan name (válido) y enabled (booleano)." }, 400);
  }
  if (!getSkillsSnapshot({ fresh: true }).skills.some((s) => s.name === name)) return json({ error: "No existe esa skill." }, 404);
  const off = new Set(getSetting("disabledSkills"));
  if (enabled) off.delete(name);
  else off.add(name);
  try {
    writeSettings({ disabledSkills: [...off] });
  } catch {
    return json({ error: "No se pudo guardar el ajuste." }, 500);
  }
  return json(listing());
}

/** { action: "create", name, content, overwrite? } | { action: "delete", name } | { action: "open" }. */
export async function POST(req: Request) {
  const blocked = rejectForeignRequest(req);
  if (blocked) return blocked;
  const body = await readBody(req);
  if (!body) return json({ error: "JSON inválido." }, 400);

  if (body.action === "create") {
    const r = createUserSkill(body.name, body.content, body.overwrite === true);
    return r.ok ? json(listing()) : json({ error: r.error }, r.status);
  }
  if (body.action === "delete") {
    const r = deleteUserSkill(body.name);
    return r.ok ? json(listing()) : json({ error: r.error }, r.status);
  }
  if (body.action === "open") {
    if (process.platform !== "win32") return json({ error: "Solo disponible en Windows." }, 501);
    try {
      const dir = userSkillsDir();
      fs.mkdirSync(dir, { recursive: true });
      const child = spawn("explorer.exe", [dir], { shell: false, detached: true, stdio: "ignore" });
      child.on("error", () => {});
      child.unref();
      return json({ ok: true });
    } catch {
      return json({ error: "No se pudo abrir la carpeta." }, 500);
    }
  }
  return json({ error: "Acción desconocida." }, 400);
}
