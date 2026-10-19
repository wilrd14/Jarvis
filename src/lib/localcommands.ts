// Órdenes instantáneas sin IA: reconoce órdenes frecuentes en español natural y devuelve la misma
// forma que el cerebro ({reply, action}) sin llamar a ningún modelo (cero gasto, respuesta inmediata).
//
// Módulo PURO (sin red ni disco): se prueba con tests/localcommands.mjs. Reglas ESTRICTAS: la frase
// entera, sin muletillas de cortesía, debe ser claramente una orden. Ante cualquier duda devuelve
// null y el mensaje sigue el flujo normal con el cerebro. Las acciones se validan con parseAction
// del registro y se reutilizan las tablas de alias de open-app/open-folder (no se duplican).
// Compatible con el type-stripping de Node: sin enums ni "parameter properties".
import { parseAction, type AssistantAction } from "./actions";
import { APP_ALIASES } from "./actions/open-app";
import { FOLDER_ALIASES } from "./actions/open-folder";
import { resolveAlias } from "./actions/pc-shared";
import { TIMEZONE } from "./config";

/**
 * Textos que Jarvis dice en las órdenes locales. Conjunto pequeño y FIJO para que se puedan
 * cachear como audio (una vez generada la voz, se reutiliza gratis):
 *  - `fixed`: una frase por clave; `variants`: varias frases entre las que se elige una al azar.
 *  - `dynamic`: las dos únicas respuestas que dependen del reloj (hora y fecha); sus huecos {…}
 *    se rellenan en el momento. Se pueden cachear por minuto/día, pero no de antemano.
 * Las frases de acciones que piden confirmación NO dicen que ya está hecho: la dejan lista.
 */
export const LOCAL_REPLY_TEMPLATES = {
  fixed: {
    volume_up: "Te dejo listo subir el volumen, solo falta que lo confirmes.",
    volume_down: "Te dejo listo bajar el volumen, solo falta que lo confirmes.",
    volume_set: "Te dejo listo el ajuste del volumen, solo falta que lo confirmes.",
    volume_mute: "Te dejo listo el silencio, solo falta que lo confirmes.",
    volume_unmute: "Te dejo listo quitar el silencio, solo falta que lo confirmes.",
    open_folder: "Te dejo lista la carpeta para que la abras, solo falta que lo confirmes.",
    open_app: "Te dejo lista la aplicación para que la abras, solo falta que lo confirmes.",
    screenshot: "Te dejo lista la captura de pantalla, solo falta que lo confirmes.",
    lock_screen: "Te dejo listo el bloqueo de la pantalla, solo falta que lo confirmes.",
    timer_start: "Listo, temporizador en marcha.",
    timer_cancel: "Vale, cancelo el temporizador.",
    note_add: "Anotado.",
    note_list: "Reviso tus notas.",
  },
  variants: {
    greeting: [
      "Hola, William. ¿En qué te ayudo?",
      "¡Hola! Aquí estoy.",
      "Hola, ¿qué necesitas?",
      "Buenas, William. Dime.",
    ],
    thanks: ["De nada, William.", "Para eso estoy.", "Un placer.", "No hay de qué."],
  },
  dynamic: {
    time: "Son las {hora} (o «Es la una …»), p. ej. «Son las tres y veinticinco de la tarde.»",
    date: "Hoy es {día de la semana} {día} de {mes} de {año}.",
  },
} as const;

/** Todas las frases fijas posibles (para pre-generar su audio). */
export const LOCAL_FIXED_REPLIES: readonly string[] = [
  ...Object.values(LOCAL_REPLY_TEMPLATES.fixed),
  ...LOCAL_REPLY_TEMPLATES.variants.greeting,
  ...LOCAL_REPLY_TEMPLATES.variants.thanks,
];

export interface LocalCommandMatch {
  reply: string;
  action: AssistantAction | null;
  /** Identificador de la orden reconocida (para diagnóstico y pruebas). */
  command: string;
}

// ---------- Normalización ----------

interface Tok {
  /** Palabra original (para conservar el texto de una nota). */
  raw: string;
  /** Minúsculas, sin acentos ni puntuación en los extremos. */
  n: string;
}

function tokenize(message: string): Tok[] {
  const out: Tok[] = [];
  for (const raw of message.trim().split(/\s+/)) {
    const n = raw
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/^[^a-z0-9ñ]+|[^a-z0-9ñ]+$/g, "");
    if (n) out.push({ raw, n });
  }
  return out;
}

