// Acceso privado desde el celular (Tailscale). Jarvis sigue escuchando solo en 127.0.0.1:
// `tailscale serve` publica ese puerto con HTTPS dentro de tu red privada y reenvía las
// peticiones con el Host del equipo (algo.tu-red.ts.net). Como todas llegan desde loopback,
// la IP no sirve para distinguirlas: lo que las separa es el Host, y las remotas exigen PIN.
//
// Config en <datos>/remote.json (nunca sale por /api/settings):
//   { enabled, host, pinSalt, pinHash, secret }
// La cookie de sesión es "<expira>.<HMAC(secret, expira)>"; cambiar el PIN rota el secreto y
// cierra todas las sesiones abiertas.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/settings";

export const SESSION_COOKIE = "jarvis_session";
const SESSION_DAYS = 30;
const HOST_RE = /^(?=.{4,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.ts\.net$/;
export const PIN_MIN = 6;
export const PIN_MAX = 64;

interface RemoteFile {
  enabled: boolean;
  host: string;
  pinSalt: string;
  pinHash: string;
  secret: string;
}

const EMPTY: RemoteFile = { enabled: false, host: "", pinSalt: "", pinHash: "", secret: "" };

const file = () => path.join(dataDir(), "remote.json");

function read(): RemoteFile {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), "utf8")) as Partial<RemoteFile>;
    return {
      enabled: raw.enabled === true,
      host: typeof raw.host === "string" && HOST_RE.test(raw.host) ? raw.host : "",
      pinSalt: typeof raw.pinSalt === "string" ? raw.pinSalt : "",
      pinHash: typeof raw.pinHash === "string" ? raw.pinHash : "",
      secret: typeof raw.secret === "string" ? raw.secret : "",
    };
  } catch {
    return { ...EMPTY };
  }
}

function write(cfg: RemoteFile) {
  const f = file();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, f);
}

export function isValidRemoteHost(host: string): boolean {
  return HOST_RE.test(host);
}

/** Estado público (sin hash ni secreto). */
export function remoteStatus() {
  const c = read();
  return { enabled: c.enabled, host: c.host, hasPin: !!c.pinHash };
}

/** El acceso remoto está listo para aceptar peticiones: activado, con host y con PIN. */
export function remoteHostOrNull(): string | null {
  const c = read();
  return c.enabled && c.host && c.pinHash && c.secret ? c.host : null;
}

export function hostnameOf(hostHeader: string): string {
  const m = hostHeader.trim().toLowerCase().match(/^(\[[^\]]+\]|[^:]+)(?::\d+)?$/);
  return m ? m[1] : "";
}

/** true si el encabezado Host es el del acceso remoto configurado y activo. */
export function isRemoteHost(hostHeader: string | null): boolean {
  if (!hostHeader) return false;
  const remote = remoteHostOrNull();
  return !!remote && hostnameOf(hostHeader) === remote;
}

function hashPin(pin: string, salt: Buffer): string {
  return crypto.scryptSync(pin, salt, 32).toString("hex");
}

/** Guarda cambios de la config. Un PIN nuevo rota el secreto (cierra todas las sesiones). */
export function updateRemote(patch: { enabled?: boolean; host?: string; pin?: string }): { ok: true } | { ok: false; error: string } {
  const c = read();
  if (patch.host !== undefined) {
    const h = patch.host.trim().toLowerCase().replace(/\.$/, "");
    if (h && !HOST_RE.test(h)) return { ok: false, error: "La dirección debe terminar en .ts.net (la que te da Tailscale)." };
    if (h !== c.host) c.secret = crypto.randomBytes(32).toString("hex");
    c.host = h;
  }
  if (patch.pin !== undefined) {
    const pin = patch.pin;
    if (pin.length < PIN_MIN || pin.length > PIN_MAX) return { ok: false, error: `El PIN debe tener entre ${PIN_MIN} y ${PIN_MAX} caracteres.` };
    if (/[\u0000-\u001f]/.test(pin)) return { ok: false, error: "El PIN tiene caracteres no válidos." };
    const salt = crypto.randomBytes(16);
    c.pinSalt = salt.toString("hex");
    c.pinHash = hashPin(pin, salt);
    c.secret = crypto.randomBytes(32).toString("hex");
  }
  if (patch.enabled !== undefined) {
    if (patch.enabled && (!c.host || !c.pinHash)) return { ok: false, error: "Antes de activarlo define la dirección de Tailscale y un PIN." };
    c.enabled = patch.enabled;
  }
  if (!c.secret) c.secret = crypto.randomBytes(32).toString("hex");
  write(c);
  return { ok: true };
}

/** Cierra todas las sesiones remotas abiertas sin cambiar el PIN. */
export function revokeSessions() {
  const c = read();
  c.secret = crypto.randomBytes(32).toString("hex");
  write(c);
}

// ── Intentos de PIN: tope global (todas las peticiones remotas llegan desde loopback) ──
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60_000;
let fails: number[] = [];
let lockedUntil = 0;

export function loginLockedMs(): number {
  return Math.max(0, lockedUntil - Date.now());
}

/** Comprueba el PIN. Tras 5 fallos seguidos bloquea los intentos 15 minutos. */
export function checkPin(pin: unknown): "ok" | "bad" | "locked" | "unavailable" {
  if (loginLockedMs() > 0) return "locked";
  const c = read();
  if (!c.enabled || !c.pinHash || typeof pin !== "string" || pin.length > PIN_MAX) return c.enabled && c.pinHash ? "bad" : "unavailable";
  const now = Date.now();
  fails = fails.filter((t) => now - t < LOCK_MS);
  let good = false;
  try {
    const a = Buffer.from(hashPin(pin, Buffer.from(c.pinSalt, "hex")), "hex");
    const b = Buffer.from(c.pinHash, "hex");
    good = a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    good = false;
  }
  if (good) {
    fails = [];
    return "ok";
  }
  fails.push(now);
  if (fails.length >= MAX_FAILS) {
    lockedUntil = now + LOCK_MS;
    fails = [];
    return "locked";
  }
  return "bad";
}

function sign(secret: string, exp: string) {
  return crypto.createHmac("sha256", secret).update(`jarvis-session:${exp}`).digest("hex");
}

export function issueSessionCookie(): string | null {
  const c = read();
  if (!c.secret) return null;
  const exp = String(Date.now() + SESSION_DAYS * 86_400_000);
  const value = `${exp}.${sign(c.secret, exp)}`;
  return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${SESSION_DAYS * 86_400}; HttpOnly; Secure; SameSite=Strict`;
}

export const clearSessionCookie = () => `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;

function cookieValue(header: string | null, name: string): string {
  if (!header) return "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}

/** La petición trae una sesión remota válida (firmada, no vencida, con el secreto actual). */
export function hasValidSession(cookieHeader: string | null): boolean {
  const c = read();
  if (!c.secret) return false;
  const v = cookieValue(cookieHeader, SESSION_COOKIE);
  const dot = v.indexOf(".");
  if (dot < 1) return false;
  const exp = v.slice(0, dot);
  const mac = v.slice(dot + 1);
  if (!/^\d{10,16}$/.test(exp) || Number(exp) < Date.now()) return false;
  const want = sign(c.secret, exp);
  return mac.length === want.length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want));
}
