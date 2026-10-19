"use client";

interface Props {
  city: string;
  morningBriefing: boolean;
  onCity: (v: string) => void;
  onMorningBriefing: (v: boolean) => void;
}

/** Ajustes del resumen del día: ciudad del clima e interruptor "Resumen al abrir". */
export default function BriefingSettings({ city, morningBriefing, onCity, onMorningBriefing }: Props) {
  return (
    <>
      <div>
        <label
          htmlFor="s-city"
          className="mb-1 block font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-widest text-emerald/70"
        >
          Ciudad para el clima
        </label>
        <input
          id="s-city"
          value={city}
          maxLength={80}
          onChange={(e) => onCity(e.target.value)}
          placeholder="Buenos Aires"
          className="w-full rounded-lg border border-emerald/30 bg-background px-3 py-2 text-sm text-foreground placeholder:text-foreground/40 outline-none focus:border-turquoise/60"
        />
      </div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-foreground/90">Resumen al abrir</p>
          <p className="text-xs text-foreground/40">
            La primera vez que abras Jarvis cada día antes de las 12:00, te saluda con el resumen del día.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={morningBriefing}
          aria-label="Resumen al abrir"
          onClick={() => onMorningBriefing(!morningBriefing)}
          className={`relative h-6 w-11 shrink-0 rounded-full border transition ${
            morningBriefing ? "border-accent-spark/70 bg-emerald/40" : "border-emerald/30 bg-background"
          }`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-core transition-all ${
              morningBriefing ? "left-6" : "left-0.5"
            }`}
          />
        </button>
      </div>
    </>
  );
}
