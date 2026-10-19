// Extracción incremental del campo "reply" de la respuesta JSON del cerebro y corte en frases.
// Módulo puro (sin dependencias): lo usa /api/brain en streaming y lo prueban tests/streaming.mjs.
//
// El modelo devuelve un objeto {"action":..., "search":..., "reply":"..."} que llega troceado en
// deltas arbitrarios. ReplyStream recorre los caracteres con una máquina de estados que sobrevive a
// cualquier corte (también en medio de un escape \uXXXX) y expone:
//   - los fragmentos nuevos de "reply" ya decodificados,
//   - el texto crudo (acotado) de "action" y "search" cuando terminan de llegar.

const MAX_RAW = 6000;

type Mode =
  | "pre" // antes de la '{' (texto previo o vallas ```json se ignoran)
  | "key" // esperando '"' de una clave o '}'
  | "keystr" // leyendo el nombre de la clave
  | "colon"
  | "valstart"
  | "valstr" // valor string
  | "valraw" // número, literal, objeto o array
  | "comma"
  | "done";

export class ReplyStream {
  private mode: Mode = "pre";
  private key = "";
  private keyBuf = "";
  private esc = false;
  private uni: string | null = null; // dígitos hex acumulados de un \uXXXX
  private depth = 0;
  private rawInStr = false;
  private rawEsc = false;
  private container = false;
  private raw = "";
  /** Texto de "reply" decodificado hasta ahora. */
  reply = "";
  replyStarted = false;
  replyDone = false;
  /** Valores crudos completos de las claves que no son "reply" (acotados). */
  readonly values: Record<string, string> = {};
  objectDone = false;

  /** Procesa un trozo y devuelve el texto nuevo de "reply" que contiene. */
  push(chunk: string): string {
    let out = "";
    for (let i = 0; i < chunk.length; i++) out += this.step(chunk[i]);
    this.reply += out;
    return out;
  }

  private beginValue(c: string) {
    this.raw = "";
    this.depth = 0;
    this.rawInStr = false;
    this.rawEsc = false;
    if (c === '"') {
      this.mode = "valstr";
      this.esc = false;
      this.uni = null;
      if (this.key === "reply") this.replyStarted = true;
      else this.raw = c;
    } else {
      this.mode = "valraw";
      this.container = c === "{" || c === "[";
      this.raw = c;
      if (this.container) this.depth = 1;
    }
  }

  private endValue() {
    if (this.key === "reply") this.replyDone = true;
    else this.values[this.key] = this.raw;
    this.mode = "comma";
  }

  /** Carácter de un valor no-string. Los literales (null, true, 12) acaban en coma, '}' o espacio. */
  private rawChar(c: string): string {
    if (!this.container) {
      if (c === "," || c === "}" || c === " " || c === "\n" || c === "\r" || c === "\t") {
        this.endValue();
        return this.step(c);
      }
      if (this.raw.length < MAX_RAW) this.raw += c;
      return "";
    }
    if (this.raw.length < MAX_RAW) this.raw += c;
    if (this.rawInStr) {
      if (this.rawEsc) this.rawEsc = false;
      else if (c === "\\") this.rawEsc = true;
      else if (c === '"') this.rawInStr = false;
    } else if (c === '"') this.rawInStr = true;
    else if (c === "{" || c === "[") this.depth++;
    else if (c === "}" || c === "]") {
      this.depth--;
      if (this.depth === 0) this.endValue();
    }
    return "";
  }

  private step(c: string): string {
    switch (this.mode) {
      case "pre":
        if (c === "{") this.mode = "key";
        return "";
      case "key":
        if (c === '"') {
          this.mode = "keystr";
          this.keyBuf = "";
        } else if (c === "}") {
          this.mode = "done";
          this.objectDone = true;
        }
        return "";
      case "keystr":
        if (c === '"') {
          this.key = this.keyBuf;
          this.mode = "colon";
        } else if (this.keyBuf.length < 64) this.keyBuf += c;
        return "";
      case "colon":
        if (c === ":") this.mode = "valstart";
        return "";
      case "valstart":
        if (c === " " || c === "\n" || c === "\r" || c === "\t") return "";
        this.beginValue(c);
        return "";
      case "valstr":
        return this.stringChar(c);
      case "valraw":
        return this.rawChar(c);
      case "comma":
        if (c === ",") this.mode = "key";
        else if (c === "}") {
          this.mode = "done";
          this.objectDone = true;
        }
        return "";
      default:
        return "";
    }
  }

  private stringChar(c: string): string {
    const isReply = this.key === "reply";
    if (this.uni !== null) {
      this.uni += c;
      if (this.uni.length === 4) {
        const code = parseInt(this.uni, 16);
        this.uni = null;
        const ch = Number.isNaN(code) ? "" : String.fromCharCode(code);
        if (isReply) return ch;
        this.raw += "\\u" + (Number.isNaN(code) ? "0000" : code.toString(16).padStart(4, "0"));
      }
      return "";
    }
    if (this.esc) {
      this.esc = false;
      if (c === "u") {
        this.uni = "";
        return "";
      }
      const map: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", '"': '"', "\\": "\\", "/": "/" };
      const ch = map[c] ?? c;
      if (isReply) return ch;
      if (this.raw.length < MAX_RAW) this.raw += "\\" + c;
      return "";
    }
    if (c === "\\") {
      this.esc = true;
      return "";
    }
    if (c === '"') {
      if (!isReply && this.raw.length < MAX_RAW) this.raw += '"';
      this.endValue();
      return "";
    }
    if (isReply) return c;
    if (this.raw.length < MAX_RAW) this.raw += c;
    return "";
  }
}

