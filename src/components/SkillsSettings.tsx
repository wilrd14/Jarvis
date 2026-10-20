"use client";

import { useCallback, useEffect, useState } from "react";

interface SkillItem {
  name: string;
  description: string;
  origin: "user" | "bundled" | "extra";
  kind: "folder" | "file";
  enabled: boolean;
  uses: number;
}
interface Rejected {
  name: string;
  origin: string;
  reason: string;
}

const ORIGIN: Record<string, string> = { user: "tuya", bundled: "incluida", extra: "carpeta extra" };
const labelClass =
  "block font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-widest text-emerald/70";
const btn =
  "rounded border border-emerald/30 px-2 py-1 text-xs text-foreground/70 transition hover:border-accent-spark/60 hover:text-foreground disabled:opacity-40";
const JSON_HEADERS = { "Content-Type": "application/json" };

function Switch({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition ${
        on ? "border-accent-spark/70 bg-emerald/40" : "border-emerald/30 bg-background"
      }`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-core transition-all ${on ? "left-6" : "left-0.5"}`} />
    </button>
  );
}

/** Skills: instrucciones en Markdown que Jarvis carga cuando la petición encaja. Nunca se ejecuta código. */
export default function SkillsSettings() {
  const [skills, setSkills] = useState<SkillItem[] | null>(null);
  const [rejected, setRejected] = useState<Rejected[]>([]);
  const [active, setActive] = useState(0);
  const [enabled, setEnabled] = useState(true);
  const [extraDir, setExtraDir] = useState("");
  const [savedExtra, setSavedExtra] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [newName, setNewName] = useState("");
  const [newText, setNewText] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);

  const apply = useCallback((d: { skills?: SkillItem[]; rejected?: Rejected[]; active?: number; enabled?: boolean }) => {
    setSkills(d.skills ?? []);
    setRejected(d.rejected ?? []);
    setActive(d.active ?? 0);
    if (typeof d.enabled === "boolean") setEnabled(d.enabled);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/skills", { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error();
      apply(d);
      setError("");
    } catch {
      setError("No se pudieron leer las habilidades.");
    }
  }, [apply]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((s) => {
        if (typeof s.skillsExtraDir === "string") {
          setExtraDir(s.skillsExtraDir);
          setSavedExtra(s.skillsExtraDir);
        }
      })
      .catch(() => undefined);
  }, [load]);

  async function call(method: string, body: unknown, okMsg = "") {
    setInfo("");
    try {
      const res = await fetch("/api/skills", { method, headers: JSON_HEADERS, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409 && (body as { action?: string }).action === "create") setConfirmOverwrite(true);
        setError(d.error ?? "No se pudo completar la operación.");
        return false;
      }
      setError("");
      if (d.skills) apply(d);
      if (okMsg) setInfo(okMsg);
      return true;
    } catch {
      setError("No se pudo completar la operación.");
      return false;
    }
  }

  async function putSetting(patch: Record<string, unknown>) {
    const res = await fetch("/api/settings", { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(patch) });
    return res.ok;
  }

  async function toggleAll(v: boolean) {
    setEnabled(v);
    if (!(await putSetting({ skillsEnabled: v }))) {
      setEnabled(!v);
      setError("No se pudo guardar el ajuste.");
    } else {
      load();
    }
  }

  async function saveExtra() {
    setInfo("");
    if (await putSetting({ skillsExtraDir: extraDir.trim() })) {
      setSavedExtra(extraDir.trim());
      setError("");
      load();
    } else {
      setError("Ruta no válida: usa una ruta absoluta de Windows, p. ej. C:\\Users\\tu\\.claude\\skills");
    }
  }

  async function create(overwrite: boolean) {
    const ok = await call("POST", { action: "create", name: newName.trim(), content: newText, overwrite }, "Habilidad guardada.");
    if (ok) {
      setNewName("");
      setNewText("");
      setShowNew(false);
      setConfirmOverwrite(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-foreground/90">Habilidades</p>
          <p className="text-xs text-foreground/40">
            Instrucciones en Markdown (SKILL.md o un .md suelto) que Jarvis carga cuando tu petición encaja. Solo se leen
            instrucciones de texto: nunca se ejecuta código de una habilidad.
          </p>
        </div>
        <Switch on={enabled} label="Usar habilidades" onClick={() => toggleAll(!enabled)} />
      </div>

      <div className="flex items-center justify-between">
        <span className={labelClass}>{active} {active === 1 ? "habilidad activa" : "habilidades activas"}</span>
        <div className="flex gap-2">
          <button type="button" className={btn} onClick={() => call("POST", { action: "open" })}>
            Abrir carpeta de skills
          </button>
          <button type="button" className={btn} onClick={() => setShowNew((v) => !v)}>
            Nueva
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {info && <p className="text-xs text-emerald/80">{info}</p>}

      {showNew && (
        <div className="space-y-2 rounded-lg border border-emerald/20 p-2">
          <input
            value={newName}
            onChange={(e) => { setNewName(e.target.value); setConfirmOverwrite(false); }}
            maxLength={64}
            placeholder="nombre-en-minusculas"
            aria-label="Nombre de la habilidad"
            className="w-full rounded border border-emerald/30 bg-background px-2 py-1 text-xs text-foreground"
          />
          <textarea
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            maxLength={22000}
            rows={6}
            placeholder="Pega aquí las instrucciones (Markdown). Opcional: frontmatter con name y description."
            aria-label="Instrucciones de la habilidad"
            className="w-full rounded border border-emerald/30 bg-background px-2 py-1 text-xs text-foreground"
          />
          <div className="flex items-center gap-2">
            <button type="button" className={btn} disabled={!newName.trim() || !newText.trim()} onClick={() => create(confirmOverwrite)}>
              {confirmOverwrite ? "Sobrescribir" : "Guardar"}
            </button>
            <span className="text-[10px] text-foreground/40">Se guarda como «nombre.md» en tu carpeta de skills.</span>
          </div>
        </div>
      )}

      {skills && skills.length === 0 && !error && <p className="text-xs text-foreground/40">No hay habilidades.</p>}
      {skills && skills.length > 0 && (
        <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
          {skills.map((s) => (
            <li key={s.name} className="flex items-start justify-between gap-2 rounded-lg border border-emerald/20 px-2 py-1.5">
              <div className="min-w-0">
                <p className="text-xs text-foreground/90">
                  {s.name} <span className="text-[10px] text-emerald/70">[{ORIGIN[s.origin] ?? s.origin}]</span>
                  {s.uses > 0 && <span className="ml-1 text-[10px] text-foreground/40">{s.uses} usos</span>}
                </p>
                <p className="text-[11px] text-foreground/50">{s.description}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {s.origin === "user" && (
                  <button
                    type="button"
                    aria-label={`Borrar habilidad ${s.name}`}
                    className="rounded border border-emerald/30 px-1.5 text-xs text-foreground/60 transition hover:border-red-400/60 hover:text-red-400"
                    onClick={() => call("POST", { action: "delete", name: s.name }, "Habilidad borrada.")}
                  >
                    Borrar
                  </button>
                )}
                <Switch on={s.enabled} label={`Activar ${s.name}`} onClick={() => call("PUT", { name: s.name, enabled: !s.enabled })} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {rejected.length > 0 && (
        <details className="text-xs text-foreground/50">
          <summary className="cursor-pointer">{rejected.length} rechazadas</summary>
          <ul className="mt-1 space-y-0.5">
            {rejected.map((r, i) => (
              <li key={`${r.name}-${i}`}>
                <span className="text-foreground/70">{r.name}</span> ({ORIGIN[r.origin] ?? r.origin}): {r.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="space-y-1">
        <span className={labelClass}>Carpeta extra de skills (opcional)</span>
        <div className="flex gap-2">
          <input
            value={extraDir}
            onChange={(e) => setExtraDir(e.target.value)}
            maxLength={260}
            placeholder="C:\Users\willi\.claude\skills"
            aria-label="Carpeta extra de skills"
            className="min-w-0 flex-1 rounded border border-emerald/30 bg-background px-2 py-1 text-xs text-foreground"
          />
          <button type="button" className={btn} disabled={extraDir.trim() === savedExtra} onClick={saveExtra}>
            Guardar
          </button>
        </div>
        <p className="text-[10px] text-foreground/40">
          Apagada si está vacía. Solo se leen las instrucciones (SKILL.md y archivos .md); NO se ejecuta código, scripts ni programas de esas carpetas.
        </p>
      </div>
    </div>
  );
}
