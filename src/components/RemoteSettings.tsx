"use client";

import { useCallback, useEffect, useState } from "react";

const inputClass =
  "w-full rounded-lg border border-emerald/30 bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-turquoise/60";
const btn =
  "rounded border border-emerald/30 px-2 py-1 text-xs text-foreground/70 transition hover:border-accent-spark/60 hover:text-foreground disabled:opacity-40";

interface Status {
  enabled: boolean;
  host: string;
  hasPin: boolean;
  tailscale: { installed: boolean; running: boolean; dnsName: string; serving: boolean };
}

/** Acceso privado desde el celular con Tailscale: dirección, HTTPS, PIN y activación. */
export default function RemoteSettings() {
  const [st, setSt] = useState<Status | null>(null);
  const [hidden, setHidden] = useState(false);
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const call = useCallback(async (body?: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch("/api/remote/config", {
        method: body ? "PUT" : "GET",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
      if (res.status === 403) {
        setHidden(true); // abierto desde el celular: estos ajustes solo existen en el PC
        return;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg(data?.error ?? "No se pudo completar.");
        return;
      }
      setSt(data as Status);
      setMsg(typeof data?.message === "string" && data.message ? data.message : null);
    } catch {
      setMsg("No se pudo completar.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial del estado
    void call();
  }, [call]);

  if (hidden || !st) return null;
  const ts = st.tailscale;
  const url = st.host ? `https://${st.host}` : "";

  return (
    <div className="space-y-3 border-t border-emerald/15 pt-4">
      <div>
        <p className="text-sm text-foreground/90">Usar Jarvis en el celular (privado)</p>
        <p className="text-xs text-foreground/40">
          Con Tailscale solo tus dispositivos pueden abrirlo, nada queda público. El PC debe estar encendido
          con Jarvis abierto.
        </p>
      </div>

      <ol className="space-y-1 text-xs text-foreground/60">
        <li>
          1. Tailscale en el PC:{" "}
          {!ts.installed ? "no instalado (tailscale.com/download)" : ts.running ? "conectado ✓" : "instalado, falta iniciar sesión"}
        </li>
        <li>
          2. Dirección de este PC: {st.host || ts.dnsName || "—"}
          {ts.dnsName && st.host !== ts.dnsName && (
            <button type="button" className={`${btn} ml-2`} disabled={busy} onClick={() => call({ host: ts.dnsName })}>
              Usar esta
            </button>
          )}
        </li>
        <li>
          3. Publicar con HTTPS (necesario para el micrófono): {ts.serving ? "activo ✓" : "pendiente"}
          <button
            type="button"
            className={`${btn} ml-2`}
            disabled={busy || !ts.running}
            onClick={() => call({ action: ts.serving ? "serve-off" : "serve-on" })}
          >
            {ts.serving ? "Quitar" : "Publicar"}
          </button>
        </li>
        <li>
          4. PIN de acceso {st.hasPin ? "(definido ✓)" : "(sin definir)"}
          <div className="mt-1 flex gap-2">
            <input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Mínimo 6 caracteres"
              aria-label="Nuevo PIN"
              autoComplete="new-password"
              className={inputClass}
            />
            <button
              type="button"
              className={btn}
              disabled={busy || pin.length < 6}
              onClick={async () => {
                await call({ pin });
                setPin("");
              }}
            >
              Guardar
            </button>
          </div>
        </li>
      </ol>

      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-foreground/90">Permitir el acceso desde el celular</p>
          {url && st.enabled && <p className="break-all text-xs text-turquoise/80">{url}</p>}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={st.enabled}
          aria-label="Permitir el acceso desde el celular"
          disabled={busy}
          onClick={() => call({ enabled: !st.enabled })}
          className={`relative h-6 w-11 shrink-0 rounded-full border transition ${
            st.enabled ? "border-accent-spark/70 bg-emerald/40" : "border-emerald/30 bg-background"
          }`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-core transition-all ${st.enabled ? "left-6" : "left-0.5"}`}
          />
        </button>
      </div>

      {st.enabled && (
        <button type="button" className={btn} disabled={busy} onClick={() => call({ action: "revoke" })}>
          Cerrar las sesiones del celular
        </button>
      )}
      {msg && <p role="status" className="text-xs text-foreground/60">{msg}</p>}
    </div>
  );
}
