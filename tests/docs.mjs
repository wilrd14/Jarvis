// Motor de documentos (src/lib/docs): validador, renderizadores y salida segura. Sin red ni gastos.
// Genera archivos REALES en una carpeta temporal (JARVIS_DOCS_DIR) y los verifica abriéndolos:
// zips (jszip), XML bien formado (saxes), PDF (pdf-parse) y texto extraído.
//   node tests/docs.mjs            -> usa una carpeta temporal y la borra al final
//   DOCS_TEST_KEEP=1 node tests/docs.mjs   -> la conserva e imprime la ruta (para mirar los resultados)
import "./ts-register.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { SaxesParser } from "saxes";
import { PDFParse } from "pdf-parse";
import { check, summary } from "./lib.mjs";

const keep = process.env.DOCS_TEST_KEEP === "1";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-docs-"));
process.env.JARVIS_DOCS_DIR = dir;

const docs = await import("../src/lib/docs/index.ts");
const { validateDocumentSpec, markdownToSpec, specToMarkdown, renderDocument, sanitizeFileName, revealInFolder } = docs;
const out = await import("../src/lib/docs/output.server.ts");
const inline = await import("../src/lib/docs/inline.ts");

const DANGER = "<script>alert('xss')</script>";
const FORMULA = '=HYPERLINK("http://evil.example/x","clic")';

const sample = {
  title: "Informe trimestral: ventas & marketing ñandú 🚀",
  subtitle: "Resultados del tercer trimestre",
  author: "William Gómez",
  date: "20 de octubre de 2026",
  language: "es",
  blocks: [
    { type: "heading", level: 1, text: "Resumen ejecutivo" },
    { type: "paragraph", text: "¿Cómo ha ido el trimestre? ¡Muy bien! La **facturación** creció un *12 %* y el `ticket medio` subió. Más info en [nuestra web](https://example.com/informe?a=1&b=2) y en [un enlace malo](javascript:alert(1))." },
    { type: "paragraph", text: `Caracteres peligrosos: ${DANGER} & "comillas" y 'apóstrofos' < > ${FORMULA}\nSegunda línea del párrafo con emojis 😀 ✅ 📈.` },
    { type: "heading", level: 2, text: "Objetivos" },
    { type: "list", ordered: false, items: ["Aumentar las ventas en España", { text: "Mejorar la atención al cliente", items: ["Formación del equipo", "Nuevo chat en vivo"] }, "Reducir costes ocultos"] },
    { type: "list", ordered: true, items: ["Analizar los datos", "Definir la estrategia", { text: "Ejecutar el plan", items: ["Fase piloto", "Despliegue"] }] },
    { type: "list", ordered: true, items: ["Segunda lista numerada", "Debe reiniciar en 1"] },
    { type: "heading", level: 2, text: "Cifras por región" },
    {
      type: "table",
      header: ["Región", "Ventas (€)", "Crecimiento", "Notas"],
      rows: [
        ["Andalucía", "125000", "12,5", "Récord histórico"],
        ["Cataluña", "98000", "-3,2", FORMULA],
        ["País Vasco", "76000", "7", DANGER],
        ["Galicia", "54000", "+2", '@SUM(A1:A9) con "comillas", comas; y punto y coma'],
        ["Canarias", "-1", "=1+1", "\tcon tabulador"],
      ],
    },
    { type: "pagebreak" },
    { type: "heading", level: 1, text: "Conclusiones" },
    { type: "quote", text: "La calidad nunca es un accidente; siempre es el resultado de un esfuerzo inteligente." },
    { type: "heading", level: 3, text: "Código de ejemplo" },
    { type: "code", language: "js", text: "const total = ventas.reduce((a, b) => a + b, 0);\nconsole.log(`Total: ${total} €`); // <b>no es HTML</b>" },
    { type: "heading", level: 2, text: "Segunda tabla" },
    { type: "table", header: ["Mes", "Visitas"], rows: [["Julio", "1200"], ["Agosto", "1350"], ["Septiembre", "1500"]] },
    { type: "heading", level: 4, text: "Nota final" },
    { type: "paragraph", text: "Fin del informe. Gracias por su atención." },
  ],
};

