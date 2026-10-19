import { takeDue } from "@/lib/store/reminders";
import { rejectForeignRequest } from "@/lib/guard";

export const dynamic = "force-dynamic";

/**
 * Entrega los recordatorios/temporizadores/alarmas vencidos y los marca como
 * disparados, así que cada uno se devuelve una sola vez. Los que vencieron con
 * la app apagada salen en la primera consulta.
 */
export async function POST(req: Request) {
  const blocked = rejectForeignRequest(req);
  if (blocked) return blocked;
  try {
    const due = await takeDue();
    return Response.json({ due }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ due: [], error: "No se pudo leer los recordatorios." }, { status: 500 });
  }
}
