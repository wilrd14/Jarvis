// Elige el modelo del cerebro segun la pregunta, SIN llamar a ningun LLM (heuristica pura, sin dependencias).
// Regla de oro: ante la duda, modelo principal. El modelo rapido (Haiku, ~20x mas barato) solo se usa
// cuando hay evidencia positiva de que la peticion es simple: charla corta, trivia corta u orden sencilla,
// y no aparece ninguna senal de que haga falta calidad (redaccion, fechas, razonamiento, calculo, codigo,
// comparaciones, datos actuales, mensajes largos o conversacion tecnica larga).

export type ModelStrategy = "auto" | "main";

export interface RouteTurn {
  role: "user" | "assistant";
  content: string;
}

export interface RouteInput {
  message: string;
  history?: RouteTurn[];
  mainModel: string;
  fastModel: string;
  strategy: ModelStrategy;
}

export interface RouteChoice {
  model: string;
  reason: string;
}

/** Minusculas y sin tildes, para comparar con patrones simples. */
export function norm(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[¿?¡!,;"“”]/g, " ")
    .replace(/\.+(\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const MAX_FAST_WORDS = 14;
const MAX_FAST_CHARS = 110;

// ---- Senales de que hace falta calidad (cualquiera => principal). Texto ya normalizado. ----
const HEAVY: { re: RegExp; reason: string }[] = [
  {
    re: /\b(correo|correos|email|e-mail|mail|redact\w*|carta|discurso|ensayo|articulo|publicacion|post|guion|poema|cuento|historia|parrafo|resum\w*|traduc\w*|reescrib\w*|corrig\w*|mejora (el|este|mi) texto|parafrase\w*)\b/,
    reason: "redaccion o transformacion de texto",
  },
  {
    re: /\b(calendario|evento|agenda|reunion|cita|recordatorio|recordatorios|recuerdame|recordame|avisame|alarma|despiertame|programa (un|una)|agendar?|cancela (el|mi|la) (evento|cita|reunion|recordatorio|alarma)|reprograma\w*)\b/,
    reason: "fechas, horas o recordatorios",
  },
  {
    re: /\b(manana|pasado manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|semana (que viene|proxima|pasada)|proximo (mes|lunes|martes|miercoles|jueves|viernes|sabado|domingo)|fin de semana|en \d+ (dias|semanas|meses|horas)|dentro de \d+|a las \d)/,
    reason: "referencia temporal relativa",
  },
  {
    re: /\b(por que|porque razon|como funciona|como se hace|como puedo|como hago|explica\w*|razona\w*|analiza\w*|demuestra|justifica|argumenta|deduce|piensa|pros y contras|ventajas|desventajas|conviene|deberia|que opinas|que me recomiendas|recomienda\w*|aconseja\w*|sugiere\w*|estrategia|planifica\w*|plan para|ayudame a (decidir|elegir|planear|entender|pensar)|me ayudas a)\b/,
    reason: "razonamiento o consejo",
  },
  {
    re: /\b(compara\w*|comparacion|diferencia(s)? entre|versus|vs|mejor (opcion|que)|cual es mejor|que es mejor|cual conviene)\b/,
    reason: "comparacion",
  },
  {
    re: /\b(calcula\w*|cuanto (es|son|da|seria|cuesta|queda|falta)|cuantos? (dias|horas|minutos|meses|anos|km|kilometros|metros|litros|kilos|gramos)\b.*\b(hay|faltan|pasan|son|entre)|porcentaje|raiz|potencia|derivada|integral|ecuacion|promedio|media de|multiplica\w*|divide\w*|suma\w*|resta\w*|convierte|conversion|propina|descuento|interes|formula|probabilidad|estadistica)\b/,
    reason: "calculo o matematicas",
  },
  {
    re: /\b(codigo|programa(r|cion)?|funcion|script|python|javascript|typescript|java|html|css|react|node|sql|regex|api|bug|error de|compilador|algoritmo|base de datos|github|git|terminal|comando de|debug\w*|refactor\w*|clase|variable)\b/,
    reason: "codigo o tecnologia",
  },
  {
    re: /\b(clima|pronostico|llover|lluvia|temperatura|noticia\w*|precio|precios|cotizacion|cotiza\w*|dolar|euro|bitcoin|bolsa|acciones de|resultado|resultados|marcador|partido|quien gano|ultima version|ultimas? noticias|actualidad|hoy en dia|esta semana en|ahora mismo|en este momento|trending|tendencia|estreno|cartelera|horario de|abierto ahora|sigue vigente|presidente actual|actualmente)\b/,
    reason: "posibles datos actuales (busqueda web)",
  },
  {
    re: /\b(y despues|y luego|despues de eso|ademas|tambien (quiero|necesito|dime|abre|pon)|primero .* luego|paso a paso|detalladamente|en detalle|a fondo|largo|extenso|completo|todos los|lista de|enumera\w*)\b/,
    reason: "peticion compuesta o detallada",
  },
  {
    re: /\b(resultado de|archivo\w*|carpeta\w*|portapapeles|pantalla actual|lo que (hay|veo|dice)|este texto|lo siguiente|lo que sigue)\b/,
    reason: "material externo a procesar",
  },
];

const HAS_MATH = /\d\s*[-+*/x×÷^%]\s*\d|\d+\s*(por|mas|menos|entre|dividido)\s*\d+/;
const HAS_CODE = /[{}<>=;]|```|\b\w+\(\)/;

// ---- Evidencia positiva de peticion simple (necesaria para usar el rapido). Texto normalizado. ----
const SIMPLE: { re: RegExp; reason: string }[] = [
  {
    re: /^(hola|buenas|buenos dias|buen dia|buenas tardes|buenas noches|hey|ey|que tal|como estas|como andas|como va|que haces|jarvis|gracias|muchas gracias|mil gracias|perfecto|genial|excelente|ok|okey|vale|dale|listo|entendido|claro|de nada|adios|chau|hasta luego|nos vemos|buenas noches|descansa|eres (genial|el mejor)|buen trabajo)\b/,
    reason: "charla breve",
  },
  { re: /\b(chiste|adivinanza|dato curioso|cuentame algo (gracioso|curioso))\b/, reason: "charla ligera" },
  { re: /^(quien eres|como te llamas|que puedes hacer|para que sirves|que sabes hacer)\b/, reason: "pregunta sobre el asistente" },
  { re: /^(que hora es|que dia es( hoy)?|a cuanto estamos|que fecha es( hoy)?|en que (dia|fecha) estamos)\b/, reason: "hora o fecha actual (ya esta en el prompt)" },
  {
    re: /^(abre|abri|abrir|ejecuta|lanza|inicia|cierra|bloquea|bloquear|silencia|activa el silencio|sube|baja|subi|bajale|subile|pon el volumen|pon volumen|volumen|mute|desmutea|toma una captura|haz una captura|captura de pantalla|captura)\b/,
    reason: "orden sencilla de sistema",
  },
  { re: /^(anota|apunta|guarda (una )?nota|crea (una )?nota|nueva nota|lista (mis )?notas|muestra (mis )?notas|borra (la )?nota|busca (en )?(mis )?notas|que notas tengo)\b/, reason: "orden sencilla de notas" },
  { re: /^(pon|inicia|empieza|arranca|cancela|para|deten)\s+(un |el |mi )?(temporizador|cronometro|timer)\b/, reason: "temporizador" },
  { re: /^(recuerda que|acuerdate de que|ten en cuenta que|olvida que|olvidate de que|que sabes de mi|que recuerdas de mi|que recuerdas)\b/, reason: "memoria a largo plazo" },
  {
    re: /^(que es|que son|quien es|quien fue|quienes fueron|cual es la capital|cual es el (idioma|simbolo)|donde queda|en que (ano|pais|continente)|que significa|como se dice|cuantos habitantes|de que color)\b/,
    reason: "pregunta factual corta",
  },
];

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

function firstHeavy(n: string): string | null {
  for (const h of HEAVY) if (h.re.test(n)) return h.reason;
  if (HAS_MATH.test(n)) return "calculo o matematicas";
  return null;
}

/** Elige el modelo para este turno. Devuelve siempre {model, reason}; ante la duda, el principal. */
export function chooseModel(input: RouteInput): RouteChoice {
  const { mainModel, fastModel, strategy } = input;
  const main = (reason: string): RouteChoice => ({ model: mainModel, reason });

  if (strategy !== "auto") return main("estrategia: siempre el modelo principal");
  if (!fastModel || fastModel === mainModel) return main("sin modelo rapido distinto configurado");

  const message = typeof input.message === "string" ? input.message : "";
  const history = Array.isArray(input.history) ? input.history : [];
  const n = norm(message);
  if (!n) return main("mensaje vacio");

  // Resultados de acciones del sistema: son material a resumir/explicar.
  if (message.trimStart().startsWith("[Resultado de")) return main("resultado de una accion del sistema");

  if (message.length > MAX_FAST_CHARS || wordCount(n) > MAX_FAST_WORDS) return main("mensaje largo");
  if (HAS_CODE.test(message)) return main("parece codigo");

  const heavy = firstHeavy(n);
  if (heavy) return main(heavy);

  // Contexto: conversacion larga o el turno anterior era exigente => el seguimiento hereda la exigencia.
  if (history.length >= 8) return main("conversacion con mucho contexto");
  const lastUser = [...history].reverse().find((t) => t.role === "user");
  const lastAssistant = [...history].reverse().find((t) => t.role === "assistant");
  if (lastUser && (firstHeavy(norm(lastUser.content)) || lastUser.content.length > MAX_FAST_CHARS)) {
    return main("seguimiento de un tema exigente");
  }
  if (lastAssistant && lastAssistant.content.length > 350) return main("seguimiento de una respuesta larga");
  if (history.slice(-4).some((t) => HAS_CODE.test(t.content))) return main("contexto tecnico reciente");

  for (const s of SIMPLE) {
    if (s.re.test(n)) return { model: fastModel, reason: `simple: ${s.reason}` };
  }
  return main("sin evidencia clara de que sea simple");
}

/** ¿El error de OpenRouter indica que el modelo no existe / no es valido (y vale reintentar con otro)? */
export function isModelError(status: number, bodyText: string): boolean {
  if (status === 404) return true;
  if (status !== 400) return false;
  return /model/i.test(bodyText) && /(not (a )?valid|invalid|not found|no endpoints|does not exist|unknown|not available|unsupported)/i.test(bodyText);
}

/**
 * Llama con el modelo elegido y, si falla por un error de modelo y no era el principal, reintenta UNA vez
 * con el principal. `doFetch` recibe el modelo a usar. Devuelve la respuesta y el modelo que la produjo.
 */
export async function fetchWithModelFallback(
  doFetch: (model: string) => Promise<Response>,
  chosen: string,
  mainModel: string,
): Promise<{ response: Response; model: string }> {
  const first = await doFetch(chosen);
  if (first.ok || chosen === mainModel) return { response: first, model: chosen };
  let text = "";
  try {
    text = await first.clone().text();
  } catch {
    /* sin cuerpo */
  }
  if (!isModelError(first.status, text)) return { response: first, model: chosen };
  console.warn(`[brain] el modelo rapido fallo (${first.status}); reintento con el principal`);
  return { response: await doFetch(mainModel), model: mainModel };
}