const LEAD_PHRASES: string[][] = [
  ["por", "favor"], ["porfa"], ["porfavor"], ["jarvis"], ["oye"], ["ok"], ["okay"], ["vale"], ["bueno"],
  ["entonces"], ["ahora"], ["ya"], ["me", "puedes"], ["me", "podes"], ["me", "podrias"], ["puedes"],
  ["podes"], ["podrias"], ["quiero", "que", "me"], ["quiero", "que"], ["necesito", "que", "me"],
  ["necesito", "que"], ["quisiera"],
];
const TRAIL_PHRASES: string[][] = [
  ["por", "favor"], ["porfa"], ["porfavor"], ["jarvis"], ["ahora", "mismo"], ["ahora"], ["ya"],
];

function startsWith(toks: Tok[], at: number, phrase: string[]): boolean {
  return phrase.every((w, i) => toks[at + i]?.n === w) && at + phrase.length <= toks.length;
}

/** Quita muletillas de cortesía del principio y del final ("oye jarvis", "por favor"...). */
function stripFiller(toks: Tok[], trailing = true): Tok[] {
  let t = toks;
  for (let changed = true; changed; ) {
    changed = false;
    for (const p of LEAD_PHRASES) {
      if (startsWith(t, 0, p) && t.length > p.length) {
        t = t.slice(p.length);
        changed = true;
      }
    }
    for (const p of trailing ? TRAIL_PHRASES : []) {
      if (t.length > p.length && startsWith(t, t.length - p.length, p)) {
        t = t.slice(0, t.length - p.length);
        changed = true;
      }
    }
  }
  return t;
}

// ---------- Números en español ----------

const UNITS: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8,
  nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16,
  diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21,
  veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27,
  veintiocho: 28, veintinueve: 29,
};
const TENS: Record<string, number> = {
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
};
const HUNDREDS: Record<string, number> = {
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300,
  cuatrocientos: 400, cuatrocientas: 400, quinientos: 500, quinientas: 500, seiscientos: 600,
  seiscientas: 600, setecientos: 700, setecientas: 700, ochocientos: 800, ochocientas: 800,
  novecientos: 900, novecientas: 900,
};

/** Toma el número más largo que empiece en `i` (cifras o palabras, hasta 999). */
function takeNumber(w: string[], i: number): { value: number; next: number } | null {
  const first = w[i];
  if (first === undefined) return null;
  if (/^\d{1,5}$/.test(first)) return { value: Number(first), next: i + 1 };
  let value = 0;
  let j = i;
  let any = false;
  if (w[j] !== undefined && Object.hasOwn(HUNDREDS, w[j])) {
    value += HUNDREDS[w[j]];
    j++;
    any = true;
  }
  if (w[j] !== undefined && Object.hasOwn(TENS, w[j])) {
    value += TENS[w[j]];
    j++;
    any = true;
    if (w[j] === "y" && w[j + 1] !== undefined && Object.hasOwn(UNITS, w[j + 1]) && UNITS[w[j + 1]] >= 1 && UNITS[w[j + 1]] <= 9) {
      value += UNITS[w[j + 1]];
      j += 2;
    }
  } else if (w[j] !== undefined && Object.hasOwn(UNITS, w[j])) {
    value += UNITS[w[j]];
    j++;
    any = true;
  }
  return any ? { value, next: j } : null;
}

/** Número que ocupa TODOS los tokens, o null. */
export function parseSpanishNumber(words: string[]): number | null {
  const r = takeNumber(words, 0);
  return r && r.next === words.length ? r.value : null;
}

const HOUR_UNITS = new Set(["hora", "horas", "h", "hr", "hrs"]);
const MIN_UNITS = new Set(["minuto", "minutos", "min", "mins"]);
const SEC_UNITS = new Set(["segundo", "segundos", "seg", "segs", "s"]);

