/** Renderizadores de texto: md, txt y csv. Solo servidor. */
import { inlineToPlainWithUrls, inlineToPlain } from "../inline";
import { specToMarkdown, type Block, type DocumentSpec } from "../schema";
import type { RenderOpts } from "./types";

export async function renderMd(spec: DocumentSpec): Promise<Buffer> {
  return Buffer.from(specToMarkdown(spec), "utf8");
}

function wrapIndent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((l) => prefix + l)
    .join("\n");
}

function tableText(header: string[], rows: string[][]): string {
  const all = [header, ...rows].map((r) => r.map((c) => inlineToPlainWithUrls(c).replace(/\n/g, " ")));
  const widths = header.map((_, i) => Math.min(40, Math.max(...all.map((r) => [...(r[i] ?? "")].length))));
  const fmt = (r: string[]) =>
    r
      .map((c, i) => {
        const chars = [...c];
        const cut = chars.length > widths[i] ? chars.slice(0, widths[i] - 1).join("") + "…" : c;
        return cut + " ".repeat(Math.max(0, widths[i] - [...cut].length));
      })
      .join(" | ")
      .trimEnd();
  return [fmt(all[0]), widths.map((w) => "-".repeat(w)).join("-+-"), ...all.slice(1).map(fmt)].join("\n");
}

export async function renderTxt(spec: DocumentSpec): Promise<Buffer> {
  const out: string[] = [spec.title.toUpperCase(), "=".repeat(Math.min(80, [...spec.title].length))];
  if (spec.subtitle) out.push(spec.subtitle);
  const meta = [spec.author, spec.date].filter(Boolean).join(" · ");
  if (meta) out.push(meta);
  out.push("");
  for (const b of spec.blocks) {
    switch (b.type) {
      case "heading": {
        const t = inlineToPlain(b.text);
        out.push(b.level <= 2 ? `${t}\n${(b.level === 1 ? "=" : "-").repeat(Math.min(80, [...t].length))}` : `${"#".repeat(b.level)} ${t}`);
        break;
      }
      case "paragraph":
        out.push(inlineToPlainWithUrls(b.text));
        break;
      case "quote":
        out.push(wrapIndent(inlineToPlainWithUrls(b.text), "> "));
        break;
      case "code":
        out.push(wrapIndent(b.text, "    "));
        break;
      case "list":
        out.push(
          b.items
            .map((it, n) => {
              const mark = b.ordered ? `${n + 1}.` : "-";
              if (typeof it === "string") return `${mark} ${inlineToPlainWithUrls(it)}`;
              return [`${mark} ${inlineToPlainWithUrls(it.text)}`, ...it.items.map((s) => `    - ${inlineToPlainWithUrls(s)}`)].join("\n");
            })
            .join("\n"),
        );
        break;
      case "table":
        out.push(tableText(b.header, b.rows));
        break;
      case "pagebreak":
        out.push("-".repeat(40));
        break;
    }
    out.push("");
  }
  return Buffer.from(out.join("\n").replace(/\n+$/, "\n"), "utf8");
}

// ---------- CSV ----------

/** Neutraliza inyección de fórmulas: texto que empieza por = + - @ tab o CR recibe un apóstrofo. */
export function neutralizeFormula(s: string): string {
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) return `'${s}`;
  return s;
}

function csvCell(raw: string, delim: string): string {
  const s = neutralizeFormula(inlineToPlainWithUrls(raw));
  return /["\r\n]/.test(s) || s.includes(delim) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function renderCsv(spec: DocumentSpec, opts: RenderOpts = {}): Promise<Buffer> {
  const delim = opts.csvDelimiter ?? ";";
  const tables = spec.blocks.filter((b): b is Extract<Block, { type: "table" }> => b.type === "table");
  const lines: string[] = [];
  const rowsOf = (header: string[], rows: string[][]) => [header, ...rows].map((r) => r.map((c) => csvCell(c, delim)).join(delim));
  if (tables.length === 0) {
    // Sin tablas: una columna con el texto del documento.
    lines.push(csvCell("Texto", delim));
    for (const b of spec.blocks) {
      if (b.type === "pagebreak" || b.type === "table") continue;
      if (b.type === "list") for (const it of b.items) lines.push(csvCell(typeof it === "string" ? it : [it.text, ...it.items].join(" / "), delim));
      else lines.push(csvCell(b.text, delim));
    }
  } else if (opts.csvAllTables) {
    tables.forEach((t, n) => {
      if (n > 0) lines.push("");
      lines.push(...rowsOf(t.header, t.rows));
    });
  } else {
    lines.push(...rowsOf(tables[0].header, tables[0].rows));
  }
  // UTF-8 con BOM para que Excel respete acentos y ñ.
  return Buffer.from(String.fromCharCode(0xfeff) + lines.join("\r\n") + "\r\n", "utf8");
}
