import { promises as fs } from "fs";
import path from "path";

/** Carpeta de datos locales; configurable con JARVIS_DATA_DIR. Solo servidor. */
export function dataDir(): string {
  return process.env.JARVIS_DATA_DIR ?? path.join(process.cwd(), ".jarvis-data");
}

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
      try {
        const parsed: unknown = JSON.parse(await fs.readFile(full, "utf8"));
        if (Array.isArray(parsed)) {
          items = parsed.map(sanitize).filter((x): x is T => x !== null);
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT" && !(e instanceof SyntaxError)) throw e;
      }
      const before = JSON.stringify(items);
      const result = mutate(items);
      if (JSON.stringify(items) !== before) {
        await fs.mkdir(dataDir(), { recursive: true });
        const tmp = `${full}.${process.pid}.${Date.now()}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(items, null, 2), "utf8");
        await fs.rename(tmp, full);
      }
      return result;
    });
  queues.set(file, next);
  return next;
}
