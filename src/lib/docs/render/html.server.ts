/** HTML autocontenido e imprimible (también es la base del PDF). Todo el contenido va escapado. */
import { parseInline } from "../inline";
import type { DocumentSpec } from "../schema";

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function inline(text: string): string {
  return parseInline(text)
    .map((r) => {
      let h = esc(r.text).replace(/\n/g, "<br>");
      if (r.code) h = `<code>${h}</code>`;
      if (r.bold) h = `<strong>${h}</strong>`;
      if (r.italic) h = `<em>${h}</em>`;
      if (r.href) h = `<a href="${esc(r.href)}" rel="noopener noreferrer">${h}</a>`;
      return h;
    })
    .join("");
}

const CSS = `
@page { size: A4; margin: 2.5cm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: Calibri, "Segoe UI", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", Arial, sans-serif; font-size: 11pt; line-height: 1.5; color: #1f2328; max-width: 800px; margin: 2rem auto; padding: 0 1.2rem; }
@media print { body { max-width: none; margin: 0; padding: 0; } }
h1, h2, h3, h4, h5 { line-height: 1.25; color: #14213d; margin: 1.4em 0 .5em; break-after: avoid; }
h1 { font-size: 20pt; border-bottom: 1px solid #c8ced6; padding-bottom: .2em; }
h2 { font-size: 16pt; } h3 { font-size: 13pt; } h4 { font-size: 11.5pt; } h5 { font-size: 11pt; font-style: italic; }
p { margin: 0 0 .8em; orphans: 3; widows: 3; }
.cover { text-align: center; padding: 28vh 0 0; break-after: page; }
.cover h1 { font-size: 30pt; border: 0; margin: 0 0 .3em; }
.cover .subtitle { font-size: 15pt; color: #4b5563; margin: 0 0 2em; }
.cover .meta { color: #4b5563; margin: 0; }
.plain-title { margin-top: 0; }
ul, ol { margin: 0 0 .9em; padding-left: 1.6em; }
li { margin: .15em 0; }
table { border-collapse: collapse; width: 100%; margin: .4em 0 1.1em; font-size: 10.5pt; break-inside: auto; }
tr { break-inside: avoid; }
th, td { border: 1px solid #9aa3ad; padding: .35em .6em; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
th { background: #e8edf3; font-weight: 700; }
thead { display: table-header-group; }
blockquote { margin: 0 0 1em; padding: .4em 1em; border-left: 4px solid #8aa0b8; background: #f4f6f9; color: #374151; font-style: italic; }
pre { background: #f3f4f6; border: 1px solid #d5d9df; border-radius: 4px; padding: .7em .9em; font-size: 9.5pt; white-space: pre-wrap; overflow-wrap: anywhere; break-inside: avoid; }
code { font-family: Consolas, "Cascadia Mono", "Courier New", monospace; background: #f3f4f6; padding: .05em .3em; border-radius: 3px; font-size: .92em; }
pre code { background: none; padding: 0; }
a { color: #0b5cad; }
.pagebreak { break-after: page; height: 0; border: 0; margin: 0; }
`;

export async function renderHtml(spec: DocumentSpec): Promise<Buffer> {
  const hasCover = !!(spec.subtitle || spec.author || spec.date);
  const body: string[] = [];
  if (hasCover) {
    body.push(
      `<header class="cover"><h1>${esc(spec.title)}</h1>` +
        (spec.subtitle ? `<p class="subtitle">${esc(spec.subtitle)}</p>` : "") +
        (spec.author ? `<p class="meta">${esc(spec.author)}</p>` : "") +
        (spec.date ? `<p class="meta">${esc(spec.date)}</p>` : "") +
        `</header>`,
    );
  } else body.push(`<h1 class="plain-title">${esc(spec.title)}</h1>`);
  for (const b of spec.blocks) {
    switch (b.type) {
      case "heading": {
        // El título del documento es el h1; los títulos del cuerpo bajan un nivel para mantener la jerarquía.
        const lvl = b.level + 1;
        body.push(`<h${lvl}>${inline(b.text)}</h${lvl}>`);
        break;
      }
      case "paragraph":
        body.push(`<p>${inline(b.text)}</p>`);
        break;
      case "quote":
        body.push(`<blockquote>${inline(b.text)}</blockquote>`);
        break;
      case "code":
        body.push(`<pre><code>${esc(b.text)}</code></pre>`);
        break;
      case "list": {
        const tag = b.ordered ? "ol" : "ul";
        const items = b.items
          .map((it) => {
            if (typeof it === "string") return `<li>${inline(it)}</li>`;
            return `<li>${inline(it.text)}<${tag}>${it.items.map((s) => `<li>${inline(s)}</li>`).join("")}</${tag}></li>`;
          })
          .join("");
        body.push(`<${tag}>${items}</${tag}>`);
        break;
      }
      case "table":
        body.push(
          `<table><thead><tr>${b.header.map((h) => `<th>${inline(h)}</th>`).join("")}</tr></thead><tbody>` +
            b.rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("") +
            `</tbody></table>`,
        );
        break;
      case "pagebreak":
        body.push(`<hr class="pagebreak">`);
        break;
    }
  }
  const meta = [spec.author ? `<meta name="author" content="${esc(spec.author)}">` : ""].join("");
  const html =
    `<!doctype html>\n<html lang="es"><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">${meta}` +
    `<title>${esc(spec.title)}</title><style>${CSS}</style></head><body>\n${body.join("\n")}\n</body></html>\n`;
  return Buffer.from(html, "utf8");
}
