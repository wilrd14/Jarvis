"use client";

import { useEffect, useState } from "react";

const inputClass =
  "w-full rounded-lg border border-emerald/30 bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-turquoise/60";
const labelClass =
  "block font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-widest text-emerald/70";

// Elegir el modelo según la pregunta. Se guarda por su cuenta (PUT /api/settings) con su propio botón.
export default function ModelRoutingSettings() {
  const [auto, setAuto] = useState(true);
  const [fastModel, setFastModel] = useState("anthropic/claude-haiku-5.5");
  const [maxTokens, setMaxTokens] = useState("2500");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((s) => {
        setAuto(s.modelStrategy !== "main");
        if (typeof s.fastModel === "string") setFastModel(s.fastModel);
        if (typeof s.brainMaxTokens === "number") setMaxTokens(String(s.brainMaxTokens));
      })
      .catch(() => {});
  }, []);

  async function save() {
    const n = Number(maxTokens);
    if (!Number.isFinite(n) || n < 300 || n > 8000) {
      setMsg("Los tokens de respuesta van de 300 a 8000.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelStrategy: auto ? "auto" : "main",
          fastModel: fastModel.trim(),
          brainMaxTokens: Math.round(n),
        }),
      });
      setMsg(res.ok ? "Guardado." : "No se pudo guardar (revisa el nombre del modelo).");
    } catch {
      setMsg("No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <label className="flex items-start gap-2 text-sm text-foreground/80">
        <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="mt-1 accent-emerald" />
        <span>
          Elegir el modelo según la pregunta
          <span className="block text-xs text-foreground/40">
            Charla y órdenes sencillas usan un modelo unas 20 veces más barato; lo difícil sigue con el principal.
          </span>
        </span>
      </label>
      <label htmlFor="s-fast-model" className={labelClass}>
        Modelo rápido
      </label>
      <input id="s-fast-model" value={fastModel} onChange={(e) => setFastModel(e.target.value)} className={inputClass} />
      <label htmlFor="s-max-tokens" className={labelClass}>
        Tokens máximos de respuesta (300 a 8000)
      </label>
      <div className="flex gap-2">
        <input id="s-max-tokens" inputMode="numeric" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} className={inputClass} />
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-lg border border-turquoise/50 px-3 text-sm text-core transition hover:bg-turquoise/10 disabled:opacity-40"
        >
          Guardar
        </button>
      </div>
      <p className="text-xs text-foreground/40">
        Menos tokens reservan menos saldo (evita el error 402 con saldo bajo), pero si es muy bajo la respuesta puede salir cortada.
      </p>
      {msg && <p className="text-xs text-foreground/60">{msg}</p>}
    </div>
  );
}
