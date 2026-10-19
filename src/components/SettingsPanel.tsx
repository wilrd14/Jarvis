"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import BudgetSettings from "@/components/BudgetSettings";
import BriefingSettings from "./BriefingSettings";
import StreamingVoiceSettings from "./StreamingVoiceSettings";

// Lo que devuelve GET /api/settings (nunca incluye la key completa).
export interface PublicSettings {
  model: string;
  ttsModel: string;
  ttsVoice: string;
  sttModel: string;
  silenceMs: number;
  conversationMode: boolean;
  wakeWord: boolean;
  city: string;
  morningBriefing: boolean;
  streamingVoice: boolean;
  hasKey: boolean;
  keyLast4: string;
}

const BRAIN_MODELS = [
  "anthropic/claude-sonnet-5.5",
  "anthropic/claude-haiku-5.5",
  "anthropic/claude-opus-5.5",
];

const VOICES: { label: string; model: string; voice: string }[] = [
  {
    label: "ElevenLabs Flash · George",
    model: "elevenlabs/eleven-flash-v2.5",
    voice: "george",
  },
  {
    label: "ElevenLabs Flash · Sarah",
    model: "elevenlabs/eleven-flash-v2.5",
    voice: "sarah",
  },
  {
    label: "ElevenLabs Flash · Adam",
    model: "elevenlabs/eleven-flash-v2.5",
    voice: "adam",
  },
  {
    label: "Deepgram Aura 2 · Alvaro (español)",
    model: "deepgram/aura-2",
    voice: "alvaro-es",
  },
  {
    label: "Gemini 3.1 Flash TTS (preview)",
    model: "google/gemini-3.1-flash-tts-preview",
    voice: "",
  },
];

const CUSTOM = "__custom__";

const fieldClass =
  "w-full rounded-lg border border-emerald/30 bg-background px-3 py-2 text-sm text-foreground placeholder:text-foreground/40 outline-none focus:border-turquoise/60";
const labelClass =
  "mb-1 block font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-widest text-emerald/70";