/** Duración en segundos ("cinco minutos", "dos horas y media", "un cuarto de hora"...) o null. */
export function parseDuration(words: string[]): number | null {
  const w: string[] = [];
  for (const t of words) {
    const m = /^(\d+)([a-z]+)$/.exec(t); // "5min" -> "5" "min"
    if (m) w.push(m[1], m[2]);
    else w.push(t);
  }
  let total = 0;
  let i = 0;
  const used = new Set<string>();
  const claim = (u: string) => {
    if (used.has(u)) return false;
    used.add(u);
    return true;
  };
  while (i < w.length) {
    if (total > 0 || used.size) {
      if (w[i] === "y" || w[i] === "con") i++;
      if (i >= w.length) return null; // conector colgando
    }
    if (w[i] === "media" && w[i + 1] === "hora") {
      if (!claim("h")) return null;
      total += 1800;
      i += 2;
      continue;
    }
    if (w[i] === "medio" && w[i + 1] === "minuto") {
      if (!claim("m")) return null;
      total += 30;
      i += 2;
      continue;
    }
    if (w[i] === "cuarto" && w[i + 1] === "de" && w[i + 2] === "hora") {
      if (!claim("h")) return null;
      total += 900;
      i += 3;
      continue;
    }
    const num = takeNumber(w, i);
    if (!num) return null;
    let j = num.next;
    if ((w[j] === "cuarto" || w[j] === "cuartos") && w[j + 1] === "de" && w[j + 2] === "hora") {
      if (num.value < 1 || num.value > 3 || !claim("h")) return null;
      total += num.value * 900;
      i = j + 3;
      continue;
    }
    const unit = w[j];
    if (unit === undefined) return null;
    const kind = HOUR_UNITS.has(unit) ? "h" : MIN_UNITS.has(unit) ? "m" : SEC_UNITS.has(unit) ? "s" : null;
    if (!kind || !claim(kind)) return null;
    total += num.value * (kind === "h" ? 3600 : kind === "m" ? 60 : 1);
    j++;
    if (w[j] === "y" && (w[j + 1] === "media" || w[j + 1] === "medio") && kind !== "s") {
      total += kind === "h" ? 1800 : 30;
      j += 2;
    } else if (w[j] === "y" && w[j + 1] === "cuarto" && kind === "h" && !(w[j + 2] === "de")) {
      total += 900;
      j += 2;
    }
    i = j;
  }
  return total >= 1 && total <= 86400 ? total : null;
}

// ---------- Hora y fecha habladas ----------

const WORDS_0_29 = [
  "cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce",
  "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiuno",
  "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve",
];
const TENS_WORDS: Record<number, string> = { 30: "treinta", 40: "cuarenta", 50: "cincuenta" };

function wordsUpTo59(n: number): string {
  if (n < 30) return WORDS_0_29[n];
  const t = Math.floor(n / 10) * 10;
  return n === t ? TENS_WORDS[t] : `${TENS_WORDS[t]} y ${WORDS_0_29[n - t]}`;
}

function zoneParts(now: Date, opts: Intl.DateTimeFormatOptions, locale: string) {
  const parts = new Intl.DateTimeFormat(locale, { timeZone: TIMEZONE, ...opts }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return get;
}

/** "Son las tres y veinticinco de la tarde." (hora real en la zona TIMEZONE). */
export function spokenTime(now: Date): string {
  const get = zoneParts(now, { hour: "numeric", minute: "numeric", hourCycle: "h23" }, "en-GB");
  const h = Number(get("hour")) % 24;
  const m = Number(get("minute"));
  const period = h < 6 ? "de la madrugada" : h < 12 ? "de la mañana" : h === 12 ? "del mediodía" : h < 20 ? "de la tarde" : "de la noche";
  const toHour12 = (x: number) => ((x % 12) || 12);
  let shown = toHour12(h);
  let minutes: string;
  if (m === 0) minutes = "en punto";
  else if (m === 15) minutes = "y cuarto";
  else if (m === 30) minutes = "y media";
  else if (m < 30) minutes = `y ${wordsUpTo59(m)}`;
  else {
    shown = toHour12(h + 1);
    minutes = m === 45 ? "menos cuarto" : `menos ${wordsUpTo59(60 - m)}`;
  }
  const hourWord = shown === 1 ? "una" : WORDS_0_29[shown];
  return `${shown === 1 ? "Es la" : "Son las"} ${hourWord} ${minutes} ${period}.`;
}

/** "Hoy es lunes 19 de octubre de 2026." */
export function spokenDate(now: Date): string {
  const get = zoneParts(now, { weekday: "long", day: "numeric", month: "long", year: "numeric" }, "es-AR");
  return `Hoy es ${get("weekday")} ${get("day")} de ${get("month")} de ${get("year")}.`;
}

// ---------- Reconocedores ----------

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];
const text = (w: string[]) => w.join(" ");

function result(command: string, reply: string, rawAction: unknown): LocalCommandMatch | null {
  if (rawAction === null) return { reply, action: null, command };
  const action = parseAction(rawAction);
  return action ? { reply, action, command } : null; // si el registro no la valida, no es local
}

