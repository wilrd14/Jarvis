// Propuestas firmadas: /api/brain firma cada acción que pide confirmación y
// /api/actions/execute solo ejecuta acciones de riesgo "confirm" que traigan una firma
// válida de esa misma acción. Así el servidor no ejecuta acciones inventadas por quien
// llame a la API directamente; solo las que el cerebro propuso (y el usuario confirmó en la tarjeta).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const TTL_MS = 10 * 60_000;

// globalThis: Next puede cargar este módulo por separado en cada ruta.
const g = globalThis as { __jarvisProposalSecret?: Buffer };
const secret = (g.__jarvisProposalSecret ??= randomBytes(32));

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const mac = (exp: number, action: unknown) =>
  createHmac("sha256", secret).update(`${exp}.${canonical(action)}`).digest("hex");

export function signProposal(action: unknown): string {
  const exp = Date.now() + TTL_MS;
  return `${exp}.${mac(exp, action)}`;
}

export function verifyProposal(action: unknown, token: unknown): boolean {
  if (typeof token !== "string") return false;
  const [expRaw, given] = token.split(".");
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Date.now() || !given) return false;
  const expected = Buffer.from(mac(exp, action));
  const actual = Buffer.from(given);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
