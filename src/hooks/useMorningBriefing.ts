"use client";

import { useEffect, useRef } from "react";
import { runAssistantAction } from "@/lib/actions";

const KEY = "jarvis.lastBriefingDay";
const DELAY_MS = 2500;

/** Fecha local del navegador (AAAA-MM-DD). La guardamos en localStorage: es un detalle del
 *  dispositivo y evita una ruta de servidor nueva; si se borra, solo se repite el resumen. */
const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function readLast(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/**
 * Con "Resumen al abrir" activo, la primera vez que se abre Jarvis cada día antes de las
 * 12:00 pide el resumen y se lo pasa al cerebro (`deliver`) para que lo redacte y lo diga.
 * No actúa si el usuario ya interactuó o Jarvis está ocupado.
 */
export function useMorningBriefing(enabled: boolean, busy: boolean, deliver: (followUp: string) => void) {
  const busyRef = useRef(busy);
  const deliverRef = useRef(deliver);
  const interacted = useRef(false);
  useEffect(() => {
    busyRef.current = busy;
    deliverRef.current = deliver;
  });

  useEffect(() => {
    const mark = () => {
      interacted.current = true;
    };
    window.addEventListener("pointerdown", mark);
    window.addEventListener("keydown", mark);
    return () => {
      window.removeEventListener("pointerdown", mark);
      window.removeEventListener("keydown", mark);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const now = new Date();
    if (now.getHours() >= 12 || readLast() === localDay(now)) return;
    const t = window.setTimeout(async () => {
      if (interacted.current || busyRef.current) return;
      try {
        window.localStorage.setItem(KEY, localDay(new Date()));
      } catch {
        // Sin almacenamiento: se intentará de nuevo en la próxima carga.
      }
      try {
        const out = await runAssistantAction({ type: "daily_briefing" });
        if (out.followUp && !interacted.current && !busyRef.current) deliverRef.current(out.followUp);
      } catch {
        // El resumen es opcional: si falla no se molesta al usuario.
      }
    }, DELAY_MS);
    return () => window.clearTimeout(t);
  }, [enabled]);
}
