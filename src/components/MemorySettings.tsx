"use client";

import { useCallback, useEffect, useState } from "react";

interface MemoryItem {
  id: string;
  text: string;
  tag?: string;
}

const labelClass =
  "block font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-widest text-emerald/70";

/** Memoria a largo plazo: interruptor de uso, contador "n de 200" y lista con botón de borrar. */
export default function MemorySettings() {
  const [items, setItems] = useState<MemoryItem[] | null>(null);
  const [max, setMax] = useState(200);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/memory", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error();
      setItems(data.items ?? []);
      if (typeof data.max === "number") setMax(data.max);
      setError("");
    } catch {
      setError("No se pudo leer la memoria.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((s) => typeof s.memoryEnabled === "boolean" && setEnabled(s.memoryEnabled))
      .catch(() => undefined);
  }, [load]);

  async function remove(id: string) {
    try {
      const res = await fetch("/api/memory", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok && res.status !== 404) throw new Error();
      await load();
    } catch {
      setError("No se pudo borrar el recuerdo.");
    }
  }

  async function toggle(v: boolean) {
    setEnabled(v);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memoryEnabled: v }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setEnabled(!v);
      setError("No se pudo guardar el ajuste.");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-foreground/90">Memoria a largo plazo</p>
          <p className="text-xs text-foreground/40">
            Datos que le pides recordar («recuerda que...»). Si la apagas, no se usan pero no se borran.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Usar la memoria"
          onClick={() => toggle(!enabled)}
          className={`relative h-6 w-11 shrink-0 rounded-full border transition ${
            enabled ? "border-accent-spark/70 bg-emerald/40" : "border-emerald/30 bg-background"
          }`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-core transition-all ${
              enabled ? "left-6" : "left-0.5"
            }`}
          />
        </button>
      </div>
      <div className="flex items-center justify-between">
        <span className={labelClass}>Recuerdos</span>
        <span className="text-xs text-foreground/50">
          {items ? items.length : 0} de {max}
        </span>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {items && items.length === 0 && !error && (
        <p className="text-xs text-foreground/40">Todavía no hay nada guardado.</p>
      )}
      {items && items.length > 0 && (
        <ul className="max-h-48 space-y-1 overflow-y-auto pr-1">
          {items.map((m) => (
            <li
              key={m.id}
              className="flex items-start justify-between gap-2 rounded-lg border border-emerald/20 px-2 py-1.5"
            >
              <span className="text-xs text-foreground/80">
                {m.tag && <span className="mr-1 text-emerald/70">[{m.tag}]</span>}
                {m.text}
              </span>
              <button
                type="button"
                onClick={() => remove(m.id)}
                aria-label={`Borrar recuerdo: ${m.text}`}
                className="shrink-0 rounded border border-emerald/30 px-1.5 text-xs text-foreground/60 transition hover:border-red-400/60 hover:text-red-400"
              >
                Borrar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
