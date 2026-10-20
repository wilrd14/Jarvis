/**
 * Motor de documentos de Jarvis: convierte un `DocumentSpec` (JSON estructurado) en archivos.
 *
 * SOLO SERVIDOR. No lo importes desde componentes de cliente; desde una acción usa el patrón
 *   `if (typeof window !== "undefined") return SERVER_ONLY; const { renderDocument } = await import("@/lib/docs");`
 * (los módulos puros `schema.ts` e `inline.ts` sí se pueden usar en cualquier sitio).
 *
 * Piezas:
 *  - schema.ts          tipos, `validateDocumentSpec` (nunca lanza), `markdownToSpec`, `specToMarkdown`.
 *  - inline.ts          **negrita**, *cursiva*, `código`, [txt](http/https) (puro).
 *  - render/*.server.ts un renderizador por formato: `(spec, opts) => Promise<Buffer>`.
 *  - output.server.ts   carpeta <Documentos>\Jarvis, nombre saneado, nunca sobrescribe, escritura atómica,
 *                       `revealInFolder`.
 *
 * Cómo añadir un formato nuevo (p. ej. "rtf"):
 *  1. Crea `render/rtf.server.ts` exportando `async function renderRtf(spec: DocumentSpec, opts?: RenderOpts): Promise<Buffer>`.
 *     Escapa SIEMPRE el texto del usuario y recorre los bloques con `switch (b.type)` (el compilador
 *     avisa de los tipos que falten). Usa `parseInline` para el inline y solo los `href` que ya trae (http/https).
 *  2. Añade el id a `DOC_FORMATS` y una entrada en `FORMATS` (extensión fija, mime, `load` con `import()` dinámico
 *     para que la librería pesada solo se cargue al usarla).
 *  3. Si necesita una librería npm: elige una mantenida, revisa `npm audit --omit=dev` y añade su prueba en
 *     `tests/docs.mjs` (que el archivo se abra/descomprima de verdad, que el texto esté y que no haya inyección).
 *  La extensión la decide el formato, nunca el usuario; el tope de 25 MB y los nombres únicos los aplica `saveDocument`.
 */
import path from "node:path";
import { validateDocumentSpec, type DocumentSpec } from "./schema";
import { saveDocument, revealInFolder, docsDir, sanitizeFileName } from "./output.server";
import type { RenderOpts } from "./render/types";

export * from "./schema";
export { revealInFolder, docsDir, sanitizeFileName };
export type { RenderOpts };

export const DOC_FORMATS = ["md", "txt", "html", "docx", "pdf", "xlsx", "pptx", "csv"] as const;
export type DocFormat = (typeof DOC_FORMATS)[number];

type Renderer = (spec: DocumentSpec, opts?: RenderOpts) => Promise<Buffer>;

const FORMATS: Record<DocFormat, { ext: string; mime: string; load: () => Promise<Renderer> }> = {
  md: { ext: ".md", mime: "text/markdown", load: async () => (await import("./render/text.server")).renderMd },
  txt: { ext: ".txt", mime: "text/plain", load: async () => (await import("./render/text.server")).renderTxt },
  csv: { ext: ".csv", mime: "text/csv", load: async () => (await import("./render/text.server")).renderCsv },
  html: { ext: ".html", mime: "text/html", load: async () => (await import("./render/html.server")).renderHtml },
  docx: {
    ext: ".docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    load: async () => (await import("./render/docx.server")).renderDocx,
  },
  pdf: { ext: ".pdf", mime: "application/pdf", load: async () => (await import("./render/pdf.server")).renderPdf },
  xlsx: {
    ext: ".xlsx",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    load: async () => (await import("./render/xlsx.server")).renderXlsx,
  },
  pptx: {
    ext: ".pptx",
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    load: async () => (await import("./render/pptx.server")).renderPptx,
  },
};

export function isDocFormat(v: unknown): v is DocFormat {
  return typeof v === "string" && Object.hasOwn(FORMATS, v);
}

export interface RenderedDocument {
  path: string;
  bytes: number;
  format: DocFormat;
}

/**
 * Valida el documento, lo renderiza y lo guarda en <Documentos>\Jarvis.
 * Lanza Error con mensaje en español si algo falla (documento no válido, sin navegador para PDF, >25 MB...).
 */
export async function renderDocument(spec: unknown, format: string, opts: RenderOpts = {}): Promise<RenderedDocument> {
  if (!isDocFormat(format)) throw new Error(`Formato no admitido: ${String(format).slice(0, 20)}. Usa ${DOC_FORMATS.join(", ")}.`);
  const v = validateDocumentSpec(spec);
  if (!v.ok) throw new Error(`Documento no válido: ${v.errors.slice(0, 5).join("; ")}`);
  const def = FORMATS[format];
  const render = await def.load();
  const data = await render(v.spec, opts);
  const saved = await saveDocument(opts.fileName ?? v.spec.title, def.ext, data);
  return { path: path.normalize(saved.path), bytes: saved.bytes, format };
}
