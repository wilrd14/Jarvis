import { promises as fs } from "fs";
import path from "path";
// Una sola definición de la carpeta de datos (JARVIS_DATA_DIR) compartida con los ajustes.
import { dataDir } from "../settings";

// Cola por archivo: serializa lectura-modificación-escritura dentro del proceso.
const queues = new Map<string, Promise<unknown>>();

/**
 * Lee un JSON (array), lo valida con `sanitize` (descarta entradas inválidas),
 * deja que `mutate` lo modifique y, si cambió, lo escribe de forma atómica
 * (archivo temporal + rename).
 */
export function updateCollection<T, R>(
  file: string,
  sanitize: (raw: unknown) => T | null,
  mutate: (items: T[]) => R
): Promise<R> {
  const prev = queues.get(file) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined)
    .then(async () => {
      const full = path.join(dataDir(), file);
      let items: T[] = [];
      let unreadable = false;
      try {
        const parsed: unknown = JSON.parse(await fs.readFile(full, "utf8"));
        if (Array.isArray(parsed)) {
          items = parsed.map(sanitize).filter((x): x is T => x !== null);
        } else {
          unreadable = true;
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT" && !(e instanceof SyntaxError)) throw e;
        unreadable = e instanceof SyntaxError;
      }
      const before = JSON.stringify(items);
      const result = mutate(items);
      if (JSON.stringify(items) !== before) {
        await fs.mkdir(dataDir(), { recursive: true });
        // Si el archivo existente estaba corrupto, se guarda una copia antes de sobrescribirlo.
        if (unreadable) await fs.copyFile(full, `${full}.corrupto-${Date.now()}`).catch(() => undefined);
        const tmp = `${full}.${process.pid}.${Date.now()}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(items, null, 2), "utf8");
        await fs.rename(tmp, full);
      }
      return result;
    });
  queues.set(file, next);
  return next;
}
