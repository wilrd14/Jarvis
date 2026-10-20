/**
 * Esquema del documento estructurado + validador estricto + conversión Markdown <-> spec.
 * Módulo puro (sin Node, sin E/S): nunca ejecuta nada y `validateDocumentSpec` NUNCA lanza.
 */
import { inlineToPlain } from "./inline";

export const LIMITS = {
  title: 200,
  meta: 200, // subtitle / author / date
  blocks: 400,
  totalText: 120_000,
  columns: 50,
  rows: 2000,
  listItems: 500,
  subItems: 200,
  maxErrors: 20,
} as const;

export type ListItem = string | { text: string; items: string[] };

export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: ListItem[] }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "quote"; text: string }
  | { type: "code"; text: string; language?: string }
  | { type: "pagebreak" };

export interface DocumentSpec {
  title: string;
  subtitle?: string;
  author?: string;
  date?: string;
  language?: "es";
  blocks: Block[];
}

export type ValidationResult = { ok: true; spec: DocumentSpec } | { ok: false; errors: string[] };

// ---------- normalización ----------

// Controles C0/C1 (salvo \n, \r, \t que se tratan aparte), marcas bidi/invisibles peligrosas,
// BOM, no-caracteres y sustitutos sueltos (rompen XML). Se conserva U+200D (emojis compuestos).
// Se construye con códigos numéricos para que el fuente no contenga caracteres invisibles.
const ch = (n: number) => String.fromCharCode(n);
const range = (a: number, b = a) => (a === b ? ch(a) : `${ch(a)}-${ch(b)}`);
const BAD_CLASS = [
  [0x00, 0x08], [0x0b, 0x0c], [0x0e, 0x1f], [0x7f, 0x9f], [0x200b], [0x200e, 0x200f], [0x202a, 0x202e],
  [0x2066, 0x2069], [0xfeff], [0xfffe, 0xffff],
]
  .map(([a, b]) => range(a, b))
  .join("");
const BAD_CHARS = new RegExp(
  `[${BAD_CLASS}]|[${range(0xd800, 0xdbff)}](?![${range(0xdc00, 0xdfff)}])|(?<![${range(0xd800, 0xdbff)}])[${range(0xdc00, 0xdfff)}]`,
  "g",
);
const LINE_BREAKS = new RegExp(`\r\n?|${ch(0x2028)}|${ch(0x2029)}|${ch(0x85)}`, "g");

function normalizeText(s: string, multiline: boolean, keepTabs = false): string {
  let t = s.replace(LINE_BREAKS, "\n").replace(BAD_CHARS, "");
  t = t.replace(/\t/g, keepTabs ? "    " : " ");
  if (!multiline) return t.replace(/\s*\n\s*/g, " ").trim();
  t = t
    .split("\n")
    .map((l) => (keepTabs ? l.replace(/\s+$/, "") : l.trim()))
    .join("\n");
  t = keepTabs ? t.replace(/^\n+|\n+$/g, "") : t.replace(/\n{3,}/g, "\n\n").trim();
  return t;
}

class Ctx {
  errors: string[] = [];
  total = 0;
  err(msg: string): void {
    if (this.errors.length < LIMITS.maxErrors) this.errors.push(msg);
  }
  /** Lee un texto: comprueba tipo y tamaño ANTES de normalizar. */
  str(
    v: unknown,
    path: string,
    o: { max: number; multiline?: boolean; required?: boolean; keepTabs?: boolean },
  ): string | undefined {
    if (v === undefined || v === null) {
      if (o.required) this.err(`${path}: es obligatorio`);
      return undefined;
    }
    if (typeof v !== "string") {
      this.err(`${path}: debe ser texto`);
      return undefined;
    }
    if (v.length > 1_000_000) {
      this.err(`${path}: demasiado largo (${v.length} caracteres, máximo ${o.max})`);
      return undefined;
    }
    const t = normalizeText(v, !!o.multiline, o.keepTabs);
    if (t.length > o.max) {
      this.err(`${path}: demasiado largo (${t.length} caracteres, máximo ${o.max})`);
      return undefined;
    }
    if (o.required && !t) {
      this.err(`${path}: no puede estar vacío`);
      return undefined;
    }
    this.total += t.length;
    return t;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function noExtraKeys(o: Record<string, unknown>, allowed: string[], path: string, ctx: Ctx): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) ctx.err(`${path}: campo desconocido "${k.slice(0, 40)}"`);
}

