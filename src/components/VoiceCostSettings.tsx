"use client";

import { useCallback, useEffect, useState } from "react";

// Precios de la lista pública de OpenRouter (/models?output_modalities=speech). Los de Gemini se
// cobran por tokens de audio (~25 tok/s de habla): el "≈" es una estimación por carácter.
export const VOICE_PRESETS: {
  label: string;
  model: string;
  voice: string;
  price: string;
  spanish: string;
}[] = [
  {
    label: "Calidad actual (ElevenLabs flash · George)",
    model: "elevenlabs/eleven-flash-v2.5",
    voice: "george",
    price: "$40 por millón de caracteres",
    spanish: "español nativo (32 idiomas)",
  },
  {
    label: "Muy barata (Kokoro 82M · Alex)",
    model: "hexgrad/kokoro-82m",
    voice: "em_alex",
    price: "$0,62 por millón (65 veces más barata)",
    spanish: "español incluido, calidad más sencilla",
  },
  {
    label: "Rápida y barata (Gemini 3.8 Flash Lite TTS)",
    model: "google/gemini-3.8-flash-lite-tts",
    voice: "Kore",
    price: "≈ $10 por millón (por tokens de audio)",
    spanish: "español nativo",
  },
  {
    label: "Expresiva (Gemini 3.8 Flash TTS)",
    model: "google/gemini-3.8-flash-tts",
    voice: "Kore",
    price: "≈ $15 por millón (por tokens de audio)",
    spanish: "español nativo",
  },
  {
    label: "Deepgram Aura 2 · Álvaro",
    model: "deepgram/aura-2",
    voice: "alvaro-es",
    price: "$30 por millón de caracteres",
    spanish: "español nativo",
  },
];

interface Props {
  ttsModel: string;
  ttsVoice: string;
  /** Aplica el preset al formulario de Ajustes; se guarda al pulsar Guardar. */
  onPick: (model: string, voice: string) => void;
}

const labelClass =
  "mb-1 block font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-widest text-emerald/70";

const fmtBytes = (b: number) => (b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`);

/** Voz más barata: presets de voz con precio e idioma, interruptor de la caché de audio y botón para vaciarla. */
export default function VoiceCostSettings({ ttsModel, ttsVoice, onPick }: Props) {
  const [cacheOn, setCacheOn] = useState(true);
  const [stats, setStats] = useState<{ files: number; bytes: number } | null>(null);
  const [note, setNote] = useState("");

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch("/api/speak/cache", { cache: "no-store" });
      const d = await res.json();
      if (res.ok) setStats({ files: d.files, bytes: d.bytes });
    } catch {}
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadStats();
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((s) => typeof s.ttsCache === "boolean" && setCacheOn(s.ttsCache))
      .catch(() => undefined);
  }, [loadStats]);

  async function toggle() {
    const next = !cacheOn;
    setCacheOn(next);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ttsCache: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setCacheOn(!next);
      setNote("No se pudo cambiar el ajuste.");
    }
  }

  async function clear() {
    try {
      const res = await fetch("/api/speak/cache", { method: "DELETE", headers: { "Content-Type": "application/json" } });
      const d = await res.json();
      if (!res.ok) throw new Error();
      setStats({ files: d.files, bytes: d.bytes });
      setNote(`Caché vaciada (${d.removed} frases).`);
    } catch {
      setNote("No se pudo vaciar la caché.");
    }
  }

  const current = VOICE_PRESETS.findIndex((p) => p.model === ttsModel && p.voice === ttsVoice);

  return (
    <div className="space-y-3">
      <div>
        <label className={labelClass} htmlFor="s-voice-preset">
          Voz: precio y calidad
        </label>
        <select
          id="s-voice-preset"
          value={current >= 0 ? String(current) : ""}
          onChange={(e) => {
            const p = VOICE_PRESETS[Number(e.target.value)];
            if (p) onPick(p.model, p.voice);
          }}
          className="w-full rounded-lg border border-emerald/30 bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-turquoise/60"
        >
          {current < 0 && <option value="">Personalizada (ver abajo)</option>}
          {VOICE_PRESETS.map((p, i) => (
            <option key={p.model + p.voice} value={i}>
              {p.label}
            </option>
          ))}
        </select>
        {current >= 0 && (
          <p className="mt-1 text-xs text-foreground/40">
            {VOICE_PRESETS[current].price} · {VOICE_PRESETS[current].spanish}. Se aplica al pulsar Guardar.
          </p>
        )}
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-foreground/90">Caché de voz</p>
          <p className="text-xs text-foreground/40">
            Guarda el audio de las frases cortas para no pagar dos veces por la misma.
            {stats ? ` Ahora: ${stats.files} frases, ${fmtBytes(stats.bytes)}.` : ""}
          </p>
          <button
            type="button"
            onClick={clear}
            className="mt-1 text-xs text-accent-spark underline-offset-2 hover:underline"
          >
            Vaciar caché de voz
          </button>
          {note && <p className="mt-1 text-xs text-foreground/50">{note}</p>}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={cacheOn}
          aria-label="Caché de voz"
          onClick={toggle}
          className={`relative h-6 w-11 shrink-0 rounded-full border transition ${
            cacheOn ? "border-accent-spark/70 bg-emerald/40" : "border-emerald/30 bg-background"
          }`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-core transition-all ${
              cacheOn ? "left-6" : "left-0.5"
            }`}
          />
        </button>
      </div>
    </div>
  );
}
