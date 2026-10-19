// Utilidades de protección para las rutas /api: límites de tamaño, rate limit en memoria
// (protegen el saldo de OpenRouter) y respuestas de error que no filtran detalles del proveedor.

export const LIMITS = {
  messageChars: 4000,
  historyItemChars: 2000,
  historyItems: 12,
  speakChars: 1500,
  listenBytes: 2 * 1024 * 1024,
} as const;

const hits = new Map<string, number[]>();

/** true si se permite la petición; ventana deslizante por clave. */
export function rateLimit(key: string, max: number, windowMs = 60_000): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const tooMany = () =>
  jsonResponse({ error: "Demasiadas peticiones, espera un momento." }, 429);

/** Registra el detalle del proveedor en el log del servidor y devuelve un mensaje genérico. */
export function providerError(service: string, status: number, detail: string) {
  console.error(`[${service}] error ${status}: ${detail.slice(0, 500)}`);
  return jsonResponse(
    { error: `El servicio de ${service} no respondió bien (código ${status}).` },
    status >= 400 && status < 600 ? status : 502
  );
}
