"use client";

import { useEffect, useState } from "react";
import { FORMAT_NAMES, setDocCostContext } from "@/lib/docs/cost";

const inputClass =
  "w-full rounded-lg border border-emerald/30 bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-turquoise/60";
const labelClass =
  "block font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-widest text-emerald/70";
const btn =
  "rounded border border-emerald/30 px-2 py-1 text-xs text-foreground/70 transition hover:border-accent-spark/60 hover:text-foreground disabled:opacity-40";
const JSON_HEADERS = { "Content-Type": "application/json" };

interface DocItem {
  id: string;
  title: string;
  format: string;
  date: string;
  file: string;
}

const MODELS = ["anthropic/claude-sonnet-5.5", "anthropic/claude-haiku-5.5", "anthropic/claude-opus-5.5"];

/** Ajustes de documentos: modelo de redacción, tope de tokens, abrir carpeta al crear y últimos documentos. */
export default function DocumentsSettings() {
  const [docModel, setDocModel] = useState("");
  const [mainModel, setMainModel] = useState("");
  const [maxTokens, setMaxTokens] = useState("6000");
  const [reveal, setReveal] = useState(true);
  const [folder, setFolder] = useState("Documentos\\Jarvis");
  const [items, setItems] = useState<DocItem[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((s) => {
        if (typeof s.docModel === "string") setDocModel(s.docModel);
        if (typeof s.model === "string") setMainModel(s.model);
        if (typeof s.docMaxTokens === "number") setMaxTokens(String(s.docMaxTokens));
        if (typeof s.docReveal === "boolean") setReveal(s.docReveal);
      })
      .catch(() => {});
    fetch("/api/documents", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setItems(Array.isArray(d.items) ? d.items : []);
        if (typeof d.folder === "string") setFolder(d.folder);
      })
      .catch(() => {});
  }, []);

  async function save() {
    const n = Number(maxTokens);
    if (!Number.isFinite(n) || n < 1000 || n > 16000) {
      setMsg("Los tokens para documentos van de 1000 a 16000.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({ docModel: docModel.trim(), docMaxTokens: Math.round(n), docReveal: reveal }),
      });
      if (res.ok) setDocCostContext(docModel.trim() || mainModel, Math.round(n));
      setMsg(res.ok ? "Guardado." : "No se pudo guardar (revisa el nombre del modelo).");
    } catch {
      setMsg("No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  async function post(body: Record<string, string>) {
    setMsg(null);
    try {
      const res = await fetch("/api/documents", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
      const d = await res.json().catch(() => null);
      if (!res.ok) setMsg(d?.error ?? "No se pudo abrir.");
    } catch {
      setMsg("No se pudo abrir.");
    }
  }

  return (
    <div className="space-y-2">
      <p className={labelClass}>Documentos (Word, PDF, Excel...)</p>
      <label htmlFor="s-doc-model" className={labelClass}>
        Modelo para redactar documentos
      </label>
      <input
        id="s-doc-model"
        list="s-doc-models"
        value={docModel}
        onChange={(e) => setDocModel(e.target.value)}
        placeholder={mainModel ? `Vacío = el principal (${mainModel})` : "Vacío = el modelo principal"}
        className={inputClass}
      />
      <datalist id="s-doc-models">
        {MODELS.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <p className="text-xs text-foreground/40">
        Cada documento redactado con IA cuesta unos centavos con Sonnet. Haiku es unas 20 veces más barato, pero redacta peor. Si el contenido
        ya está escrito (o lo dictas), se convierte sin IA y es gratis.
      </p>
      <label htmlFor="s-doc-tokens" className={labelClass}>
        Tokens máximos por documento (1000 a 16000)
      </label>
      <input id="s-doc-tokens" inputMode="numeric" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} className={inputClass} />
      <label className="flex items-start gap-2 text-sm text-foreground/80">
        <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} className="mt-1 accent-emerald" />
        <span>
          Abrir la carpeta al crear un documento
          <span className="block text-xs text-foreground/40">Abre el Explorador con el archivo seleccionado.</span>
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-lg border border-turquoise/50 px-3 py-1 text-sm text-core transition hover:bg-turquoise/10 disabled:opacity-40"
        >
          Guardar
        </button>
        <button type="button" onClick={() => void post({ action: "open-folder" })} className={btn}>
          Abrir carpeta de documentos
        </button>
        <span className="text-xs text-foreground/40">Se guardan en {folder}</span>
      </div>
      {msg && <p className="text-xs text-foreground/60">{msg}</p>}
      <div className="space-y-1 pt-1">
        <p className={labelClass}>Últimos documentos creados</p>
        {items.length === 0 && <p className="text-xs text-foreground/40">Todavía no hay documentos.</p>}
        {items.map((d) => (
          <div key={d.id} className="flex items-center justify-between gap-2 text-xs text-foreground/70">
            <span className="min-w-0 truncate">
              {d.title} · {FORMAT_NAMES[d.format] ?? d.format} · {new Date(d.date).toLocaleDateString("es-ES")}
            </span>
            <button type="button" onClick={() => void post({ action: "reveal", id: d.id })} className={btn}>
              Mostrar en carpeta
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
