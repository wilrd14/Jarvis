"use client";

import { useState } from "react";

/** Pantalla de PIN del acceso desde el celular (la única página que se ve sin sesión). */
export default function LoginPage() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!pin || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/remote/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "No se pudo iniciar la sesión.");
      window.location.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar la sesión.");
      setPin("");
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-1 items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-xs space-y-4 text-center">
        <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.4em] text-turquoise/80">
          Jarvis
        </p>
        <input
          type="password"
          inputMode="text"
          autoComplete="current-password"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="PIN de acceso"
          aria-label="PIN de acceso"
          className="w-full rounded-lg border border-emerald/30 bg-background px-3 py-3 text-center text-lg tracking-widest text-foreground outline-none focus:border-turquoise/60"
        />
        <button
          type="submit"
          disabled={busy || !pin}
          className="w-full rounded-lg border border-accent-spark/60 px-3 py-3 text-sm text-foreground transition hover:bg-emerald/20 disabled:opacity-40"
        >
          {busy ? "Entrando…" : "Entrar"}
        </button>
        {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      </form>
    </main>
  );
}