const EXPECTED_TEXT = ["Resumen ejecutivo", "¿Cómo ha ido el trimestre?", "¡Muy bien!", "ñandú", "Andalucía", "Cataluña", "País Vasco", "Conclusiones"];

function wellFormed(xml) {
  let err = null;
  const p = new SaxesParser({ xmlns: false });
  p.on("error", (e) => (err ||= e));
  try {
    p.write(xml).close();
  } catch (e) {
    err ||= e;
  }
  return err ? String(err.message).slice(0, 120) : null;
}

async function checkZipXml(name, buf) {
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  const xmls = names.filter((n) => /\.(xml|rels)$/.test(n));
  const bad = [];
  const texts = {};
  for (const n of xmls) {
    const t = await zip.file(n).async("string");
    texts[n] = t;
    const e = wellFormed(t);
    if (e) bad.push(`${n}: ${e}`);
  }
  check(`${name}: zip válido con ${names.length} partes y ${xmls.length} XML bien formados`, names.length > 3 && bad.length === 0, bad.join(" | "));
  return { zip, names, texts };
}

const stats = [];
async function gen(format, spec = sample, opts = {}) {
  const t0 = performance.now();
  const r = await renderDocument(spec, format, opts);
  const ms = Math.round(performance.now() - t0);
  stats.push({ format, ms, bytes: r.bytes });
  return { ...r, ms, buf: fs.readFileSync(r.path) };
}

// ---------------------------------------------------------------- validador
{
  const v = validateDocumentSpec(sample);
  check("validador: documento de ejemplo válido", v.ok, v.ok ? "" : v.errors.join("; "));
  const garbage = [
    undefined, null, 0, 1, -1, NaN, Infinity, true, false, "", "texto", [], [1, 2], {}, { title: 1 }, { title: "" }, { title: "x" },
    { title: "x", blocks: "no" }, { title: "x", blocks: {} }, { title: "x", blocks: [null] }, { title: "x", blocks: [1] },
    { title: "x", blocks: [{}] }, { title: "x", blocks: [{ type: "evil" }] }, { title: "x", blocks: [{ type: "heading", level: 9, text: "a" }] },
    { title: "x", blocks: [{ type: "heading", level: "1", text: "a" }] }, { title: "x", blocks: [{ type: "paragraph", text: 5 }] },
    { title: "x", blocks: [{ type: "paragraph", text: "" }] }, { title: "x", blocks: [{ type: "list", ordered: "si", items: ["a"] }] },
    { title: "x", blocks: [{ type: "list", ordered: true, items: [] }] }, { title: "x", blocks: [{ type: "list", ordered: true, items: [1] }] },
    { title: "x", blocks: [{ type: "list", ordered: true, items: [{ text: "a", items: [{}] }] }] },
    { title: "x", blocks: [{ type: "table", header: [], rows: [] }] }, { title: "x", blocks: [{ type: "table", header: ["a"], rows: [["a", "b"]] }] },
    { title: "x", blocks: [{ type: "table", header: ["a"], rows: "x" }] }, { title: "x", blocks: [{ type: "table", header: Array(51).fill("c"), rows: [] }] },
    { title: "x", blocks: [{ type: "code", text: "a", language: "../../etc" }] }, { title: "x", blocks: [{ type: "pagebreak", extra: 1 }] },
    { title: "x", language: "en", blocks: [] }, { title: "x".repeat(201), blocks: [] }, { title: "x", blocks: [], __proto__: { a: 1 }, extra: 1 },
    { title: { toString() { throw new Error("boom"); } }, blocks: [] }, { title: "x", get blocks() { throw new Error("getter"); } },
    JSON.parse('{"title":"x","blocks":[],"__proto__":{"polluted":true}}'), Symbol("s"), () => 1, new Date(), new Map(), Buffer.from("x"),
    { title: "x", blocks: [{ type: "paragraph", text: "a".repeat(2_000_000) }] }, { title: "\u0000\u0001", blocks: [] },
  ];
  let thrown = 0;
  let accepted = 0;
  for (const g of garbage) {
    try {
      const r = validateDocumentSpec(g);
      if (r.ok) accepted++;
      if (typeof r.ok !== "boolean") thrown++;
    } catch {
      thrown++;
    }
  }
  check(`validador: ${garbage.length} entradas basura sin lanzar excepciones`, thrown === 0 && garbage.length >= 40, `lanzaron ${thrown}`);
  check("validador: las basura no se aceptan salvo las que son documentos válidos", accepted <= 3, `aceptadas ${accepted}`);
  check("validador: no contamina Object.prototype", ({}).polluted === undefined);

  const ctrl = validateDocumentSpec({ title: "  Hola\u0000\u0007 mundo\r\nlinea  ", blocks: [{ type: "paragraph", text: "a\r\nb\u0001c\r\r\r\rd\u202Eevil" }] });
  check("validador: quita controles y normaliza saltos", ctrl.ok && ctrl.spec.title === "Hola mundo linea" && ctrl.spec.blocks[0].text === "a\nbc\n\nd" + "evil", ctrl.ok ? JSON.stringify(ctrl.spec.blocks[0].text) : ctrl.errors.join());
  const big = validateDocumentSpec({ title: "x", blocks: Array.from({ length: 401 }, () => ({ type: "paragraph", text: "a" })) });
  check("límites: 401 bloques rechazados con error claro", !big.ok && /401.*400|máximo 400/.test(big.errors.join()), big.ok ? "" : big.errors.join());
  const ok400 = validateDocumentSpec({ title: "x", blocks: Array.from({ length: 400 }, () => ({ type: "paragraph", text: "a" })) });
  check("límites: 400 bloques admitidos", ok400.ok);
  const huge = validateDocumentSpec({ title: "x", blocks: Array.from({ length: 30 }, () => ({ type: "paragraph", text: "palabra ".repeat(900) })) });
  check("límites: más de 120.000 caracteres rechazado", !huge.ok && /120000/.test(huge.errors.join()), huge.ok ? "ok?" : huge.errors.join());
  const rows = validateDocumentSpec({ title: "x", blocks: [{ type: "table", header: ["a"], rows: Array.from({ length: 2001 }, () => ["x"]) }] });
  check("límites: 2001 filas rechazadas", !rows.ok && /2000/.test(rows.errors.join()));
  const cols = validateDocumentSpec({ title: "x", blocks: [{ type: "table", header: Array(50).fill("c"), rows: [Array(50).fill("d")] }] });
  check("límites: 50 columnas admitidas", cols.ok);
  let msg = "";
  try {
    await renderDocument(huge.ok ? {} : { title: "x", blocks: Array.from({ length: 30 }, () => ({ type: "paragraph", text: "palabra ".repeat(900) })) }, "txt");
  } catch (e) {
    msg = e.message;
  }
  check("límites: renderDocument rechaza spec enorme con error en español", /Documento no válido/.test(msg), msg);
  msg = "";
  try {
    await renderDocument(sample, "exe");
  } catch (e) {
    msg = e.message;
  }
  check("renderDocument: formato desconocido rechazado", /Formato no admitido/.test(msg), msg);
}

