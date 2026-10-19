"use client";

interface Props {
  streamingVoice: boolean;
  onChange: (v: boolean) => void;
}

/** Interruptor «Voz en tiempo real»: Jarvis empieza a hablar mientras termina de pensar. */
export default function StreamingVoiceSettings({ streamingVoice, onChange }: Props) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm text-foreground/90">Voz en tiempo real</p>
        <p className="text-xs text-foreground/40">
          Jarvis empieza a hablar frase por frase mientras todavía piensa la respuesta. Gasta algunas
          llamadas de voz más por respuesta.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={streamingVoice}
        aria-label="Voz en tiempo real"
        onClick={() => onChange(!streamingVoice)}
        className={`relative h-6 w-11 shrink-0 rounded-full border transition ${
          streamingVoice ? "border-accent-spark/70 bg-emerald/40" : "border-emerald/30 bg-background"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-core transition-all ${
            streamingVoice ? "left-6" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}