function strArray(v: unknown, path: string, ctx: Ctx, max: number, o: { max: number; required?: boolean }): string[] | undefined {
  if (!Array.isArray(v)) {
    ctx.err(`${path}: debe ser una lista`);
    return undefined;
  }
  if (v.length > max) {
    ctx.err(`${path}: demasiados elementos (${v.length}, máximo ${max})`);
    return undefined;
  }
  const out: string[] = [];
  let bad = false;
  v.forEach((x, i) => {
    const s = ctx.str(x, `${path}[${i}]`, { max: o.max, required: o.required ?? false });
    if (s === undefined) bad = true;
    else out.push(s);
  });
  return bad ? undefined : out;
}

const TEXT_MAX = LIMITS.totalText;

function validateBlock(b: unknown, i: number, ctx: Ctx): Block | undefined {
  const p = `blocks[${i}]`;
  if (!isPlainObject(b)) {
    ctx.err(`${p}: debe ser un objeto`);
    return undefined;
  }
  const type = b.type;
  switch (type) {
    case "heading": {
      noExtraKeys(b, ["type", "level", "text"], p, ctx);
      const level = b.level;
      if (level !== 1 && level !== 2 && level !== 3 && level !== 4) {
        ctx.err(`${p}.level: debe ser 1, 2, 3 o 4`);
        return undefined;
      }
      const text = ctx.str(b.text, `${p}.text`, { max: 500, required: true });
      return text === undefined ? undefined : { type, level, text };
    }
    case "paragraph":
    case "quote": {
      noExtraKeys(b, ["type", "text"], p, ctx);
      const text = ctx.str(b.text, `${p}.text`, { max: TEXT_MAX, multiline: true, required: true });
      return text === undefined ? undefined : { type, text };
    }
    case "list": {
      noExtraKeys(b, ["type", "ordered", "items"], p, ctx);
      if (typeof b.ordered !== "boolean") {
        ctx.err(`${p}.ordered: debe ser true o false`);
        return undefined;
      }
      if (!Array.isArray(b.items) || b.items.length < 1) {
        ctx.err(`${p}.items: debe ser una lista con al menos un elemento`);
        return undefined;
      }
      if (b.items.length > LIMITS.listItems) {
        ctx.err(`${p}.items: demasiados elementos (máximo ${LIMITS.listItems})`);
        return undefined;
      }
      const items: ListItem[] = [];
      let bad = false;
      b.items.forEach((it, j) => {
        const ip = `${p}.items[${j}]`;
        if (typeof it === "string") {
          const s = ctx.str(it, ip, { max: 5000, required: true });
          if (s === undefined) bad = true;
          else items.push(s);
        } else if (isPlainObject(it)) {
          noExtraKeys(it, ["text", "items"], ip, ctx);
          const text = ctx.str(it.text, `${ip}.text`, { max: 5000, required: true });
          const sub = it.items === undefined ? [] : strArray(it.items, `${ip}.items`, ctx, LIMITS.subItems, { max: 5000, required: true });
          if (text === undefined || sub === undefined) bad = true;
          else items.push(sub.length ? { text, items: sub } : text);
        } else {
          ctx.err(`${ip}: debe ser texto u objeto {text, items}`);
          bad = true;
        }
      });
      return bad ? undefined : { type, ordered: b.ordered, items };
    }
    case "table": {
      noExtraKeys(b, ["type", "header", "rows"], p, ctx);
      const header = strArray(b.header, `${p}.header`, ctx, LIMITS.columns, { max: 1000 });
      if (header && header.length < 1) {
        ctx.err(`${p}.header: necesita al menos una columna`);
        return undefined;
      }
      if (!Array.isArray(b.rows)) {
        ctx.err(`${p}.rows: debe ser una lista de filas`);
        return undefined;
      }
      if (b.rows.length > LIMITS.rows) {
        ctx.err(`${p}.rows: demasiadas filas (${b.rows.length}, máximo ${LIMITS.rows})`);
        return undefined;
      }
      if (!header) return undefined;
      const rows: string[][] = [];
      let bad = false;
      b.rows.forEach((r, j) => {
        const row = strArray(r, `${p}.rows[${j}]`, ctx, LIMITS.columns, { max: 5000 });
        if (!row) {
          bad = true;
          return;
        }
        if (row.length > header.length) {
          ctx.err(`${p}.rows[${j}]: tiene más celdas (${row.length}) que columnas (${header.length})`);
          bad = true;
          return;
        }
        while (row.length < header.length) row.push("");
        rows.push(row);
      });
      return bad ? undefined : { type, header, rows };
    }
    case "code": {
      noExtraKeys(b, ["type", "text", "language"], p, ctx);
      const text = ctx.str(b.text, `${p}.text`, { max: TEXT_MAX, multiline: true, required: true, keepTabs: true });
      let language: string | undefined;
      if (b.language !== undefined && b.language !== null && b.language !== "") {
        if (typeof b.language !== "string" || !/^[A-Za-z0-9_+#.-]{1,30}$/.test(b.language)) {
          ctx.err(`${p}.language: nombre de lenguaje no válido`);
          return undefined;
        }
        language = b.language;
      }
      if (text === undefined) return undefined;
      return language ? { type, text, language } : { type, text };
    }
    case "pagebreak": {
      noExtraKeys(b, ["type"], p, ctx);
      return { type };
    }
    default:
      ctx.err(`${p}.type: tipo de bloque desconocido`);
      return undefined;
  }
}

/** Valida y normaliza. No lanza nunca. */
export function validateDocumentSpec(input: unknown): ValidationResult {
  try {
    const ctx = new Ctx();
    if (!isPlainObject(input)) return { ok: false, errors: ["El documento debe ser un objeto con title y blocks."] };
    noExtraKeys(input, ["title", "subtitle", "author", "date", "language", "blocks"], "documento", ctx);
    const title = ctx.str(input.title, "title", { max: LIMITS.title, required: true });
    const subtitle = ctx.str(input.subtitle, "subtitle", { max: LIMITS.meta });
    const author = ctx.str(input.author, "author", { max: LIMITS.meta });
    const date = ctx.str(input.date, "date", { max: LIMITS.meta });
    if (input.language !== undefined && input.language !== null && input.language !== "es") ctx.err('language: solo se admite "es"');
    const blocks: Block[] = [];
    if (!Array.isArray(input.blocks)) ctx.err("blocks: debe ser una lista de bloques");
    else if (input.blocks.length > LIMITS.blocks) {
      ctx.err(`blocks: demasiados bloques (${input.blocks.length}, máximo ${LIMITS.blocks})`);
    } else {
      for (let i = 0; i < input.blocks.length && ctx.errors.length < LIMITS.maxErrors; i++) {
        const blk = validateBlock(input.blocks[i], i, ctx);
        if (blk) blocks.push(blk);
        if (ctx.total > LIMITS.totalText) {
          ctx.err(`El documento supera ${LIMITS.totalText} caracteres de texto; divídelo en partes más pequeñas.`);
          break;
        }
      }
    }
    if (ctx.errors.length || title === undefined) return { ok: false, errors: ctx.errors.length ? ctx.errors : ["title: es obligatorio"] };
    const spec: DocumentSpec = { title, language: "es", blocks };
    if (subtitle) spec.subtitle = subtitle;
    if (author) spec.author = author;
    if (date) spec.date = date;
    return { ok: true, spec };
  } catch (e) {
    return { ok: false, errors: [`Documento no válido: ${e instanceof Error ? e.message.slice(0, 120) : "error desconocido"}`] };
  }
}

// ---------- Markdown -> spec ----------

const isBlank = (l: string) => /^\s*$/.test(l);
const FENCE = /^\s{0,3}(```+|~~~+)\s*([^\s`]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^(\s*)([-*+])\s+(.*)$/;
const ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const PAGEBREAK = /^\s*(<!--\s*pagebreak\s*-->|\\(newpage|pagebreak))\s*$/i;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (s[i] === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

/** Convierte Markdown razonable en un spec validado. El primer `# Título` pasa a ser el título. */
export function markdownToSpec(md: string, defaults: { title?: string; author?: string; date?: string } = {}): ValidationResult {
  try {
    if (typeof md !== "string") return { ok: false, errors: ["El Markdown debe ser texto."] };
    if (md.length > LIMITS.totalText * 2) return { ok: false, errors: ["El Markdown es demasiado largo."] };
    const lines = md.replace(/\r\n?/g, "\n").split("\n");
    const blocks: Block[] = [];
    let title = defaults.title;
    let i = 0;
    let para: string[] = [];
    const flushPara = () => {
      if (para.length) blocks.push({ type: "paragraph", text: para.join("\n") });
      para = [];
    };
    while (i < lines.length) {
      const line = lines[i];
      const fence = FENCE.exec(line);
      if (fence) {
        flushPara();
        const mark = fence[1];
        const body: string[] = [];
        i++;
        while (i < lines.length && !new RegExp(`^\\s{0,3}${mark[0]}{${mark.length},}\\s*$`).test(lines[i])) body.push(lines[i++]);
        i++;
        const language = fence[2] && /^[A-Za-z0-9_+#.-]{1,30}$/.test(fence[2]) ? fence[2] : undefined;
        if (body.join("").trim()) blocks.push(language ? { type: "code", text: body.join("\n"), language } : { type: "code", text: body.join("\n") });
        continue;
      }
      if (isBlank(line)) {
        flushPara();
        i++;
        continue;
      }
      if (PAGEBREAK.test(line)) {
        flushPara();
        blocks.push({ type: "pagebreak" });
        i++;
        continue;
      }
      const h = HEADING.exec(line);
      if (h) {
        flushPara();
        const lvl = h[1].length;
        if (lvl === 1 && !title && !blocks.length) title = h[2];
        else blocks.push({ type: "heading", level: Math.min(lvl, 4) as 1 | 2 | 3 | 4, text: h[2] || "-" });
        i++;
        continue;
      }
      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
        // Línea horizontal: no tiene equivalente; separa párrafos.
        flushPara();
        i++;
        continue;
      }
      if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes("-")) {
        flushPara();
        const header = splitRow(line).slice(0, LIMITS.columns);
        i += 2;
        const rows: string[][] = [];
        while (i < lines.length && !isBlank(lines[i]) && lines[i].includes("|")) {
          const r = splitRow(lines[i]).slice(0, header.length);
          while (r.length < header.length) r.push("");
          rows.push(r);
          i++;
        }
        blocks.push({ type: "table", header, rows });
        continue;
      }
      if (/^\s{0,3}>/.test(line)) {
        flushPara();
        const q: string[] = [];
        while (i < lines.length && /^\s{0,3}>/.test(lines[i])) q.push(lines[i++].replace(/^\s{0,3}>\s?/, ""));
        const text = q.join("\n").trim();
        if (text) blocks.push({ type: "quote", text });
        continue;
      }
      const lm = BULLET.exec(line) ?? ORDERED.exec(line);
      if (lm) {
        flushPara();
        const ordered = !BULLET.test(line);
        const baseIndent = lm[1].length;
        const items: ListItem[] = [];
        while (i < lines.length) {
          const m = BULLET.exec(lines[i]) ?? ORDERED.exec(lines[i]);
          if (!m) {
            // Continuación de la línea anterior (sangrada) en el último elemento.
            if (!isBlank(lines[i]) && /^\s{2,}\S/.test(lines[i]) && items.length) {
              const last = items[items.length - 1];
              if (typeof last === "string") items[items.length - 1] = `${last} ${lines[i].trim()}`;
              else last.text += ` ${lines[i].trim()}`;
              i++;
              continue;
            }
            break;
          }
          const isOrd = !BULLET.test(lines[i]);
          if (m[1].length > baseIndent + 1 && items.length) {
            const last = items[items.length - 1];
            const sub = m[3].trim();
            if (typeof last === "string") items[items.length - 1] = { text: last, items: [sub] };
            else last.items.push(sub);
          } else if (m[1].length <= baseIndent + 1 && isOrd === ordered) {
            items.push(m[3].trim());
          } else break;
          i++;
        }
        const clean = items.filter((it) => (typeof it === "string" ? it : it.text));
        if (clean.length) blocks.push({ type: "list", ordered, items: clean });
        continue;
      }
      para.push(line.trim());
      i++;
    }
    flushPara();
    const spec: Record<string, unknown> = { title: title || "Documento", blocks };
    if (defaults.author) spec.author = defaults.author;
    if (defaults.date) spec.date = defaults.date;
    return validateDocumentSpec(spec);
  } catch (e) {
    return { ok: false, errors: [`Markdown no válido: ${e instanceof Error ? e.message.slice(0, 120) : "error"}`] };
  }
}

// ---------- spec -> Markdown ----------

function escLineStart(text: string): string {
  return text
    .split("\n")
    .map((l) => (/^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|~~~|\|)/.test(l) ? `\\${l}` : l))
    .join("\n");
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

export function specToMarkdown(spec: DocumentSpec): string {
  const out: string[] = [`# ${spec.title}`];
  const meta = [spec.author, spec.date].filter(Boolean).join(" · ");
  if (spec.subtitle) out.push(`*${spec.subtitle}*`);
  if (meta) out.push(meta);
  for (const b of spec.blocks) {
    switch (b.type) {
      case "heading":
        out.push(`${"#".repeat(Math.min(6, b.level + 1))} ${b.text}`);
        break;
      case "paragraph":
        out.push(escLineStart(b.text));
        break;
      case "quote":
        out.push(b.text.split("\n").map((l) => `> ${l}`).join("\n"));
        break;
      case "code": {
        const fence = b.text.includes("```") ? "~~~~" : "```";
        out.push(`${fence}${b.language ?? ""}\n${b.text}\n${fence}`);
        break;
      }
      case "list": {
        const lines: string[] = [];
        b.items.forEach((it, n) => {
          const mark = b.ordered ? `${n + 1}.` : "-";
          if (typeof it === "string") lines.push(`${mark} ${it}`);
          else {
            lines.push(`${mark} ${it.text}`);
            for (const s of it.items) lines.push(`   ${b.ordered ? "-" : "-"} ${s}`);
          }
        });
        out.push(lines.join("\n"));
        break;
      }
      case "table":
        out.push(
          [
            `| ${b.header.map(cell).join(" | ")} |`,
            `| ${b.header.map(() => "---").join(" | ")} |`,
            ...b.rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
          ].join("\n"),
        );
        break;
      case "pagebreak":
        out.push("<!-- pagebreak -->");
        break;
    }
  }
  return out.join("\n\n") + "\n";
}

/** Todo el texto plano del documento (útil para contar o para vistas previas). */
export function specPlainText(spec: DocumentSpec): string {
  const parts: string[] = [spec.title];
  for (const b of spec.blocks) {
    if (b.type === "list") for (const it of b.items) parts.push(typeof it === "string" ? inlineToPlain(it) : [it.text, ...it.items].map(inlineToPlain).join("\n"));
    else if (b.type === "table") parts.push([b.header, ...b.rows].map((r) => r.map(inlineToPlain).join("\t")).join("\n"));
    else if (b.type !== "pagebreak") parts.push(b.type === "code" ? b.text : inlineToPlain(b.text));
  }
  return parts.join("\n");
}
