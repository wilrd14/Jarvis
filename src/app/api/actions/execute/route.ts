import { getActionDefinition } from "@/lib/actions";
import "@/lib/store/register";
import { verifyProposal } from "@/lib/proposals.server";
import { rateLimit, tooMany } from "@/lib/guard";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Ejecuta acciones de tipo `server`. El tipo se valida contra la lista cerrada
 * del registro y los campos con el `parse` estricto de cada acción.
 */
export async function POST(req: Request) {
  if (!rateLimit("execute", 60)) return tooMany();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "JSON inválido." }, 400);
  }
  const raw = (body as { action?: unknown } | null)?.action;
  if (typeof raw !== "object" || raw === null) {
    return json({ ok: false, error: "Falta la acción." }, 400);
  }

  const def = getActionDefinition((raw as { type?: unknown }).type);
  if (!def) return json({ ok: false, error: "Tipo de acción desconocido." }, 400);
  if (def.execution.kind !== "server") {
    return json({ ok: false, error: "Esta acción se ejecuta en el navegador." }, 400);
  }

  const action = def.parse(raw);
  if (!action) return json({ ok: false, error: "Campos de la acción inválidos." }, 400);

  // Las acciones que piden confirmación solo se ejecutan si el cerebro las propuso (firma válida).
  if (def.risk === "confirm") {
    const token = (body as { actionToken?: unknown }).actionToken;
    if (!verifyProposal(action, token)) {
      return json({ ok: false, error: "Esta acción no fue propuesta por Jarvis o ya caducó." }, 403);
    }
  }

  try {
    const result = await def.execution.run(action);
    return json(result, result.ok ? 200 : 500);
  } catch {
    return json({ ok: false, error: "Falló la ejecución de la acción." }, 500);
  }
}