// ---------------------------------------------------------------- inline
{
  const r = inline.parseInline("a **b *c* d** `e` [x](https://ok.com) [y](javascript:alert(1)) [z](file:///c:/x) \\*lit\\*");
  const link = r.filter((x) => x.href);
  check("inline: solo enlaces http/https", link.length === 1 && link[0].href === "https://ok.com/", JSON.stringify(link));
  check("inline: negrita, cursiva, código y escapes", r.some((x) => x.bold && x.italic && x.text === "c") && r.some((x) => x.code && x.text === "e") && r.map((x) => x.text).join("").includes("*lit*"));
  check("inline: enlaces peligrosos conservan el texto", r.map((x) => x.text).join("").includes("y") && !JSON.stringify(r).includes("javascript"));
}

// ---------------------------------------------------------------- markdown
{
  const md = [
    "# Título del informe", "", "Un párrafo con **negrita**", "y segunda línea.", "", "## Lista", "- uno", "- dos", "  - sub a", "  - sub b", "3. tres", "", "1. primero", "2. segundo", "",
    "| A | B |", "|---|:-:|", "| 1 | x \\| y |", "| 2 | 3 |", "", "> una cita", "> en dos líneas", "", "```python", "print('hola')", "# no es título", "```", "", "<!-- pagebreak -->", "", "### Final", "Texto final ¿ok?",
  ].join("\n");
  const r = markdownToSpec(md);
  check("markdown: se convierte a spec válido", r.ok, r.ok ? "" : r.errors.join());
  if (r.ok) {
    const types = r.spec.blocks.map((b) => b.type).join(",");
    check("markdown: título, bloques y orden", r.spec.title === "Título del informe" && types === "paragraph,heading,list,list,list,table,quote,code,pagebreak,heading,paragraph", types);
    const list = r.spec.blocks[2];
    check("markdown: lista con anidado de 1 nivel", list.items.length >= 2 && typeof list.items[1] === "object" && list.items[1].items.length === 2, JSON.stringify(list.items));
    check("markdown: tabla con celda escapada", r.spec.blocks[5].rows[0][1] === "x | y", JSON.stringify(r.spec.blocks[5]));
    check("markdown: bloque de código intacto", r.spec.blocks[7].text.includes("# no es título") && r.spec.blocks[7].language === "python");
    const back = markdownToSpec(specToMarkdown(r.spec));
    check("markdown: ida y vuelta spec -> md -> spec estable", back.ok && back.spec.blocks.length === r.spec.blocks.length && back.spec.title === r.spec.title, back.ok ? "" : back.errors.join());
  }
  check("markdown: entrada rara no lanza", [markdownToSpec(""), markdownToSpec("|||\n|-|"), markdownToSpec("```\nsin cerrar"), markdownToSpec(null)].every((x) => typeof x.ok === "boolean"));
}

