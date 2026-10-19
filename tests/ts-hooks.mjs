// Hooks de resolución para importar módulos .ts de src/ desde Node (type-stripping) tal como los
// escribe Next: sin extensión y con el alias "@/". Se registran con tests/ts-register.mjs.
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const hasExt = /\.(?:ts|tsx|js|mjs|cjs|json|node)$/;

export async function resolve(specifier, context, nextResolve) {
  let spec = specifier;
  if (spec.startsWith("@/")) spec = pathToFileURL(path.join(src, spec.slice(2))).href;
  try {
    return await nextResolve(spec, context);
  } catch (err) {
    const local = spec.startsWith(".") || spec.startsWith("file:");
    const retry = err?.code === "ERR_MODULE_NOT_FOUND" || err?.code === "ERR_UNSUPPORTED_DIR_IMPORT";
    if (!retry || !local || hasExt.test(spec)) throw err;
    for (const suffix of [".ts", "/index.ts"]) {
      try {
        return await nextResolve(spec + suffix, context);
      } catch {}
    }
    throw err;
  }
}
