/**
 * Datos puros (sin Node) para la tarjeta de confirmación de "Crear documento": nombres legibles de los
 * formatos y estimación del PEOR caso de coste de la redacción con IA. Seguro para el bundle del cliente.
 */
export const FORMAT_NAMES: Record<string, string> = {
  docx: "Word",
  pdf: "PDF",
  xlsx: "Excel",
  pptx: "PowerPoint",
  md: "Markdown",
  html: "HTML",
  txt: "texto",
  csv: "CSV",
};

/** USD por millón de tokens (entrada, salida). Modelo desconocido => precios de Sonnet. */
const PRICES: { match: RegExp; input: number; output: number }[] = [
  { match: /haiku/i, input: 0.1, output: 0.5 },
  { match: /opus/i, input: 10, output: 50 }, // aproximado: solo para no subestimar
  { match: /sonnet/i, input: 2, output: 10 },
];
const FALLBACK = { input: 2, output: 10 };

export function priceFor(model: string): { input: number; output: number } {
  const p = PRICES.find((x) => x.match.test(model));
  return p ?? FALLBACK;
}

/** Tokens de entrada del peor caso: prompt fijo + brief + cuerpo de skill (máx. 20.000 caracteres ~ 7.000 tokens). */
export function estimateInputTokens(briefChars: number, hasSkill: boolean): number {
  return 700 + Math.ceil(briefChars / 3) + (hasSkill ? 7000 : 0);
}

/** Coste máximo en USD de una redacción: toda la entrada + `maxTokens` de salida. */
export function estimateDocCost(model: string, maxTokens: number, briefChars: number, hasSkill: boolean): number {
  const p = priceFor(model);
  return (estimateInputTokens(briefChars, hasSkill) * p.input + maxTokens * p.output) / 1_000_000;
}

export function formatUsd(n: number): string {
  if (n < 0.01) return "$0,01";
  return `$${n.toFixed(2).replace(".", ",")}`;
}

// El cliente conoce el modelo de documentos y el tope de tokens por GET /api/settings; la página los fija aquí
// para que la tarjeta calcule con ellos. Por defecto: Sonnet y 6000 tokens.
const ctx = { model: "anthropic/claude-sonnet-5.5", maxTokens: 6000 };
export function setDocCostContext(model: string | undefined, maxTokens: number | undefined) {
  if (model && typeof model === "string") ctx.model = model;
  if (typeof maxTokens === "number" && Number.isFinite(maxTokens)) ctx.maxTokens = maxTokens;
}
export function currentDocCostContext() {
  return { ...ctx };
}
