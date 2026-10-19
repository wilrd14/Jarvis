"use client";

import { useEffect, useState } from "react";

// Tope mensual de gasto. Se guarda por su cuenta (PUT /api/settings) con su propio botón.
export default function BudgetSettings() {
  const [budget, setBudget] = useState("");
  const [block, setBlock] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((s) => {
        setBudget(s.monthlyBudgetUsd > 0 ? String(s.monthlyBudgetUsd) : "");
        setBlock(!!s.blockOnBudget);
      })
      .catch(() => {});
  }, []);

  async function save() {
    const n = budget.trim() === "" ? 0 : Number(budget.replace(",", "."));
    if (!Number.isFinite(n) || n < 0 || n > 100000) {
      setMsg("Escribe un monto entre 0 y 100000.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthlyBudgetUsd: n, blockOnBudget: block }),
      });
      setMsg(res.ok ? "Tope guardado." : "No se pudo guardar el tope.");
    } catch {
      setMsg("No se pudo guardar el tope.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <label
        htmlFor="s-budget"
        className="block font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-widest text-emerald/70"
      >
        Tope mensual de gasto (USD, vacío = sin tope)
      </label>
      <div className="flex gap-2">
        <input
          id="s-budget"
          inputMode="decimal"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          placeholder="0"
          className="w-full rounded-lg border border-emerald/30 bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-turquoise/60"
        />
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-lg border border-turquoise/50 px-3 text-sm text-core transition hover:bg-turquoise/10 disabled:opacity-40"
        >
          Guardar tope
        </button>
      </div>
      <label className="flex items-center gap-2 text-sm text-foreground/80">
        <input
          type="checkbox"
          checked={block}
          onChange={(e) => setBlock(e.target.checked)}
          className="accent-emerald"
        />
        Bloquear Jarvis al llegar al tope
      </label>
      {msg && <p className="text-xs text-foreground/60">{msg}</p>}
    </div>
  );
}
