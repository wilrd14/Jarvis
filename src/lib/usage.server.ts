// Contador de gasto de OpenRouter: consulta remota con caché (GET /api/v1/key), estimación de la
// sesión actual (acumulada en memoria) y comprobación del tope mensual configurable.
// Nunca se guarda ni se devuelve la API key ni su etiqueta.
import { getSetting } from "@/lib/settings";
import { jsonResponse } from "@/lib/guard";

export type UsageKind = "brain" | "voice" | "stt" | "search";

export interface KindTotals {
  calls: number;
  costUsd: number;
}

export interface RemoteUsage {
  usage: number;
  daily: number | null;
  weekly: number | null;
  monthly: number | null;
  limit: number | null;
  limitRemaining: number | null;
  limitReset: string | null;
  /** Crédito comprado en la cuenta y lo que queda (el límite de la key puede ser mayor que el saldo real). */
  creditsTotal: number | null;
  creditsRemaining: number | null;
  fetchedAt: number;
}

const CACHE_MS = 60_000;

interface State {
  session: Record<UsageKind, KindTotals>;
  sessionStart: number;
  cache: { key: string; data: RemoteUsage; costAtFetch: number } | null;
  inflight: Promise<RemoteUsage | null> | null;
  warned: boolean;
  /** Gasto de la sesion por modelo (solo llamadas que lo informan, p. ej. el cerebro). */
  byModel?: Record<string, KindTotals>;
}

// globalThis: las rutas pueden cargarse en módulos separados y deben compartir el mismo estado.
const g = globalThis as unknown as { __jarvisUsage?: State };
const state: State = (g.__jarvisUsage ??= {
  session: {
    brain: { calls: 0, costUsd: 0 },
    voice: { calls: 0, costUsd: 0 },
    stt: { calls: 0, costUsd: 0 },
    search: { calls: 0, costUsd: 0 },
  },
  sessionStart: Date.now(),
  cache: null,
  inflight: null,
  warned: false,
});

/** Anota una llamada. `cost` es usage.cost de OpenRouter (USD); si no lo da, solo cuenta la llamada. */
export function recordUsage(kind: UsageKind, cost?: unknown, model?: string) {
  const t = state.session[kind];
  t.calls += 1;
  const paid = typeof cost === "number" && Number.isFinite(cost) && cost > 0 ? cost : 0;
  t.costUsd += paid;
  if (model) {
    const m = ((state.byModel ??= {})[model] ??= { calls: 0, costUsd: 0 });
    m.calls += 1;
    m.costUsd += paid;
  }
}

export function sessionUsage() {
  const total = Object.values(state.session).reduce(
    (a, t) => ({ calls: a.calls + t.calls, costUsd: a.costUsd + t.costUsd }),
    { calls: 0, costUsd: 0 },
  );
  return { since: state.sessionStart, byKind: { ...state.session }, byModel: { ...(state.byModel ?? {}) }, total };
}

function sessionCost() {
  return sessionUsage().total.costUsd;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

async function fetchRemote(apiKey: string): Promise<RemoteUsage | null> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error(`[usage] OpenRouter respondió ${res.status}`);
      return null;
    }
    const d = (await res.json())?.data;
    const usage = num(d?.usage);
    if (usage === null) return null;
    // Saldo real de la cuenta: si falla, el resto del contador sigue funcionando.
    let creditsTotal: number | null = null;
    let creditsRemaining: number | null = null;
    try {
      const cr = await fetch("https://openrouter.ai/api/v1/credits", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      });
      if (cr.ok) {
        const c = (await cr.json())?.data;
        creditsTotal = num(c?.total_credits);
        const used = num(c?.total_usage);
        if (creditsTotal !== null && used !== null) creditsRemaining = Math.max(0, creditsTotal - used);
      }
    } catch {
      /* sin saldo disponible */
    }
    return {
      usage,
      daily: num(d.usage_daily),
      weekly: num(d.usage_weekly),
      monthly: num(d.usage_monthly),
      limit: num(d.limit),
      limitRemaining: num(d.limit_remaining),
      limitReset: typeof d.limit_reset === "string" ? d.limit_reset : null,
      creditsTotal,
      creditsRemaining,
      fetchedAt: Date.now(),
    };
  } catch {
    console.error("[usage] no se pudo consultar OpenRouter");
    return null;
  }
}

/** Uso remoto con caché de ~60 s. Si la consulta falla, devuelve el último valor conocido (o null). */
export async function getRemoteUsage(): Promise<{ data: RemoteUsage; cached: boolean } | null> {
  const apiKey = getSetting("openrouterApiKey");
  if (!apiKey) return null;
  const c = state.cache;
  if (c && c.key === apiKey && Date.now() - c.data.fetchedAt < CACHE_MS) {
    return { data: c.data, cached: true };
  }
  state.inflight ??= fetchRemote(apiKey).finally(() => {
    state.inflight = null;
  });
  const data = await state.inflight;
  if (data) {
    state.cache = { key: apiKey, data, costAtFetch: sessionCost() };
    return { data, cached: false };
  }
  if (c && c.key === apiKey) return { data: c.data, cached: true };
  return null;
}

/** Gasto del mes (o total si la API no da mensual), incluido lo gastado en esta sesión tras la última consulta. */
export function monthSpend(data: RemoteUsage): number {
  const base = data.monthly ?? data.usage;
  const extra = Math.max(0, sessionCost() - (state.cache?.costAtFetch ?? 0));
  return base + extra;
}

export function budgetStatus(data: RemoteUsage | null) {
  const budget = getSetting("monthlyBudgetUsd");
  const spent = data ? monthSpend(data) : null;
  return {
    monthlyBudgetUsd: budget,
    blockOnBudget: getSetting("blockOnBudget"),
    overBudget: budget > 0 && spent !== null && spent >= budget,
    percent: budget > 0 && spent !== null ? (spent / budget) * 100 : null,
  };
}

/** Marca (una sola vez por sesión) que ya se avisó de haber superado el tope. */
export function takeBudgetWarning(over: boolean): boolean {
  if (!over) {
    state.warned = false;
    return false;
  }
  if (state.warned) return false;
  state.warned = true;
  return true;
}

/**
 * Devuelve una respuesta 402 si el gasto del mes superó el tope y el bloqueo está activo; si no, null.
 * Solo consulta la red (con caché de 60 s) cuando el bloqueo está activo.
 */
export async function rejectIfOverBudget(): Promise<Response | null> {
  const budget = getSetting("monthlyBudgetUsd");
  if (!(budget > 0) || !getSetting("blockOnBudget")) return null;
  const remote = await getRemoteUsage();
  if (!remote) return null; // sin datos no bloqueamos: no queremos dejar a Jarvis mudo por un fallo de red
  if (monthSpend(remote.data) < budget) return null;
  return jsonResponse(
    {
      error:
        "Llegaste al tope mensual de gasto que configuraste. Sube el tope en Ajustes para seguir usando Jarvis.",
      code: "budget_exceeded",
    },
    402,
  );
}