const F = LOCAL_REPLY_TEMPLATES.fixed;

const SET_PRE = new Set([
  "pon", "pone", "ponme", "ponlo", "fija", "fijar", "deja", "dejalo", "ajusta", "ajustar", "cambia", "cambiar",
  "establece", "coloca", "regula", "el", "lo", "la", "un", "poco", "poquito", "de", "al", "mas", "menos",
  "sube", "subir", "subi", "subele", "subelo", "aumenta", "aumentar", "baja", "bajar", "bajale", "bajalo",
  "reduce", "reducir", "disminuye", "disminuir",
]);
const UP_MARK = new Set(["sube", "subir", "subi", "subele", "subelo", "aumenta", "aumentar", "mas"]);
const DOWN_MARK = new Set(["baja", "bajar", "bajale", "bajalo", "reduce", "reducir", "disminuye", "disminuir", "menos"]);

function matchVolume(w: string[]): LocalCommandMatch | null {
  const s = text(w);
  if (/^(?:silencio|silenciar|silencia|mutea|mutear|mute|modo silencio|sin sonido|(?:pon|pone|ponlo|ponme|deja|dejalo)(?: el| lo)?(?: sonido| pc| volumen| equipo)? en silencio|(?:silencia|silenciar|quita|quitar|apaga|apagar|corta|cortar)(?: el| todo el)? (?:sonido|volumen|audio))$/.test(s)) {
    return result("volume_mute", F.volume_mute, { type: "volume", mode: "mute" });
  }
  if (/^(?:desmutea|desmutear|(?:quita|quitar|quitale|saca|sacale|desactiva|desactivar|anula|apaga|apagar)(?: el)? (?:silencio|mute|modo silencio)|(?:activa|activar|reactiva|reactivar|restaura|devuelve|enciende)(?: el)? (?:sonido|audio))$/.test(s)) {
    return result("volume_unmute", F.volume_unmute, { type: "volume", mode: "unmute" });
  }

  const v = w.findIndex((x) => x === "volumen" || x === "sonido");
  if (v < 0) return null;
  const pre = w.slice(0, v);
  const rest = w.slice(v + 1);
  if (!pre.every((x) => SET_PRE.has(x))) return null;

  // Nivel concreto: "volumen al 30", "pon el volumen en cincuenta por ciento", "volumen al máximo".
  let r = rest;
  while (r.length && ["a", "al", "en", "hasta", "el", "un", "la"].includes(r[0]) && r.length > 1) r = r.slice(1);
  if (r.length > 2 && r[r.length - 2] === "por" && r[r.length - 1] === "ciento") r = r.slice(0, -2);
  if (rest.length) {
    let level: number | null = null;
    if (r.length === 1 && (r[0] === "maximo" || r[0] === "maxima")) level = 100;
    else if (r.length === 1 && (r[0] === "minimo" || r[0] === "minima")) level = 0;
    else if (r.length === 1 && r[0] === "mitad") level = 50;
    else level = parseSpanishNumber(r);
    if (level !== null && level >= 0 && level <= 100) {
      return result("volume_set", F.volume_set, { type: "volume", mode: "set", level });
    }
  }

  // Subir/bajar sin cifra.
  let neutral = false;
  let dir: "up" | "down" | null = null;
  const rs = text(rest);
  if (rs === "" || rs === "un poco" || rs === "un poquito" || rs === "mas") neutral = true;
  else if (rs === "arriba" || rs === "mas alto") dir = "up";
  else if (rs === "abajo" || rs === "mas bajo") dir = "down";
  else return null;
  if (neutral) {
    const up = pre.some((x) => UP_MARK.has(x));
    const down = pre.some((x) => DOWN_MARK.has(x));
    if (up === down) return null;
    dir = up ? "up" : "down";
  } else if (pre.some((x) => (dir === "up" ? DOWN_MARK : UP_MARK).has(x))) {
    return null;
  }
  return dir === "up"
    ? result("volume_up", F.volume_up, { type: "volume", mode: "up" })
    : result("volume_down", F.volume_down, { type: "volume", mode: "down" });
}

const OPEN_VERBS = new Set(["abre", "abri", "abrime", "abreme", "abrir", "ejecuta", "ejecutar", "lanza", "lanzar", "inicia", "iniciar", "arranca"]);
const ARTICLES = new Set(["el", "la", "los", "las", "mi", "mis", "un", "una"]);

