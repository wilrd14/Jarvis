import { jsonResponse, rejectForeignRequest } from "@/lib/guard";
import { cacheStats, clearCache } from "@/lib/ttsCache.server";

export const dynamic = "force-dynamic";

// proxy.ts ya filtra Host/Origen y exige Content-Type JSON en DELETE; aquí se repite el guard.
export async function GET(req: Request) {
  const blocked = rejectForeignRequest(req);
  if (blocked) return blocked;
  return jsonResponse(cacheStats());
}

export async function DELETE(req: Request) {
  const blocked = rejectForeignRequest(req);
  if (blocked) return blocked;
  const removed = clearCache();
  return jsonResponse({ removed, ...cacheStats() });
}
