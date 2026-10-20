/** DOCX con la librería `docx`: estilos reales, numeración, tablas, hipervínculos y metadatos. */
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from "docx";
import { parseInline } from "../inline";
import type { DocumentSpec } from "../schema";

const FONT = "Calibri";
const MONO = "Consolas";
const CM25 = 1417; // 2,5 cm en twips

function runs(text: string, base: { bold?: boolean; italics?: boolean; size?: number; color?: string } = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const r of parseInline(text)) {
    const parts = r.text.split("\n");
    const mk = (t: string, br: boolean) =>
      new TextRun({
        text: t,
        break: br ? 1 : undefined,
        bold: r.bold || base.bold,
        italics: r.italic || base.italics,
        font: r.code ? MONO : undefined,
        size: base.size,
        color: r.href ? "0B5CAD" : base.color,
        underline: r.href ? {} : undefined,
        shading: r.code ? { type: ShadingType.CLEAR, fill: "F3F4F6", color: "auto" } : undefined,
      });
    if (r.href) {
      out.push(new ExternalHyperlink({ link: r.href, children: parts.map((t, i) => mk(t, i > 0)) }));
    } else parts.forEach((t, i) => out.push(mk(t, i > 0)));
  }
  return out.length ? out : [new TextRun("")];
}

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4];

