import { NextResponse, type NextRequest } from "next/server";
import { hasValidSession, isRemoteHost } from "@/lib/remote.server";

// Jarvis escucha solo en 127.0.0.1, pero cualquier página web abierta en el navegador
// puede intentar llamar a ese puerto (CSRF) o resolver un dominio suyo a 127.0.0.1
// (DNS rebinding). Este guard deja pasar únicamente peticiones de la propia app.
const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

const deny = (status: number, message: string) =>
  new NextResponse(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function hostnameOf(host: string) {
  return host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
}

// Acceso remoto (Tailscale): estas rutas se pueden ver sin sesión para poder poner el PIN.
const REMOTE_PUBLIC = new Set(["/login", "/api/remote/login", "/manifest.webmanifest"]);

export function proxy(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  const path = req.nextUrl.pathname;
  const isApi = path.startsWith("/api/");
  const remote = !LOCAL_HOSTNAMES.has(hostnameOf(host).toLowerCase());

  // Anti DNS rebinding: el Host debe ser el del propio equipo o el del acceso remoto configurado.
  if (remote) {
    if (!isRemoteHost(host)) return deny(403, "Host no permitido.");
    // El panel de ajustes y la config del acceso remoto solo se tocan desde el propio PC.
    if (path.startsWith("/api/remote/config") || (path.startsWith("/api/settings") && req.method !== "GET")) {
      return deny(403, "Solo disponible desde el PC.");
    }
    if (!REMOTE_PUBLIC.has(path) && !hasValidSession(req.headers.get("cookie"))) {
      if (isApi) return deny(401, "Necesitas iniciar sesión con tu PIN.");
      return NextResponse.redirect(new URL("/login", `https://${host}`));
    }
  }

  // Anti CSRF: los navegadores marcan el origen de la petición; solo la propia app o una
  // navegación directa (none) son válidas.
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    return deny(403, "Origen no permitido.");
  }
  const origin = req.headers.get("origin");
  if (origin) {
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {
      return deny(403, "Origen no permitido.");
    }
    if (originHost !== host) return deny(403, "Origen no permitido.");
  }

  // Las peticiones con cuerpo deben usar un tipo que obliga al navegador a hacer preflight
  // (JSON) o audio en /api/listen; text/plain y formularios no pasan.
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
    const type = (req.headers.get("content-type") ?? "").toLowerCase();
    const isListen = req.nextUrl.pathname === "/api/listen";
    const ok = type.startsWith("application/json") || (isListen && type.startsWith("audio/"));
    if (!ok) return deny(415, "Tipo de contenido no permitido.");
  }

  return NextResponse.next();
}

// Todo menos los archivos estáticos (no contienen datos): páginas y API pasan por el guard.
export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico|icon-.*\\.png|logo.svg).*)",
};
