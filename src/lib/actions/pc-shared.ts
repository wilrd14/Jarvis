/** Utilidades compartidas (sin APIs de Node) de las acciones de control del PC. */

/**
 * Resultado si una acción de sistema se invoca en el navegador. Las `run` de
 * estas acciones protegen el `import()` con `typeof window === "undefined"`
 * para que el bundler elimine esa rama del bundle cliente (así child_process
 * y los scripts de sistema nunca llegan al navegador).
 */
export const SERVER_ONLY = { ok: false, message: "Esta acción solo se ejecuta en el servidor." } as const;

/** Minúsculas, sin acentos ni signos, espacios colapsados: para casar alias. */
export function normalizeAlias(v: unknown): string | undefined {
  if (typeof v !== "string" || v.length > 60) return undefined;
  const s = v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s || undefined;
}

/** Resuelve un alias (o el id exacto) a una clave de una tabla cerrada. */
export function resolveAlias<K extends string>(
  v: unknown,
  table: Readonly<Record<K, readonly string[]>>
): K | undefined {
  const n = normalizeAlias(v);
  if (!n) return undefined;
  for (const key of Object.keys(table) as K[]) {
    if (key === n || table[key].includes(n)) return key;
  }
  return undefined;
}
