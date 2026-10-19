"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { describeAction, runAssistantAction, type AssistantAction } from "@/lib/actions";

interface ActionCardProps {
  action: AssistantAction;
  /** Firma de la propuesta (la exige el servidor para acciones que piden confirmación). */
  token?: string;
  /** Se llama tras ejecutar la acción con éxito. */
  onDone: (outcome?: { followUp?: string; message?: string }) => void;
}

export default function ActionCard({ action, token, onDone }: ActionCardProps) {
  const { title, detail } = describeAction(action);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await runAssistantAction(action, token);
      onDone(out);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo ejecutar la acción.");
      setBusy(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="w-full max-w-sm rounded-xl border border-emerald/30 bg-panel p-4 shadow-[0_0_30px_-10px_rgba(31,224,160,0.4)]"
    >
      <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-widest text-turquoise">
        {title}
      </p>
      <p className="mt-2 text-sm text-foreground/80">{detail}</p>
      {error && <p className="mt-2 text-xs text-accent-spark/80">{error}</p>}
      <button
        onClick={confirm}
        disabled={busy}
        className="mt-3 w-full rounded-lg bg-emerald/90 px-4 py-2 text-sm font-medium text-background transition hover:bg-emerald disabled:opacity-40"
      >
        Confirmar y abrir
      </button>
    </motion.div>
  );
}
