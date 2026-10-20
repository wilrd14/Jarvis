/**
 * Inline mínimo de los textos del documento: **negrita**, *cursiva*, `código` y [texto](https://enlace).
 * Módulo puro (sin Node): no ejecuta ni carga nada. Los renderizadores convierten estos tramos al
 * formato de destino, escapando SIEMPRE el texto.
 */
export interface InlineRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  /** Solo http/https, ya validado. */
  href?: string;
}

/** Devuelve la URL normalizada si es http/https válida; si no, null. */
export function safeHttpUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s || s.length > 2000 || /[\s<>"`\\]/.test(s)) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname) return null;
    return u.href;
  } catch {
    return null;
  }
}

interface Fmt {
  bold?: boolean;
  italic?: boolean;
  href?: string;
}

const ESCAPABLE = "\\`*_[]()#+-.!|>~";

function push(out: InlineRun[], text: string, f: Fmt, code = false): void {
  if (!text) return;
  const last = out[out.length - 1];
  const same =
    last &&
    !!last.bold === !!f.bold &&
    !!last.italic === !!f.italic &&
    !!last.code === code &&
    last.href === f.href;
  if (same) last.text += text;
  else {
    const run: InlineRun = { text };
    if (f.bold) run.bold = true;
    if (f.italic) run.italic = true;
    if (code) run.code = true;
    if (f.href) run.href = f.href;
    out.push(run);
  }
}

function parse(s: string, f: Fmt, out: InlineRun[], depth: number): void {
  let buf = "";
  const flush = () => {
    push(out, buf, f);
    buf = "";
  };
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\" && i + 1 < s.length && ESCAPABLE.includes(s[i + 1])) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (ch === "`") {
      const end = s.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        push(out, s.slice(i + 1, end), f, true);
        i = end + 1;
        continue;
      }
    }
    if (depth < 4 && ch === "*" && s[i + 1] === "*") {
      const end = s.indexOf("**", i + 2);
      if (end > i + 2) {
        flush();
        parse(s.slice(i + 2, end), { ...f, bold: true }, out, depth + 1);
        i = end + 2;
        continue;
      }
    }
    if (depth < 4 && ch === "*" && s[i + 1] !== "*" && s[i + 1] !== " ") {
      let end = i + 1;
      while ((end = s.indexOf("*", end)) !== -1 && s[end + 1] === "*") end += 2;
      if (end > i + 1) {
        flush();
        parse(s.slice(i + 1, end), { ...f, italic: true }, out, depth + 1);
        i = end + 1;
        continue;
      }
    }
    if (depth < 4 && ch === "[") {
      const close = s.indexOf("](", i + 1);
      const endUrl = close === -1 ? -1 : s.indexOf(")", close + 2);
      if (close > i + 1 && endUrl > close + 2) {
        const label = s.slice(i + 1, close);
        if (!label.includes("[")) {
          const url = safeHttpUrl(s.slice(close + 2, endUrl));
          flush();
          // Enlace no permitido (javascript:, file:, etc.): solo se conserva el texto.
          parse(label, url ? { ...f, href: url } : f, out, depth + 1);
          i = endUrl + 1;
          continue;
        }
      }
    }
    buf += ch;
    i++;
  }
  flush();
}

export function parseInline(text: string): InlineRun[] {
  const out: InlineRun[] = [];
  parse(text, {}, out, 0);
  return out;
}

/** Texto sin marcas (los enlaces conservan solo su texto). */
export function inlineToPlain(text: string): string {
  return parseInline(text)
    .map((r) => r.text)
    .join("");
}

/** Texto plano con la URL entre paréntesis tras cada enlace (para txt/csv/xlsx). */
export function inlineToPlainWithUrls(text: string): string {
  return parseInline(text)
    .map((r) => (r.href && r.href !== r.text ? `${r.text} (${r.href})` : r.text))
    .join("");
}
