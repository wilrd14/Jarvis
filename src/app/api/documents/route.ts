import path from "node:path";
import { jsonResponse, rejectForeignRequest, rateLimit, tooMany } from "@/lib/guard";
import { listDocumentRecords, openOutputFolder, revealDocumentById } from "@/lib/docs/create.server";

export const dynamic = "force-dynamic";

/** Últimos documentos creados. Nunca devuelve rutas absolutas: solo el nombre del archivo. */
export async function GET(req: Request) {
  const blocked = rejectForeignRequest(req);
  if (blocked) return blocked;
  if (!rateLimit("documents-api", 60)) return tooMany();
  try {
    const items = (await listDocumentRecords(10)).map((d) => ({
      id: d.id,
      title: d.title,
      format: d.format,
      date: d.date,
      file: path.basename(d.path),
    }));
    return jsonResponse({ folder: "Documentos\\Jarvis", items });
  } catch {
    return jsonResponse({ error: "No se pudo leer la lista de documentos." }, 500);
  }
}

/**
 * { "action": "open-folder" } abre la carpeta de salida; { "action": "reveal", "id": "<id del índice>" } muestra ese
 * documento en el Explorador. Nunca se aceptan rutas: solo ids del índice de documentos creados por Jarvis.
 */
export async function POST(req: Request) {
  const blocked = rejectForeignRequest(req);
  if (blocked) return blocked;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "JSON inválido." }, 400);
  }
  if (!rateLimit("documents-open", 20)) return tooMany();
  const b = (typeof body === "object" && body !== null ? body : {}) as { action?: unknown; id?: unknown };
  if (b.action === "open-folder") {
    const r = await openOutputFolder();
    return jsonResponse(r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message }, r.ok ? 200 : 500);
  }
  if (b.action === "reveal") {
    if (typeof b.id !== "string" || !/^[a-f0-9]{8,32}$/.test(b.id)) return jsonResponse({ ok: false, error: "Id no válido." }, 400);
    const r = await revealDocumentById(b.id);
    return jsonResponse(r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message }, r.status);
  }
  return jsonResponse({ ok: false, error: "Acción no válida." }, 400);
}
