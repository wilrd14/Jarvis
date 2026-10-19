"use client";

import { useEffect, useState } from "react";

interface KindTotals {
  calls: number;
  costUsd: number;
}
interface UsageData {
  available: boolean;
  usage?: number;
  daily?: number | null;
  weekly?: number | null;
  monthly?: number | null;
  limit?: number | null;
  limitRemaining?: number | null;
  limitReset?: string | null;
  spendMonth?: number;
  budget?: {
    monthlyBudgetUsd: number;
    blockOnBudget: boolean;
    overBudget: boolean;
    percent: number | null;
    justExceeded: boolean;
  };
  session?: { byKind: Record<string, KindTotals>; total: KindTotals };
}

const KIND_LABEL: Record<string, string> = {
  brain: "Cerebro",
  voice: "Voz",
  stt: "Transcripción",
  search: "Búsqueda",
};

const usd = (n: number | null | undefined) =>
  typeof n === "number" ? `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}` : "—";

// Indicador discreto del gasto en OpenRouter. Si no hay key o falla la consulta, no muestra nada.
export default function SpendBadge() {
  const [data, setData] = useState<UsageData | null>(null);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch("/api/usage", { cache: "no-store" });
        if (!res.ok) return;
        const d = (await res.json()) as UsageData;
        if (!alive) return;
        setData(d);
        if (d.budget?.justExceeded) setNotice(true);
      } catch {
        // sin datos: el indicador simplemente no aparece
      }
    }
    load();
    const id = window.setInterval(load, 60_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  if (!data?.available || typeof data.usage !== "number") return null;

  const spent = data.spendMonth ?? data.monthly ?? data.usage;
  const budget = data.budget?.monthlyBudgetUsd ?? 0;
  // Porcentaje: del tope configurado si existe; si no, del límite de la key.
  let pct: number | null = null;
  let remaining: number | null = null;
  if (budget > 0) {
    pct = (spent / budget) * 100;
    remaining = Math.max(0, budget - spent);
  } else if (data.limit && data.limit > 0) {
    pct = ((data.limit - (data.limitRemaining ?? data.limit)) / data.limit) * 100;
    remaining = data.limitRemaining ?? null;
  }
  const color =
    pct !== null && pct >= 100
      ? "text-red-400 border-red-400/50"
      : pct !== null && pct >= 80
        ? "text-amber-300 border-amber-300/50"
        : "text-foreground/50 border-emerald/20";

  const s = data.session;
  return (
    <div className="fixed bottom-3 left-3 z-40 font-[family-name:var(--font-mono)] text-[10px]">
      {notice && (
        <p className="mb-2 max-w-60 rounded-lg border border-red-400/50 bg-panel px-3 py-2 text-xs text-red-300">
          Llegaste al tope mensual de gasto que configuraste.{" "}
          <button className="underline" onClick={() => setNotice(false)}>
            Entendido
          </button>
        </p>
      )}
      {open && (
        <div className="mb-2 w-64 space-y-1 rounded-lg border border-emerald/30 bg-panel p-3 text-foreground/80">
          <p className="uppercase tracking-widest text-emerald/70">Gasto en OpenRouter</p>
          <p>Hoy: {usd(data.daily)} · Semana: {usd(data.weekly)}</p>
          <p>Mes: {usd(data.monthly)} · Total: {usd(data.usage)}</p>
          {data.limit ? (
            <p>
              Límite de la key: {usd(data.limit)}
              {data.limitReset ? ` (${data.limitReset})` : ""} · queda {usd(data.limitRemaining)}
            </p>
          ) : null}
          {budget > 0 && (
            <p>
              Tope mensual: {usd(budget)}
              {data.budget?.blockOnBudget ? " (bloquea)" : ""}
            </p>
          )}
          {s && (
            <div className="border-t border-emerald/20 pt-1">
              <p className="text-emerald/70">Esta sesión (estimado)</p>
              {Object.entries(s.byKind).map(([k, t]) => (
                <p key={k}>
                  {KIND_LABEL[k] ?? k}: {t.calls} {t.calls === 1 ? "llamada" : "llamadas"}
                  {t.costUsd > 0 ? ` · ${usd(t.costUsd)}` : ""}
                </p>
              ))}
              <p>
                Total: {s.total.calls} · {usd(s.total.costUsd)}
              </p>
            </div>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Gasto en OpenRouter"
        className={`rounded-full border bg-background/80 px-2.5 py-1 transition hover:text-core ${color}`}
      >
        {usd(spent)}
        {remaining !== null ? ` · quedan ${usd(remaining)}` : ""}
      </button>
    </div>
  );
}