function matchOpen(w: string[]): LocalCommandMatch | null {
  if (!w.length || !OPEN_VERBS.has(w[0])) return null;
  let r = w.slice(1);
  while (r.length && ARTICLES.has(r[0])) r = r.slice(1);
  let only: "folder" | "app" | null = null;
  if (r[0] === "carpeta") {
    only = "folder";
    r = r.slice(1);
  } else if (r[0] === "app" || r[0] === "aplicacion" || r[0] === "programa") {
    only = "app";
    r = r.slice(1);
  }
  if (only) {
    if (r[0] === "de") r = r.slice(1);
    while (r.length && ARTICLES.has(r[0])) r = r.slice(1);
  }
  if (!r.length) return null; // "abre" sin destino
  const target = text(r);
  if (only !== "app") {
    const folder = resolveAlias(target, FOLDER_ALIASES);
    if (folder) return result("open_folder", F.open_folder, { type: "open_folder", folder });
  }
  if (only !== "folder") {
    const app = resolveAlias(target, APP_ALIASES);
    if (app) return result("open_app", F.open_app, { type: "open_app", app });
  }
  return null;
}

function matchTimer(w: string[]): LocalCommandMatch | null {
  const s = text(w);
  if (/^(?:cancela|cancelar|para|parar|deten|detener|quita|quitar|elimina|eliminar|borra|borrar|apaga|apagar)(?: el| los| mi| mis)? temporizador(?:es)?$/.test(s)) {
    return result("timer_cancel", F.timer_cancel, { type: "timer_cancel" });
  }
  const t = w.findIndex((x) => x === "temporizador");
  if (t < 0) return null;
  const PRE = new Set([
    "pon", "pone", "ponme", "poneme", "ponga", "poner", "activa", "activame", "activar", "inicia", "iniciame",
    "iniciar", "crea", "creame", "crear", "programa", "programame", "programar", "arranca", "empieza", "lanza",
    "configura", "configurar", "quiero", "necesito", "tener", "haz", "hazme", "hacer", "dame", "un", "el", "me",
    "uno", "otro",
  ]);
  if (t > 4 || !w.slice(0, t).every((x) => PRE.has(x))) return null;
  let rest = w.slice(t + 1);
  if (["de", "para", "por", "en", "a"].includes(rest[0])) rest = rest.slice(1);
  const seconds = parseDuration(rest);
  if (seconds === null) return null;
  return result("timer_start", F.timer_start, { type: "timer_start", seconds });
}

const NOTE_VERBS = new Set(["anota", "apunta", "anotame", "apuntame"]);
const NOTE_BAD_START = new Set(["a", "al", "hacia", "con", "en", "bien", "mas"]);

function matchNote(toks: Tok[]): LocalCommandMatch | null {
  const w = toks.map((t) => t.n);
  const nota = (i: number) => w[i] === "nota" || w[i] === "notas";
  let i = -1;
  if (NOTE_VERBS.has(w[0])) {
    i = 1;
    if (w[i] === "una" && nota(i + 1)) i += 2;
    else if (w[i] === "que" || w[i] === "esto") i += 1;
    else if (w[i] === "lo" && w[i + 1] === "siguiente") i += 2;
    else if (w[i] === "lo" || NOTE_BAD_START.has(w[i])) return null;
  } else if (w[0] === "toma" && nota(1)) {
    i = 2;
    if (w[i] === "de" || w[i] === "que") i += 1;
  } else if (["guarda", "crea", "agrega", "anade", "nueva"].includes(w[0])) {
    // "guarda una nota ...", "crea una nota ...", "nueva nota ..."
    if (w[0] === "nueva" && nota(1)) i = 2;
    else if (w[1] === "una" && nota(2)) i = 3;
    else return null;
    if (w[i] === "que" || w[i] === "de") i += 1;
  } else return null;

  const body = toks.slice(i);
  if (!body.length) return null; // "anota" sin contenido
  const content = body.map((t) => t.raw).join(" ").replace(/^[:,;\s-]+/, "").trim();
  const norm = body.map((t) => t.n);
  if (content.length < 3 || content.length > 600 || norm.length > 80) return null;
  if (!/[a-z0-9ñ]{2}/i.test(content.normalize("NFD").replace(/\p{M}/gu, ""))) return null;
  // Contenido vacío de significado ("anota algo", "anota eso") o que en realidad pide un recordatorio.
  if (norm.length <= 2 && norm.every((x) => ["algo", "eso", "esto", "nota", "una", "que", "por", "favor"].includes(x))) return null;
  if (/^(?:me|recordar|recuerdame|avisame|recordarme)$/.test(norm[0]) && /recuerd|avis|record/.test(norm.slice(0, 3).join(" "))) return null;
  return result("note_add", F.note_add, { type: "note_add", text: content });
}

