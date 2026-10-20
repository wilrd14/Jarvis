/**
 * Documentos: crear (Word, PDF, Excel, PowerPoint, Markdown, HTML, texto, CSV), listar y abrir los ya creados.
 * Solo metadatos y validación; la lógica de disco/IA vive en src/lib/docs/create.server.ts y se importa
 * dinámicamente dentro de `run` (nunca entra al bundle del cliente).
 */
import { isRecord, str, type ActionDefinition } from "./types";
import { SERVER_ONLY } from "./pc-shared";
import { FORMAT_NAMES, currentDocCostContext, estimateDocCost, formatUsd } from "../docs/cost";

const FORMATS = ["md", "txt", "html", "docx", "pdf", "xlsx", "pptx", "csv"] as const;
type Format = (typeof FORMATS)[number];
const SKILL_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface DocumentCreateAction {
  type: "document_create";
  format: Format;
  title: string;
  brief?: string;
  markdown?: string;
  skill?: string;
}

export const documentCreateAction: ActionDefinition<DocumentCreateAction> = {
  type: "document_create",
  description:
    'Crear un documento y guardarlo en Documentos\\Jarvis: Word (docx), PDF, Excel (xlsx), PowerPoint (pptx), Markdown (md), HTML, texto (txt) o CSV. ' +
    'ÚSALA cuando el usuario pida crear, generar, redactar o guardar un documento, informe, carta, presentación, tabla, Excel, PDF, Word, etc. ' +
    "Formato: el que pida; si no lo dice, docx para informes y cartas, xlsx para tablas y datos, pptx para presentaciones, pdf si dice \"para enviar\" o \"para imprimir\", md si dice notas o markdown. " +
    '"title" (máx. 200) es el título. Pasa "brief" (máx. 1500 caracteres: de qué trata, para quién, qué secciones, datos que dio el usuario) y un servidor redacta el documento con IA al confirmar: PREFIÉRELO, no escribas tú el documento en la respuesta (es caro y se lee en voz alta). ' +
    'Usa "markdown" (máx. 8000) solo si el usuario dictó el contenido o es corto (menos de 1200 caracteres); entonces se convierte sin IA y es gratis. Debe venir "brief" o "markdown". ' +
    'Si una habilidad de la lista "Habilidades disponibles" encaja (carta, informe, acta...), pon su nombre exacto en "skill". ' +
    "Si falta algo esencial (el tema, o el formato es ambiguo) pregunta antes con action null. " +
    'Si el usuario pide un documento a partir del portapapeles o de un resultado, el texto pegado va en "markdown" solo si es corto; si no, resúmelo en "brief". ' +
    'En "reply" di algo corto como "Te preparé la creación del informe en Word, confírmala y lo redacto". El usuario confirma con un clic.',
  schema: `{ "type": "document_create", "format": "docx", "title": "Informe de ventas de septiembre", "brief": "Informe formal sobre las ventas de septiembre para la gerencia: resumen, resultados por línea, conclusiones.", "skill": "informe-formal" }`,
  risk: "confirm",
  label(a) {
    const ctx = currentDocCostContext();
    const viaAi = !a.markdown;
    const cost = viaAi
      ? `Usará IA para redactarlo (hasta ~${formatUsd(estimateDocCost(ctx.model, ctx.maxTokens, (a.brief ?? "").length, !!a.skill))})`
      : "Sin coste de IA";
    const lines = [`Título: ${a.title}`, `Formato: ${FORMAT_NAMES[a.format] ?? a.format}`, "Carpeta: Documentos\\Jarvis"];
    if (a.skill) lines.push(`Habilidad: ${a.skill}`);
    lines.push(cost);
    return {
      title: "Crear documento",
      detail: lines.join("\n"),
      confirmLabel: "Crear documento",
      busyText: viaAi ? "Redactando… puede tardar hasta un minuto" : "Creando el documento…",
    };
  },
  parse(raw) {
    if (!isRecord(raw)) return null;
    const format = typeof raw.format === "string" ? (FORMATS as readonly string[]).find((f) => f === raw.format) : undefined;
    const title = str(raw.title, 1, 200);
    if (!format || !title || /[\u0000-\u001f]/.test(title)) return null;
    const brief = raw.brief === undefined || raw.brief === null ? undefined : str(raw.brief, 1, 1500);
    const markdown = raw.markdown === undefined || raw.markdown === null ? undefined : str(raw.markdown, 1, 8000);
    if ((raw.brief != null && brief === undefined) || (raw.markdown != null && markdown === undefined)) return null;
    if (!brief && !markdown) return null;
    let skill: string | undefined;
    if (raw.skill !== undefined && raw.skill !== null && raw.skill !== "") {
      skill = str(raw.skill, 1, 64);
      if (!skill || !SKILL_RE.test(skill)) return null;
    }
    const out: DocumentCreateAction = { type: "document_create", format: format as Format, title };
    if (brief) out.brief = brief;
    if (markdown) out.markdown = markdown;
    if (skill) out.skill = skill;
    return out;
  },
  execution: {
    kind: "server",
    timeoutMs: 150_000,
    async run(a, ctx) {
      if (typeof window !== "undefined") return SERVER_ONLY;
      const { createDocument } = await import("../docs/create.server");
      return createDocument(a, ctx);
    },
  },
};

export interface DocumentListAction {
  type: "document_list";
}

export const documentListAction: ActionDefinition<DocumentListAction> = {
  type: "document_list",
  description:
    "Listar los últimos documentos que Jarvis creó (título, formato y fecha). Se ejecuta sola y el resultado se dice en voz alta. Úsala si preguntan qué documentos ha creado o cuál fue el último.",
  schema: `{ "type": "document_list" }`,
  risk: "low",
  label: () => ({ title: "Documentos creados", detail: "Últimos documentos" }),
  parse: (raw) => (isRecord(raw) ? { type: "document_list" } : null),
  execution: {
    kind: "server",
    async run() {
      if (typeof window !== "undefined") return SERVER_ONLY;
      const { listDocuments } = await import("../docs/create.server");
      return listDocuments();
    },
  },
};

export interface DocumentOpenAction {
  type: "document_open";
  id?: string;
}

export const documentOpenAction: ActionDefinition<DocumentOpenAction> = {
  type: "document_open",
  description:
    'Abrir con su aplicación predeterminada un documento YA creado por Jarvis (el último si no das "id"). Solo documentos de la carpeta Documentos\\Jarvis; nunca rutas. El usuario confirma con un clic.',
  schema: `{ "type": "document_open" }`,
  risk: "confirm",
  label: (a) => ({
    title: "Abrir documento",
    detail: a.id ? `Documento ${a.id} de la carpeta Documentos\\Jarvis` : "El último documento creado (carpeta Documentos\\Jarvis)",
    confirmLabel: "Abrir documento",
  }),
  parse(raw) {
    if (!isRecord(raw)) return null;
    if (raw.id === undefined || raw.id === null || raw.id === "") return { type: "document_open" };
    const id = str(raw.id, 8, 32);
    return id && /^[a-f0-9]+$/.test(id) ? { type: "document_open", id } : null;
  },
  execution: {
    kind: "server",
    async run(a) {
      if (typeof window !== "undefined") return SERVER_ONLY;
      const { openDocument } = await import("../docs/create.server");
      return openDocument(a.id);
    },
  },
};

export const documentActions = [documentCreateAction, documentListAction, documentOpenAction] as const;
