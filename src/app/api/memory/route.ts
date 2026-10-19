import { rejectForeignRequest } from "@/lib/guard";
import { deleteMemory, listMemories, MAX_MEMORIES } from "@/lib/store/memory";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

/** Lista de recuerdos (más recientes primero). */
export async function GET(req: Request) {
  const blocked = rejectForeignRequest(req);
  if (blocked) return blocked;
  try {
    const items = await listMemories();
    return json({ items, count: items.length, max: MAX_MEMORIES });
  } catch {
    return json({ error: "No se pudo leer la memoria." }, 500);
  }
}

/**
 * Borrado por id. Es una acción explícita del usuario en su propia interfaz,
 * por eso no pasa por el cerebro ni necesita firma.
 */
export async function DELETE(req: Request) {
  const blocked = rejectForeignRequest(req);
  if (blocked) return blocked;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido." }, 400);
  }
  const id = (body as { id?: unknown } | null)?.id;
  if (typeof id !== "string" || !/^[\w-]{1,64}$/.test(id)) return json({ error: "Falta el id." }, 400);
  try {
    const res = await deleteMemory({ id });
    return res.ok ? json({ ok: true }) : json({ ok: false, error: res.reason }, 404);
  } catch {
    return json({ error: "No se pudo borrar el recuerdo." }, 500);
  }
}
