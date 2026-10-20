/** PPTX con pptxgenjs: portada + una diapositiva por heading 1-2 (máx. 60). */
import PptxGenJS from "pptxgenjs";
import { inlineToPlainWithUrls, parseInline } from "../inline";
import type { Block, DocumentSpec } from "../schema";

export const MAX_SLIDES = 60;
const FONT = "Calibri";
const MAX_BULLETS = 7;

type Run = { text: string; options?: Record<string, unknown> };

function toRuns(text: string, base: Record<string, unknown> = {}): Run[] {
  return parseInline(text).map((r) => ({
    text: r.text,
    options: {
      ...base,
      bold: r.bold || base.bold || undefined,
      italic: r.italic || base.italic || undefined,
      fontFace: r.code ? "Consolas" : undefined,
      hyperlink: r.href ? { url: r.href } : undefined,
      color: r.href ? "0B5CAD" : base.color,
    },
  }));
}

interface Item {
  runs: Run[];
  level: number;
  bullet: boolean | { type: "number" };
}

function itemsOf(blocks: Block[]): { items: Item[]; tables: Extract<Block, { type: "table" }>[] } {
  const items: Item[] = [];
  const tables: Extract<Block, { type: "table" }>[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "heading":
        items.push({ runs: toRuns(b.text, { bold: true }), level: 0, bullet: false });
        break;
      case "paragraph":
        items.push({ runs: toRuns(b.text), level: 0, bullet: true });
        break;
      case "quote":
        items.push({ runs: toRuns(b.text, { italic: true }), level: 0, bullet: false });
        break;
      case "code":
        items.push({ runs: [{ text: b.text.split("\n").slice(0, 12).join("\n"), options: { fontFace: "Consolas" } }], level: 0, bullet: false });
        break;
      case "list":
        for (const it of b.items) {
          const num = b.ordered ? { type: "number" as const } : true;
          items.push({ runs: toRuns(typeof it === "string" ? it : it.text), level: 0, bullet: num });
          if (typeof it !== "string") for (const s of it.items) items.push({ runs: toRuns(s), level: 1, bullet: true });
        }
        break;
      case "table":
        tables.push(b);
        break;
      case "pagebreak":
        break;
    }
  }
  return { items, tables };
}

export async function renderPptx(spec: DocumentSpec): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 in
  pptx.title = spec.title;
  pptx.author = spec.author ?? "Jarvis";
  pptx.subject = spec.subtitle ?? "";
  pptx.company = "Jarvis";
  let count = 0;
  const addSlide = () => {
    if (++count > MAX_SLIDES) throw new Error(`El documento genera más de ${MAX_SLIDES} diapositivas; acórtalo o divídelo en partes.`);
    const s = pptx.addSlide();
    s.background = { color: "FFFFFF" };
    return s;
  };

  // Portada
  const cover = addSlide();
  cover.background = { color: "14213D" };
  cover.addText(spec.title, { x: 0.8, y: 2.2, w: 11.7, h: 1.6, fontFace: FONT, fontSize: 40, bold: true, color: "FFFFFF", align: "left", valign: "bottom", fit: "shrink" });
  if (spec.subtitle) cover.addText(spec.subtitle, { x: 0.8, y: 3.9, w: 11.7, h: 0.8, fontFace: FONT, fontSize: 22, color: "C9D3E2", fit: "shrink" });
  const meta = [spec.author, spec.date].filter(Boolean).join("  ·  ");
  if (meta) cover.addText(meta, { x: 0.8, y: 5.0, w: 11.7, h: 0.5, fontFace: FONT, fontSize: 16, color: "AEBBD0" });

  // Agrupa por heading 1-2
  const groups: { title: string; blocks: Block[] }[] = [];
  let cur: { title: string; blocks: Block[] } | null = null;
  for (const b of spec.blocks) {
    if (b.type === "heading" && b.level <= 2) {
      cur = { title: b.text, blocks: [] };
      groups.push(cur);
    } else {
      if (!cur) {
        cur = { title: "Introducción", blocks: [] };
        groups.push(cur);
      }
      cur.blocks.push(b);
    }
  }

  for (const g of groups) {
    const { items, tables } = itemsOf(g.blocks);
    const chunks: Item[][] = [];
    for (let i = 0; i < items.length; i += MAX_BULLETS) chunks.push(items.slice(i, i + MAX_BULLETS));
    if (!chunks.length && !tables.length) chunks.push([]);
    let part = 0;
    const titled = (extra: boolean) => inlineToPlainWithUrls(g.title) + (extra ? " (cont.)" : "");
    const header = (s: PptxGenJS.Slide, extra: boolean) => {
      s.addText(titled(extra), { x: 0.6, y: 0.35, w: 12.1, h: 0.9, fontFace: FONT, fontSize: 30, bold: true, color: "14213D", fit: "shrink", valign: "middle" });
      s.addShape(pptx.ShapeType.rect, { x: 0.6, y: 1.25, w: 12.1, h: 0.04, fill: { color: "8AA0B8" }, line: { color: "8AA0B8", width: 0 } });
    };
    for (const chunk of chunks) {
      const s = addSlide();
      header(s, part++ > 0);
      if (chunk.length) {
        const runs: Run[] = [];
        chunk.forEach((it, idx) => {
          it.runs.forEach((r, ri) => {
            const o: Record<string, unknown> = { ...r.options, fontSize: it.level ? 16 : 20, fontFace: (r.options?.fontFace as string) ?? FONT, color: (r.options?.color as string) ?? "1F2328" };
            if (ri === 0) {
              o.bullet = it.bullet;
              o.indentLevel = it.level;
            }
            if (ri === it.runs.length - 1 && idx < chunk.length - 1) o.breakLine = true;
            o.paraSpaceAfter = 8;
            runs.push({ text: r.text, options: o });
          });
        });
        s.addText(runs as PptxGenJS.TextProps[], { x: 0.8, y: 1.5, w: 11.7, h: 5.4, valign: "top", fit: "shrink" });
      }
    }
    for (const t of tables) {
      const s = addSlide();
      header(s, part++ > 0);
      const head = t.header.map((h) => ({ text: inlineToPlainWithUrls(h), options: { bold: true, fill: { color: "E8EDF3" }, color: "14213D", fontFace: FONT } }));
      const body = t.rows.slice(0, 14).map((r) => r.map((c) => ({ text: inlineToPlainWithUrls(c), options: { fontFace: FONT, color: "1F2328" } })));
      s.addTable([head, ...body], { x: 0.6, y: 1.5, w: 12.1, fontSize: t.header.length > 6 ? 11 : 14, border: { type: "solid", pt: 0.75, color: "8C96A3" }, valign: "middle", autoPage: false });
      if (t.rows.length > 14) s.addText(`Se muestran 14 de ${t.rows.length} filas.`, { x: 0.6, y: 6.9, w: 12.1, h: 0.4, fontSize: 11, italic: true, color: "6B7280", fontFace: FONT });
    }
  }
  const out = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.from(out as Buffer);
}
