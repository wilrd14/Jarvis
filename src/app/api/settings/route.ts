import { rejectForeignRequest } from "@/lib/guard";
import { getAllSettings, sanitize, writeSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

// Nunca devuelve la key completa: solo si existe y sus últimos 4 caracteres.
function publicView() {
  const { openrouterApiKey, ...rest } = getAllSettings();
  return {
    ...rest,
    hasKey: openrouterApiKey.length > 0,
    keyLast4: openrouterApiKey ? openrouterApiKey.slice(-4) : "",
  };
}

export async function GET() {
  return json(publicView());
}

export async function PUT(req: Request) {
  const blocked = rejectForeignRequest(req, true);
  if (blocked) return blocked;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Cuerpo JSON inválido." }, 400);
  }
  const patch = sanitize(body);
  // Una key vacía no borra la existente (la UI la deja en blanco si no se cambia).
  if (!patch.openrouterApiKey) delete patch.openrouterApiKey;
  if (Object.keys(patch).length === 0) {
    return json({ error: "No hay ajustes válidos que guardar." }, 400);
  }
  try {
    writeSettings(patch);
  } catch {
    return json({ error: "No se pudo guardar el archivo de ajustes." }, 500);
  }
  return json(publicView());
}
