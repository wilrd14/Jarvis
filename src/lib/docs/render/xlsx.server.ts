/**
 * XLSX con exceljs. Cada tabla -> una hoja (cabecera en negrita, anchos razonables, fila congelada).
 * Sin tablas: hoja "Documento" con el texto. SEGURIDAD: las celdas siempre se escriben como texto
 * (cadena compartida con formato Texto "@"), jamás como fórmula, aunque empiecen por = + - @ tab o CR.
 */
import ExcelJS from "exceljs";
import { inlineToPlain, inlineToPlainWithUrls } from "../inline";
import type { Block, DocumentSpec } from "../schema";

const MAX_CELL = 32000; // Excel admite 32.767 caracteres por celda

function sheetName(raw: string, used: Set<string>, fallback: string): string {
  let n = raw.replace(/[\\/?*[\]:]/g, " ").replace(/^'+|'+$/g, "").replace(/\s+/g, " ").trim().slice(0, 31) || fallback;
  if (n.toLowerCase() === "history") n = `${n} 1`;
  let k = 2;
  let cand = n;
  while (used.has(cand.toLowerCase())) {
    const suf = ` (${k++})`;
    cand = n.slice(0, 31 - suf.length) + suf;
  }
  used.add(cand.toLowerCase());
  return cand;
}

/** Valor de celda: número solo si es claramente numérico; todo lo demás, texto literal. */
function cellValue(raw: string): { value: string | number; text: boolean } {
  const s = inlineToPlainWithUrls(raw).slice(0, MAX_CELL);
  if (/^-?(0|[1-9]\d{0,14})([.,]\d{1,6})?$/.test(s)) return { value: Number(s.replace(",", ".")), text: false };
  return { value: s, text: true };
}

function fill(ws: ExcelJS.Worksheet, rows: string[][], headerRow: boolean): void {
  const widths: number[] = [];
  rows.forEach((r, ri) => {
    const row = ws.getRow(ri + 1);
    r.forEach((c, ci) => {
      const { value } = cellValue(c);
      const cell = row.getCell(ci + 1);
      cell.value = value; // string => cadena, nunca { formula }
      if (typeof value === "string") {
        cell.numFmt = "@";
      }
      cell.alignment = { vertical: "top", wrapText: true };
      const len = Math.max(...String(value).split("\n").map((l) => [...l].length));
      widths[ci] = Math.max(widths[ci] ?? 8, Math.min(60, len + 2));
    });
    if (headerRow && ri === 0) {
      row.font = { bold: true, name: "Calibri" };
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EDF3" } };
        cell.border = { bottom: { style: "thin", color: { argb: "FF8C96A3" } } };
      });
    }
  });
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  if (headerRow) ws.views = [{ state: "frozen", ySplit: 1 }];
}

export async function renderXlsx(spec: DocumentSpec): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = spec.author ?? "Jarvis";
  wb.title = spec.title;
  wb.description = spec.subtitle ?? "";
  wb.created = new Date();
  wb.modified = new Date();
  const used = new Set<string>();

  let lastHeading = "";
  let tableN = 0;
  for (const b of spec.blocks) {
    if (b.type === "heading") lastHeading = inlineToPlain(b.text);
    if (b.type !== "table") continue;
    tableN++;
    const ws = wb.addWorksheet(sheetName(lastHeading, used, `Tabla ${tableN}`));
    fill(ws, [b.header, ...b.rows], true);
    lastHeading = "";
  }

  if (tableN === 0) {
    const ws = wb.addWorksheet(sheetName("Documento", used, "Documento"));
    const rows: string[][] = [[spec.title]];
    const push = (b: Block) => {
      if (b.type === "pagebreak") return;
      if (b.type === "list") for (const it of b.items) rows.push([`• ${typeof it === "string" ? it : [it.text, ...it.items.map((s) => `   – ${s}`)].join("\n")}`]);
      else if (b.type === "table") return;
      else rows.push([b.text]);
    };
    spec.blocks.forEach(push);
    fill(ws, rows, false);
    ws.getColumn(1).width = 100;
    ws.getRow(1).font = { bold: true, size: 14, name: "Calibri" };
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}