// ---------------------------------------------------------------- nombres de archivo
{
  const cases = [
    ["..\\..\\Windows\\system32\\evil", (n) => !/[\\/.:]/.test(n) && n.includes("evil")],
    ["CON", (n) => !/^con$/i.test(n)],
    ["nul", (n) => !/^nul$/i.test(n)],
    ["COM1", (n) => !/^com1$/i.test(n)],
    ["lpt9", (n) => !/^lpt9$/i.test(n)],
    ['a<b>c:d"e/f\\g|h?i*j', (n) => !/[<>:"/\\|?*]/.test(n) && n.includes("a")],
    ["", (n) => n === "Documento"],
    ["   ...   ", (n) => n === "Documento"],
    ["🚀🚀🚀", (n) => n === "Documento"],
    ["Informe final...", (n) => !n.endsWith(".")],
    ["x".repeat(500), (n) => n.length <= 80],
    ["Ñandú café ¿qué?", (n) => n === "Ñandú café qué"],
    ["archivo\u0000con\u0007control", (n) => !/[\u0000-\u001f]/.test(n)],
    [12345, (n) => n === "Documento"],
    [null, (n) => n === "Documento"],
  ];
  for (const [input, ok] of cases) {
    const n = sanitizeFileName(input);
    check(`nombre: ${JSON.stringify(String(input).slice(0, 30))} -> ${JSON.stringify(n)}`, ok(n) && n.length > 0 && n.length <= 80 && !/[\\/:*?"<>|]|\.$| $/.test(n));
  }
  const paths = [];
  for (let i = 0; i < 3; i++) paths.push((await renderDocument({ title: "Repetido", blocks: [{ type: "paragraph", text: `versión ${i}` }] }, "txt")).path);
  const names = paths.map((p) => path.basename(p));
  check("nombre repetido x3 sin sobrescribir", names.join("|") === "Repetido.txt|Repetido (2).txt|Repetido (3).txt", names.join("|"));
  check("las 3 versiones conservan su contenido", paths.every((p, i) => fs.readFileSync(p, "utf8").includes(`versión ${i}`)));
  check("todo queda dentro de la carpeta de salida", paths.every((p) => path.dirname(p) === dir));
  const evil = await renderDocument({ title: "..\\..\\evil", blocks: [{ type: "paragraph", text: "x" }] }, "md");
  check("título con ..\\ no escapa de la carpeta", path.dirname(evil.path) === dir, evil.path);
  check("no quedan temporales .tmp", fs.readdirSync(dir).every((f) => !f.endsWith(".tmp")), fs.readdirSync(dir).join());
  let m = "";
  try {
    await out.saveDocument("grande", ".txt", Buffer.alloc(25 * 1024 * 1024 + 1));
  } catch (e) {
    m = e.message;
  }
  check("tamaño máximo de 25 MB", /25 MB/.test(m), m);
  m = "";
  try {
    await out.saveDocument("x", "../evil", Buffer.from("x"));
  } catch (e) {
    m = e.message;
  }
  check("la extensión no puede venir con traversal", /Extensión/.test(m), m);
  const r1 = await revealInFolder(path.join(os.tmpdir(), "fuera.txt"));
  const r2 = await revealInFolder(path.join(dir, "..", "..", "Windows", "notepad.exe"));
  const r3 = await revealInFolder("relativa.txt");
  check("revealInFolder rechaza rutas fuera de la carpeta o relativas", !r1.ok && !r2.ok && !r3.ok, JSON.stringify([r1, r2, r3]));
}

// ---------------------------------------------------------------- formatos
{
  const md = await gen("md");
  const t = md.buf.toString("utf8");
  check("md: título, tabla y bloque de código", t.startsWith("# Informe trimestral") && t.includes("| Región |") && t.includes("```js") && EXPECTED_TEXT.every((s) => s === "ñandú" || t.includes(s) || s === "Resumen ejecutivo"));

  const txt = await gen("txt");
  const tt = txt.buf.toString("utf8");
  check("txt: acentos, ñ, ¿¡ y emojis", ["¿Cómo ha ido el trimestre?", "¡Muy bien!", "ÑANDÚ", "🚀", "Andalucía"].every((s) => tt.includes(s)));
  check("txt: sin marcas inline (**) y enlaces con URL", !tt.includes("**facturación**") && tt.includes("nuestra web (https://example.com/informe?a=1&b=2)"));

  const html = await gen("html");
  const h = html.buf.toString("utf8");
  check("html: <script> aparece escapado y nunca como etiqueta", h.includes("&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;") && !/<script/i.test(h));
  check("html: meta CSP exacta", h.includes(`content="default-src 'none'; style-src 'unsafe-inline'"`));
  check("html: sin recursos remotos ni manejadores", !/\b(src|srcset|action)\s*=/i.test(h) && !/<link\b/i.test(h) && !/\bon\w+\s*=/i.test(h) && !/@import|url\(/i.test(h));
  check("html: enlaces solo https y javascript: descartado", !/javascript:/i.test(h) && (h.match(/href="([^"]*)"/g) || []).every((x) => x.startsWith('href="https://')));
  check("html: ampersand y comillas escapados", h.includes("ventas &amp; marketing") && h.includes("&quot;comillas&quot;"));
  check("html: tabla, listas y cita", ["<table>", "<th>Región</th>", "<ol>", "<ul>", "<blockquote>", "<pre><code>", 'class="pagebreak"'].every((s) => h.includes(s)));
  check("html: código con etiquetas queda como texto", h.includes("&lt;b&gt;no es HTML&lt;/b&gt;"));
  const xmlish = wellFormed(h.replace(/<!doctype html>/i, "").replace(/<meta[^>]*>/g, (m) => m.replace(/>$/, "/>")).replace(/<br>/g, "<br/>").replace(/<hr([^>]*)>/g, "<hr$1/>"));
  check("html: estructura bien formada (como XML tras cerrar vacíos)", xmlish === null, xmlish);

  const csv = await gen("csv");
  const cb = csv.buf;
  const ct = cb.toString("utf8");
  check("csv: UTF-8 con BOM", cb[0] === 0xef && cb[1] === 0xbb && cb[2] === 0xbf);
  check("csv: neutraliza fórmulas con apóstrofo", ct.includes("'=HYPERLINK") && ct.includes("'@SUM") && ct.includes("'=1+1") && ct.includes("'+2"), ct);
  check("csv: los negativos numéricos no se alteran", /;-3,2;/.test(ct) && /;-1;/.test(ct));
  check("csv: escapado de comillas y separador", ct.includes('"\'@SUM(A1:A9) con ""comillas"", comas; y punto y coma"'), ct.split("\r\n")[4]);
  check("csv: solo la primera tabla por defecto", ct.includes("Andalucía") && !ct.includes("Septiembre"));
  const csvAll = await gen("csv", sample, { csvAllTables: true, csvDelimiter: "," });
  check("csv: todas las tablas con coma", csvAll.buf.toString("utf8").includes("Septiembre,1500") && csvAll.buf.toString("utf8").includes("\r\n\r\n"));

  const docx = await gen("docx");
  const dz = await checkZipXml("docx", docx.buf);
  const doc = dz.texts["word/document.xml"] || "";
  const allText = [...doc.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(" ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  check("docx: texto esperado con acentos, ñ y ¿¡", EXPECTED_TEXT.every((s) => allText.includes(s)), allText.slice(0, 200));
  check("docx: títulos reales (Heading1-4)", ["Heading1", "Heading2", "Heading3", "Heading4"].every((s) => doc.includes(`w:val="${s}"`)));
  check("docx: listas con numeración (varias instancias)", (doc.match(/<w:numPr>/g) || []).length >= 10 && (dz.texts["word/numbering.xml"].match(/<w:num /g) || []).length >= 3);
  check("docx: dos tablas con bordes y cabecera en negrita", (doc.match(/<w:tbl>/g) || []).length === 2 && doc.includes("w:tcBorders") && /<w:tr>(?:(?!<\/w:tr>).)*<w:b\/>/s.test(doc));
  check("docx: hipervínculo externo https y sin javascript:", doc.includes("<w:hyperlink") && /Target="https:\/\/example\.com\/informe\?a=1&amp;b=2"/.test(dz.texts["word/_rels/document.xml.rels"]) && !/javascript:/i.test(JSON.stringify(dz.texts)));
  check("docx: salto de página y portada", doc.includes('w:type="page"') || doc.includes("<w:pageBreakBefore"));
  check("docx: sin campos/fórmulas ejecutables ni <script> real", !/<w:fldChar|<w:instrText|<w:fldSimple|<script/i.test(doc) && !Object.keys(dz.texts).some((n) => /vba|macro|oleObject|embeddings/i.test(n)));
  check("docx: Calibri 11 y márgenes 2,5 cm", /w:ascii="Calibri"/.test(dz.texts["word/styles.xml"]) && /<w:sz w:val="22"\/>/.test(dz.texts["word/styles.xml"]) && /w:top="1417"/.test(doc) && /w:left="1417"/.test(doc));
  check("docx: metadatos (título y autor)", /<dc:title>Informe trimestral/.test(dz.texts["docProps/core.xml"]) && /William G/.test(dz.texts["docProps/core.xml"]));

  const xlsx = await gen("xlsx");
  const xz = await checkZipXml("xlsx", xlsx.buf);
  const wb = xz.texts["xl/workbook.xml"];
  const sheetNames = [...wb.matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => m[1]);
  check("xlsx: una hoja por tabla con nombres de sus títulos", sheetNames.length === 2 && sheetNames[0] === "Cifras por región" && sheetNames[1] === "Segunda tabla", sheetNames.join("|"));
  const s1 = xz.texts["xl/worksheets/sheet1.xml"];
  const shared = xz.texts["xl/sharedStrings.xml"];
  check("xlsx: NINGUNA celda es fórmula", !/<f[ >]/.test(Object.entries(xz.texts).filter(([n]) => n.startsWith("xl/worksheets/")).map(([, v]) => v).join("")) && !/<f[ >]/.test(s1));
  check("xlsx: las fórmulas peligrosas quedan como texto literal", shared.includes("=HYPERLINK(") && shared.includes("@SUM(A1:A9)") && shared.includes("=1+1") && /t="s"/.test(s1));
  check("xlsx: texto con acentos y <script> escapado", shared.includes("Andalucía") && shared.includes("&lt;script&gt;") && !shared.includes("<script"));
  check("xlsx: fila congelada y anchos", /<pane [^>]*ySplit="1"[^>]*state="frozen"|<pane [^>]*state="frozen"[^>]*ySplit="1"/.test(s1) && /<col /.test(s1));
  check("xlsx: cabecera en negrita (estilo bold)", /<b\/>|<b>/.test(xz.texts["xl/styles.xml"]));
  check("xlsx: números reales para cifras limpias", /<c r="B2"[^>]*><v>125000<\/v>/.test(s1) || /<c r="B2"[^>]*t="n"[^>]*><v>125000<\/v>/.test(s1) || /125000<\/v>/.test(s1));
  const xnotable = await gen("xlsx", { title: "Sin tablas", blocks: [{ type: "paragraph", text: "Hola mundo" }, { type: "list", ordered: false, items: ["a", "b"] }] });
  const xnz = await JSZip.loadAsync(xnotable.buf);
  check("xlsx: sin tablas -> hoja Documento con el texto", /name="Documento"/.test(await xnz.file("xl/workbook.xml").async("string")) && (await xnz.file("xl/sharedStrings.xml").async("string")).includes("Hola mundo"));

  const pptx = await gen("pptx");
  const pz = await checkZipXml("pptx", pptx.buf);
  const slides = pz.names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  const slideText = slides.map((n) => pz.texts[n]).join(" ");
  check("pptx: portada + diapositivas por título (>= 5)", slides.length >= 5 && slides.length <= 60, `${slides.length}`);
  check("pptx: texto con acentos y tablas", ["Resumen ejecutivo", "Conclusiones", "Andalucía", "ñandú", "¿Cómo ha ido el trimestre?"].every((s) => slideText.replace(/&amp;/g, "&").includes(s)) && slideText.includes("<a:tbl>"));
  check("pptx: sin <script> real, sin javascript: ni macros", !/<script/i.test(slideText) && !/javascript:/i.test(JSON.stringify(pz.texts)) && !pz.names.some((n) => /vba|macro|oleObject/i.test(n)));
  check("pptx: enlaces solo https", Object.entries(pz.texts).filter(([n]) => n.includes("slides/_rels")).every(([, v]) => [...v.matchAll(/Target="([^"]*)"/g)].every((m) => !/^https?:/i.test(m[1]) || m[1].startsWith("https://") || m[1].startsWith("http://schemas"))));
  let ms = "";
  try {
    await renderDocument({ title: "Muchas", blocks: Array.from({ length: 70 }, (_, i) => ({ type: "heading", level: 1, text: `Sección ${i}` })) }, "pptx");
  } catch (e) {
    ms = e.message;
  }
  check("pptx: más de 60 diapositivas -> error claro", /60 diapositivas/.test(ms), ms);

  const pdf = await gen("pdf");
  check("pdf: empieza por %PDF- y termina con %%EOF", pdf.buf.subarray(0, 5).toString("latin1") === "%PDF-" && pdf.buf.subarray(-32).toString("latin1").includes("%%EOF"));
  const parser = new PDFParse({ data: new Uint8Array(pdf.buf) });
  const res = await parser.getText();
  await parser.destroy();
  const ptext = res.text.replace(/\s+/g, " ");
  check(`pdf: ${res.total} páginas (esperadas 3-5: portada + contenido + salto)`, res.total >= 3 && res.total <= 5, String(res.total));
  check("pdf: texto extraíble con acentos, ñ y ¿¡", ["Resumen ejecutivo", "¿Cómo ha ido el trimestre?", "¡Muy bien!", "ñandú", "Andalucía", "Cataluña", "País Vasco", "Conclusiones"].every((s) => ptext.includes(s)), ptext.slice(0, 300));
  check("pdf: <script> visible como texto, no ejecutado", ptext.includes("<script>alert('xss')</script>"));
  const leftovers = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith("jarvis-pdf-"));
  check("pdf: perfil temporal borrado siempre", leftovers.length === 0, leftovers.join());
  const pdfbig = await gen("pdf", { title: "Doc de 60 páginas", blocks: Array.from({ length: 75 }, (_, i) => ({ type: "paragraph", text: `Párrafo ${i}: ` + "texto de relleno con acentos áéíóú ñ ".repeat(40) })) });
  const p2 = new PDFParse({ data: new Uint8Array(pdfbig.buf) });
  const r2 = await p2.getText();
  await p2.destroy();
  check(`pdf: documento largo (${r2.total} páginas)`, r2.total > 10, String(r2.total));
}

console.log("\nFormato  ms     bytes");
for (const s of stats) console.log(`${s.format.padEnd(6)} ${String(s.ms).padStart(6)} ${String(s.bytes).padStart(9)}`);
console.log(`\nCarpeta de salida: ${dir}${keep ? " (conservada)" : ""}`);
if (!keep) fs.rmSync(dir, { recursive: true, force: true });
process.exit(summary() ? 1 : 0);