function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition disabled:opacity-40 ${
        checked
          ? "border-accent-spark/70 bg-emerald/40"
          : "border-emerald/30 bg-background"
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-core transition-all ${
          checked ? "left-6" : "left-0.5"
        }`}
      />
    </button>
  );
}

interface Props {
  open: boolean;
  settings: PublicSettings | null;
  forced: boolean; // sin key: no se puede cerrar hasta guardar una
  onClose: () => void;
  onSaved: (s: PublicSettings) => void;
}

export default function SettingsPanel(props: Props) {
  const { open, settings } = props;
  return (
    <AnimatePresence>
      {open && settings && (
        <SettingsForm key="settings-form" {...props} settings={settings} />
      )}
    </AnimatePresence>
  );
}

function SettingsForm({
  settings,
  forced,
  onClose,
  onSaved,
}: Props & { settings: PublicSettings }) {
  // Se monta al abrir, así el formulario arranca con los valores actuales.
  const voiceIdx = VOICES.findIndex(
    (v) => v.model === settings.ttsModel && v.voice === settings.ttsVoice,
  );
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(settings.model);
  const [voiceChoice, setVoiceChoice] = useState(
    voiceIdx >= 0 ? String(voiceIdx) : CUSTOM,
  );
  const [customTts, setCustomTts] = useState({
    model: settings.ttsModel,
    voice: settings.ttsVoice,
  });
  const [silenceMs, setSilenceMs] = useState(settings.silenceMs);
  const [conversationMode, setConversationMode] = useState(
    settings.conversationMode,
  );
  const [city, setCity] = useState(settings.city);
  const [morningBriefing, setMorningBriefing] = useState(settings.morningBriefing);
  const [streamingVoice, setStreamingVoice] = useState(settings.streamingVoice ?? true);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  const modelSelect = BRAIN_MODELS.includes(model) ? model : CUSTOM;

  async function test() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const data = await res.json();
      setMsg(
        data.ok
          ? { kind: "ok", text: "La key funciona." }
          : { kind: "err", text: data.error ?? "No se pudo verificar la key." },
      );
    } catch {
      setMsg({ kind: "err", text: "No se pudo verificar la key." });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    const tts =
      voiceChoice === CUSTOM
        ? customTts
        : {
            model: VOICES[Number(voiceChoice)].model,
            voice: VOICES[Number(voiceChoice)].voice,
          };
    const body: Record<string, unknown> = {
      model: model.trim(),
      ttsModel: tts.model.trim(),
      ttsVoice: tts.voice.trim(),
      silenceMs,
      conversationMode,
      city,
      morningBriefing,
      streamingVoice,
    };
    if (apiKey.trim()) body.openrouterApiKey = apiKey.trim();
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "No se pudo guardar.");
      onSaved(data as PublicSettings);
      setApiKey("");
      setMsg({ kind: "ok", text: "Ajustes guardados." });
      if ((data as PublicSettings).hasKey) window.setTimeout(onClose, 600);
    } catch (err) {
      setMsg({
        kind: "err",
        text: err instanceof Error ? err.message : "No se pudo guardar.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      onClick={() => !forced && onClose()}
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        role="dialog"
        aria-label="Ajustes"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-turquoise/40 bg-panel p-6 shadow-[0_0_40px_rgba(31,224,160,0.15)]"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-[family-name:var(--font-heading)] text-lg tracking-wide text-core">
            Ajustes
          </h2>
          {!forced && (
            <button
              onClick={onClose}
              aria-label="Cerrar"
              className="text-foreground/50 transition hover:text-core"
            >
              ✕
            </button>
          )}
        </div>

        {!settings.hasKey && (
          <p className="mb-4 rounded-lg border border-accent-spark/40 bg-accent-spark/10 px-3 py-2 text-sm text-accent-spark">
            Para empezar necesito tu API key de OpenRouter. Pégala abajo, pulsa
            Probar y luego Guardar.
          </p>
        )}

        <div className="space-y-4">
          <div>
            <label className={labelClass} htmlFor="s-key">
              API key de OpenRouter
            </label>
            <div className="flex gap-2">
              <input
                id="s-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  settings.hasKey
                    ? `Guardada · termina en ${settings.keyLast4}`
                    : "sk-or-..."
                }
                className={fieldClass}
              />
              <button
                type="button"
                onClick={test}
                disabled={busy || (!apiKey.trim() && !settings.hasKey)}
                className="rounded-lg border border-turquoise/50 px-3 text-sm text-core transition hover:bg-turquoise/10 disabled:opacity-40"
              >
                Probar
              </button>
            </div>
          </div>

          <div>
            <label className={labelClass} htmlFor="s-model">
              Modelo del cerebro
            </label>
            <select
              id="s-model"
              value={modelSelect}
              onChange={(e) =>
                e.target.value !== CUSTOM && setModel(e.target.value)
              }
              className={fieldClass}
            >
              {BRAIN_MODELS.map((m) => (
                <option key={m} value={m}>
                  {m.replace("anthropic/", "")}
                </option>
              ))}
              <option value={CUSTOM}>Otro (escribir)…</option>
            </select>
            {modelSelect === CUSTOM && (
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="proveedor/modelo"
                className={`${fieldClass} mt-2`}
              />
            )}
          </div>

          <div>
            <label className={labelClass} htmlFor="s-voice">
              Voz
            </label>
            <select
              id="s-voice"
              value={voiceChoice}
              onChange={(e) => setVoiceChoice(e.target.value)}
              className={fieldClass}
            >
              {VOICES.map((v, i) => (
                <option key={v.label} value={i}>
                  {v.label}
                </option>
              ))}
              <option value={CUSTOM}>Otra (escribir)…</option>
            </select>
            {voiceChoice === CUSTOM && (
              <div className="mt-2 flex gap-2">
                <input
                  value={customTts.model}
                  onChange={(e) =>
                    setCustomTts({ ...customTts, model: e.target.value })
                  }
                  placeholder="modelo TTS"
                  className={fieldClass}
                />
                <input
                  value={customTts.voice}
                  onChange={(e) =>
                    setCustomTts({ ...customTts, voice: e.target.value })
                  }
                  placeholder="voz"
                  className={fieldClass}
                />
              </div>
            )}
          </div>

          <div>
            <label className={labelClass} htmlFor="s-silence">
              Silencio para dejar de escuchar: {(silenceMs / 1000).toFixed(1)} s
            </label>
            <input
              id="s-silence"
              type="range"
              min={600}
              max={3000}
              step={100}
              value={silenceMs}
              onChange={(e) => setSilenceMs(Number(e.target.value))}
              className="w-full accent-emerald"
            />
            <p className="mt-1 text-xs text-foreground/40">
              Menos tiempo responde más rápido pero puede cortarte si haces
              pausas.
            </p>
          </div>

          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-foreground/90">Modo conversación</p>
              <p className="text-xs text-foreground/40">
                Al terminar de hablar Jarvis, el micrófono se reabre solo y se
                cierra tras 8 s sin voz.
              </p>
            </div>
            <Toggle
              checked={conversationMode}
              onChange={setConversationMode}
              label="Modo conversación"
            />
          </div>

          <StreamingVoiceSettings streamingVoice={streamingVoice} onChange={setStreamingVoice} />
          <BudgetSettings />
          <BriefingSettings city={city} morningBriefing={morningBriefing} onCity={setCity} onMorningBriefing={setMorningBriefing} />

          <div className="flex items-start justify-between gap-4 opacity-60">
            <div>
              <p className="text-sm text-foreground/90">
                Palabra de activación «Jarvis»{" "}
                <span className="text-[10px] uppercase tracking-widest text-accent-spark">
                  experimental
                </span>
              </p>
              <p className="text-xs text-foreground/40">
                No disponible todavía: requiere un detector de palabra clave
                fiable que funcione también en la app de escritorio.
              </p>
            </div>
            <Toggle
              checked={false}
              onChange={() => {}}
              disabled
              label="Palabra de activación"
            />
          </div>
        </div>

        {msg && (
          <p
            className={`mt-4 text-sm ${msg.kind === "ok" ? "text-emerald" : "text-accent-spark/90"}`}
          >
            {msg.text}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          {!forced && (
            <button
              onClick={onClose}
              className="rounded-lg border border-emerald/30 px-4 py-2 text-sm text-foreground/70 transition hover:text-core"
            >
              Cerrar
            </button>
          )}
          <button
            onClick={save}
            disabled={busy || (!settings.hasKey && !apiKey.trim())}
            className="rounded-lg bg-emerald/90 px-4 py-2 text-sm font-medium text-background transition hover:bg-emerald disabled:opacity-40"
          >
            Guardar
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