export async function renderDocx(spec: DocumentSpec): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];
  const numbering: { reference: string; levels: { level: number; format: (typeof LevelFormat)[keyof typeof LevelFormat]; text: string; alignment: (typeof AlignmentType)[keyof typeof AlignmentType]; style: { paragraph: { indent: { left: number; hanging: number } } } }[] }[] = [];
  const mkLevels = (fmt1: "decimal" | "bullet") => [
    { level: 0, format: fmt1 === "decimal" ? LevelFormat.DECIMAL : LevelFormat.BULLET, text: fmt1 === "decimal" ? "%1." : "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
    { level: 1, format: fmt1 === "decimal" ? LevelFormat.LOWER_LETTER : LevelFormat.BULLET, text: fmt1 === "decimal" ? "%2)" : "–", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
  ];
  numbering.push({ reference: "bullets", levels: mkLevels("bullet") });

  const hasCover = !!(spec.subtitle || spec.author || spec.date);
  children.push(new Paragraph({ style: "Title", alignment: hasCover ? AlignmentType.CENTER : AlignmentType.LEFT, spacing: hasCover ? { before: 4800, after: 240 } : undefined, children: [new TextRun(spec.title)] }));
  if (spec.subtitle) children.push(new Paragraph({ style: "Subtitle", alignment: AlignmentType.CENTER, children: [new TextRun(spec.subtitle)] }));
  if (spec.author) children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 480 }, children: [new TextRun({ text: spec.author, size: 26 })] }));
  if (spec.date) children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: spec.date, size: 24, color: "595959" })] }));
  let pendingBreak = hasCover;

  const border = { style: BorderStyle.SINGLE, size: 4, color: "8C96A3" };
  const borders = { top: border, bottom: border, left: border, right: border };
  let listN = 0;

  for (const b of spec.blocks) {
    const pageBreakBefore = pendingBreak;
    pendingBreak = false;
    switch (b.type) {
      case "heading":
        children.push(new Paragraph({ heading: HEADINGS[b.level - 1], pageBreakBefore, children: runs(b.text) }));
        break;
      case "paragraph":
        children.push(new Paragraph({ pageBreakBefore, children: runs(b.text) }));
        break;
      case "quote":
        children.push(new Paragraph({ style: "Quote", pageBreakBefore, children: runs(b.text, { italics: true }) }));
        break;
      case "code": {
        const lines = b.text.split("\n");
        lines.forEach((l, i) =>
          children.push(
            new Paragraph({
              style: "CodeBlock",
              pageBreakBefore: pageBreakBefore && i === 0,
              children: [new TextRun({ text: l === "" ? " " : l, font: MONO, size: 19 })],
            }),
          ),
        );
        break;
      }
      case "list": {
        let ref = "bullets";
        if (b.ordered) {
          ref = `ordered-${++listN}`; // numeración independiente: cada lista reinicia en 1
          numbering.push({ reference: ref, levels: mkLevels("decimal") });
        }
        let first = true;
        for (const it of b.items) {
          const text = typeof it === "string" ? it : it.text;
          children.push(new Paragraph({ numbering: { reference: ref, level: 0 }, pageBreakBefore: pageBreakBefore && first, children: runs(text) }));
          first = false;
          if (typeof it !== "string") {
            for (const s of it.items) children.push(new Paragraph({ numbering: { reference: ref, level: 1 }, children: runs(s) }));
          }
        }
        break;
      }
      case "table": {
        const cols = b.header.length;
        const w = Math.floor(9000 / cols);
        const cellFor = (t: string, head: boolean) =>
          new TableCell({
            borders,
            width: { size: w, type: WidthType.DXA },
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
            shading: head ? { type: ShadingType.CLEAR, fill: "E8EDF3", color: "auto" } : undefined,
            children: [new Paragraph({ spacing: { after: 0 }, children: runs(t, { bold: head, size: cols > 6 ? 18 : 21 }) })],
          });
        if (pageBreakBefore) children.push(new Paragraph({ pageBreakBefore: true, children: [] }));
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            columnWidths: b.header.map(() => w),
            rows: [
              new TableRow({ tableHeader: true, cantSplit: true, children: b.header.map((h) => cellFor(h, true)) }),
              ...b.rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c) => cellFor(c, false)) })),
            ],
          }),
          new Paragraph({ spacing: { after: 120 }, children: [] }),
        );
        break;
      }
      case "pagebreak":
        pendingBreak = true;
        break;
    }
  }

  const doc = new Document({
    creator: spec.author ?? "Jarvis",
    title: spec.title,
    description: spec.subtitle ?? "",
    lastModifiedBy: "Jarvis",
    styles: {
      default: { document: { run: { font: FONT, size: 22, language: { value: "es-ES" } }, paragraph: { spacing: { after: 140, line: 276 } } } },
      paragraphStyles: [
        { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 56, bold: true, color: "14213D" }, paragraph: { spacing: { after: 200 } } },
        { id: "Subtitle", name: "Subtitle", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 32, color: "4B5563" }, paragraph: { spacing: { after: 200 } } },
        { id: "Heading1", name: "heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 36, bold: true, color: "14213D" }, paragraph: { spacing: { before: 360, after: 140 }, keepNext: true, outlineLevel: 0 } },
        { id: "Heading2", name: "heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 30, bold: true, color: "1F3A5F" }, paragraph: { spacing: { before: 280, after: 120 }, keepNext: true, outlineLevel: 1 } },
        { id: "Heading3", name: "heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 26, bold: true, color: "1F3A5F" }, paragraph: { spacing: { before: 240, after: 100 }, keepNext: true, outlineLevel: 2 } },
        { id: "Heading4", name: "heading 4", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 23, bold: true, italics: true, color: "1F3A5F" }, paragraph: { spacing: { before: 200, after: 80 }, keepNext: true, outlineLevel: 3 } },
        { id: "Quote", name: "Quote", basedOn: "Normal", next: "Normal", quickFormat: true, run: { italics: true, color: "374151" }, paragraph: { indent: { left: 567 }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: "8AA0B8", space: 8 } }, spacing: { before: 100, after: 140 } } },
        { id: "CodeBlock", name: "Code Block", basedOn: "Normal", quickFormat: true, run: { font: MONO, size: 19 }, paragraph: { spacing: { after: 0, line: 240 }, shading: { type: ShadingType.CLEAR, fill: "F3F4F6", color: "auto" }, indent: { left: 120, right: 120 } } },
      ],
    },
    numbering: { config: numbering },
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: CM25, bottom: CM25, left: CM25, right: CM25 } } },
        footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "6B7280" })] })] }) },
        children,
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}