// --- Corte en frases ---------------------------------------------------------------------------

const ABBREVIATIONS = new Set([
  "sr", "sra", "srta", "sres", "dr", "dra", "lic", "ing", "prof", "arq", "mr", "mrs", "ms", "st", "vs",
  "etc", "aprox", "tel", "pág", "pag", "núm", "num", "av", "avda", "dpto", "depto", "ej", "cap", "art",
  "gral", "cía", "ud", "uds", "vd", "vds", "a", "p", "m", "ee", "uu",
]);

export interface SplitOptions {
  /** Longitud mínima de la primera frase (la que decide la latencia hasta el primer sonido). */
  firstMin: number;
  /** Longitud mínima de las siguientes (frases muy cortas se funden con la siguiente). */
  min: number;
  /** Si no hay fin de frase en este largo, se corta en la última coma/espacio. */
  max: number;
}

export const DEFAULT_SPLIT: SplitOptions = { firstMin: 14, min: 40, max: 400 };

/** Corta texto acumulado en frases. Sin dependencias del tiempo: se alimenta con push() y flush(). */
export class SentenceSplitter {
  private buf = "";
  private emitted = 0;
  private readonly opts: SplitOptions;
  constructor(opts: SplitOptions = DEFAULT_SPLIT) {
    this.opts = opts; // sin "parameter properties": el módulo debe poder cargarse con type-stripping de Node
  }

  /** Añade texto y devuelve las frases completas que ya se pueden decir. */
  push(text: string): string[] {
    this.buf += text;
    return this.drain(false);
  }

  /** Fin del texto: devuelve lo que quede (aunque sea corto). */
  flush(): string[] {
    return this.drain(true);
  }

  private drain(final: boolean): string[] {
    const out: string[] = [];
    for (;;) {
      const cut = this.findCut(final);
      if (cut < 0) break;
      const piece = this.buf.slice(0, cut).trim();
      this.buf = this.buf.slice(cut);
      if (piece) {
        out.push(piece);
        this.emitted++;
      }
    }
    if (final) {
      const rest = this.buf.trim();
      this.buf = "";
      if (rest) {
        out.push(rest);
        this.emitted++;
      }
    }
    return out;
  }

  private findCut(final: boolean): number {
    const b = this.buf;
    const min = this.emitted === 0 ? this.opts.firstMin : this.opts.min;
    for (let i = 0; i < b.length; i++) {
      const c = b[i];
      if (c === "\n") {
        if (b.slice(0, i).trim().length >= min) return i + 1;
        continue;
      }
      if (c !== "." && c !== "?" && c !== "!" && c !== "…") continue;
      // Agrupa signos repetidos ("?!", "...", "…").
      let j = i;
      while (j + 1 < b.length && /[.?!…]/.test(b[j + 1])) j++;
      // Cierre opcional de comillas/paréntesis tras el signo.
      let k = j;
      while (k + 1 < b.length && /["'”»)\]]/.test(b[k + 1])) k++;
      if (k + 1 >= b.length) {
        // Sin carácter siguiente: solo se corta al final definitivo (lo hace flush).
        return -1;
      }
      const next = b[k + 1];
      if (!/\s/.test(next)) {
        i = k;
        continue; // "3.5", "ejemplo.com", "Sr.Pérez"
      }
      const head = b.slice(0, i + 1);
      if (c === ".") {
        const word = head.match(/([\p{L}]+)\.*$/u)?.[1]?.toLowerCase() ?? "";
        // Abreviaturas e iniciales ("Sr.", "J. Pérez", "p. ej.").
        if (j === i && (ABBREVIATIONS.has(word) || (word.length === 1 && /\p{L}/u.test(word)))) {
          i = k;
          continue;
        }
        // Un punto seguido de minúscula es continuación, no fin de frase.
        const after = b.slice(k + 1).match(/\S/);
        if (after && /\p{Ll}/u.test(after[0]) && j === i) {
          i = k;
          continue;
        }
      }
      if (b.slice(0, k + 1).trim().length < min) {
        i = k;
        continue; // demasiado corta: se funde con la siguiente
      }
      return k + 1;
    }
    // Frase interminable: corta en la última coma/punto y coma/espacio antes de max.
    if (b.length > this.opts.max) {
      const slice = b.slice(0, this.opts.max);
      const at = Math.max(slice.lastIndexOf(", "), slice.lastIndexOf("; "), slice.lastIndexOf(": "));
      const sp = slice.lastIndexOf(" ");
      const cut = at > 60 ? at + 1 : sp > 60 ? sp : this.opts.max;
      return cut;
    }
    void final;
    return -1;
  }
}

/** Normaliza espacios para comparar la suma de frases con la respuesta final. */
export const normalizeSpaces = (s: string) => s.replace(/\s+/g, " ").trim();