function matchNoteList(w: string[]): LocalCommandMatch | null {
  const s = text(w);
  if (/^(?:que notas tengo|cuales son mis notas|mis notas|(?:lista|listame|dime|dame|lee|leeme|muestra|muestrame|ensename|revisa)(?: las| mis| todas mis| todas las)? notas|que tengo anotado|que he anotado|que anote)$/.test(s)) {
    return result("note_list", F.note_list, { type: "note_list" });
  }
  return null;
}

const TIME_PRE = "(?:(?:me )?(?:dices|dime|decime|di|decir|decirme|puedes decirme|podes decirme|podrias decirme|sabes) )?";
const TIME_RE = new RegExp(`^${TIME_PRE}(?:que hora es|que hora tenemos|que hora son|que horas son|la hora(?: actual| exacta)?|cual es la hora(?: actual)?|hora actual)(?: ahora| actualmente| ahora mismo| en este momento)?$`);
const DATE_RE = new RegExp(`^${TIME_PRE}(?:que dia es(?: hoy)?|que dia es el dia de hoy|que dia es el de hoy|que fecha es(?: hoy)?|que dia tenemos(?: hoy)?|que dia estamos|(?:en |a )?que fecha estamos|a cuanto estamos|la fecha(?: de hoy| actual)?|cual es la fecha(?: de hoy| actual)?|la fecha de hoy)$`);

const GREETINGS = new Set([
  "hola", "holi", "holas", "buenas", "hey", "ey", "buen dia", "buenos dias", "buenas tardes", "buenas noches",
  "hola buenas", "hola buenos dias", "hola buenas tardes", "hola buenas noches", "hola que tal", "que tal",
]);
const THANKS_RE = /^(?:(?:perfecto|genial|excelente|listo|vale|buenisimo) )?(?:muchas |mil |muchisimas |un millon de )?gracias(?: por todo| por la ayuda| de nuevo)?$/;

/**
 * Reconoce una orden local en `message`. `now` solo se usa para la hora/fecha.
 * Devuelve null si la frase no es CLARAMENTE una orden de las soportadas.
 */
export function matchLocalCommand(message: string, now: Date = new Date()): LocalCommandMatch | null {
  if (typeof message !== "string" || message.length > 1500) return null;
  const all = tokenize(message);
  if (!all.length || all.length > 90) return null;
  const toks = stripFiller(all);
  if (!toks.length) return null;
  const w = toks.map((t) => t.n);
  const s = text(w);

  // Notas primero: su contenido es libre y no debe confundirse con otras órdenes.
  const note = matchNote(stripFiller(all, false)); // el contenido de una nota conserva su final
  if (note) return note;
  if (NOTE_VERBS.has(w[0]) || (w[0] === "toma" && w[1] === "nota")) return null; // intento de nota dudoso

  if (w.length > 14) return null; // el resto son órdenes cortas
  if (TIME_RE.test(s)) return { reply: spokenTime(now), action: null, command: "time" };
  if (DATE_RE.test(s)) return { reply: spokenDate(now), action: null, command: "date" };
  if (GREETINGS.has(s)) return { reply: pick(LOCAL_REPLY_TEMPLATES.variants.greeting), action: null, command: "greeting" };
  if (THANKS_RE.test(s)) return { reply: pick(LOCAL_REPLY_TEMPLATES.variants.thanks), action: null, command: "thanks" };

  if (/^(?:(?:haz|hace|hazme|toma|tomame|tomar|saca|sacame|sacar|hacer|realiza)(?: una| un)? (?:captura(?: de (?:la )?pantalla)?|screenshot|pantallazo|foto de la pantalla)|captura de (?:la )?pantalla|captura la pantalla|screenshot|pantallazo)$/.test(s)) {
    return result("screenshot", F.screenshot, { type: "screenshot" });
  }
  if (/^(?:bloquea|bloquear|bloqueame)(?: el| la| mi)? (?:pantalla|pc|ordenador|computadora|compu|computador|equipo|sesion|windows|laptop|portatil)$/.test(s)) {
    return result("lock_screen", F.lock_screen, { type: "lock_screen" });
  }

  return matchNoteList(w) ?? matchTimer(w) ?? matchOpen(w) ?? matchVolume(w);
}
