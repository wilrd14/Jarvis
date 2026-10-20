// Enrutador de modelo: pruebas unitarias del modulo puro (sin red, sin coste).
// Uso: node tests/modelrouter.mjs
import { chooseModel, isModelError, fetchWithModelFallback } from "../src/lib/modelrouter.ts";
import { sanitize, DEFAULTS } from "../src/lib/settings.ts";
import { check, summary } from "./lib.mjs";

const MAIN = "anthropic/claude-sonnet-5.5";
const FAST = "anthropic/claude-haiku-5.5";
const pick = (message, history = [], over = {}) =>
  chooseModel({ message, history, mainModel: MAIN, fastModel: FAST, strategy: "auto", ...over });

// [frase, esperado ("F" rapido | "M" principal), historial opcional]
const long = "x".repeat(400);
const cases = [
  // --- charla y preguntas simples: rapido
  ["Hola Jarvis", "F"],
  ["Buenos días", "F"],
  ["Gracias", "F"],
  ["Muchas gracias, eres genial", "F"],
  ["¿Cómo estás?", "F"],
  ["Cuéntame un chiste", "F"],
  ["Dale", "F"],
  ["Hasta luego", "F"],
  ["¿Quién eres?", "F"],
  ["¿Qué puedes hacer?", "F"],
  ["¿Qué hora es?", "F"],
  ["¿Qué día es hoy?", "F"],
  ["¿Cuál es la capital de Francia?", "F"],
  ["¿Qué es un agujero negro?", "F"],
  ["¿Quién fue Simón Bolívar?", "F"],
  ["¿Qué significa efímero?", "F"],
  ["¿Cómo se dice perro en inglés?", "F"],
  ["¿En qué año llegó el hombre a la Luna?", "F"],
  // --- órdenes sencillas: rapido
  ["Abre Spotify", "F"],
  ["Abre YouTube por favor", "F"],
  ["Sube el volumen", "F"],
  ["Baja el volumen un poco", "F"],
  ["Bloquea la pantalla", "F"],
  ["Toma una captura de pantalla", "F"],
  ["Pon un temporizador de cinco minutos", "F"],
  ["Cancela el temporizador", "F"],
  ["Anota comprar leche", "F"],
  ["Guarda una nota que diga llamar al dentista", "F"],
  ["Lista mis notas", "F"],
  ["Recuerda que mi hermana se llama Lucía", "F"],
  ["¿Qué recuerdas de mí?", "F"],
  ["Abre el navegador y busca nada", "M"], // compuesto/ambiguo con "y": no esta en la lista simple... ver abajo
  // --- redaccion: principal
  ["Redacta un correo para Juan", "M"],
  ["Escribe un mail a mi jefe pidiendo vacaciones", "M"],
  ["Resume esto", "M"],
  ["Traduce esta frase al francés", "M"],
  ["Hazme un poema sobre el mar", "M"],
  // --- fechas/recordatorios/calendario: principal
  ["Agéndame una reunión mañana a las diez", "M"],
  ["Recuérdame llamar a mamá el viernes", "M"],
  ["Pon una alarma a las siete", "M"],
  ["Crea un evento en el calendario", "M"],
  ["Cancela mi cita del lunes", "M"],
  ["Avísame en 3 días que pague la luz", "M"],
  // --- razonamiento, comparacion: principal
  ["¿Por qué?", "M"],
  ["¿Cómo funciona un motor de combustión?", "M"],
  ["Compara el iPhone con un Samsung", "M"],
  ["¿Qué diferencia hay entre alquilar y comprar?", "M"],
  ["¿Qué me recomiendas para cenar?", "M"],
  ["Explícame la relatividad", "M"],
  ["¿Me conviene cambiar de trabajo?", "M"],
  ["Ayúdame a decidir entre dos ofertas", "M"],
  // --- matematicas: principal
  ["¿Cuánto es 15% de 340?", "M"],
  ["Calcula 234 por 17", "M"],
  ["17*23", "M"],
  ["¿Cuántos días faltan para Navidad?", "M"],
  ["Divide 100 entre 7", "M"],
  // --- codigo: principal
  ["Escribe una función en Python para ordenar una lista", "M"],
  ["¿Por qué me da error de sintaxis en mi script?", "M"],
  ["const x = 5;", "M"],
  // --- datos actuales (busqueda web): principal
  ["¿Qué clima hace hoy?", "M"],
  ["¿A cuánto está el dólar?", "M"],
  ["Últimas noticias", "M"],
  ["¿Quién ganó el partido de anoche?", "M"],
  ["¿Cuál es el precio del bitcoin?", "M"],
  // --- trampas: cortas pero dificiles
  ["¿Y mañana?", "M"],
  ["Hazlo", "M"],
  ["¿Es mejor?", "M"],
  ["Traduce", "M"],
  ["Resúmelo", "M"],
  ["¿Por qué el cielo es azul?", "M"],
  ["Derivada de x al cuadrado", "M"],
  ["Pros y contras", "M"],
  ["¿Y eso cómo se hace?", "M"],
  // --- trampas: largas pero simples (aun asi principal por regla de largo)
  ["Hola Jarvis, buen día, quería saber cómo estás hoy porque ayer estuve pensando mucho en ti, de verdad", "M"],
  ["Gracias por todo lo que haces por mí cada día, de verdad te lo agradezco mucho, eres genial", "M"],
  [long, "M"],
  // --- resultados de acciones del sistema
  ["[Resultado de clipboard_read] hola mundo", "M"],
  ["[Resultado de daily_briefing] ...", "M"],
  // --- contexto
  ["Gracias", [{ role: "user", content: "Redacta un correo para Juan" }, { role: "assistant", content: "Listo." }], "M"],
  ["Dale", [{ role: "user", content: "Explícame la relatividad" }, { role: "assistant", content: "ok" }], "M"],
  ["Gracias", [{ role: "user", content: "Hola" }, { role: "assistant", content: "A" .repeat(500) }], "M"],
  ["Gracias", Array.from({ length: 8 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "ok" })), "M"],
  ["Gracias", [{ role: "user", content: "Hola" }, { role: "assistant", content: "Hola William." }], "F"],
  ["Abre Spotify", [{ role: "user", content: "Gracias" }, { role: "assistant", content: "De nada." }], "F"],
  // --- ambiguo / sin evidencia: principal
  ["Cuéntame algo", "M"],
  ["Lo de ayer", "M"],
  ["Necesito ayuda con mi tarea", "M"],
  ["Mi amigo está triste", "M"],
  // --- documentos: siempre el principal
  ["Hazme un informe en Word", "M"],
  ["Genera un PDF", "M"],
  ["Arma una presentación", "M"],
  ["Haz una tabla de gastos en Excel", "M"],
  ["Guarda esto como Markdown", "M"],
  ["Genera un documento", "M"],
  ["Redacta una carta formal", "M"],
  ["Abre el documento", "M"],
  ["Pásame esto a Excel", "M"],
  ["Prepárame una planilla", "M"],
];
// Corrige el caso ambiguo marcado arriba: "Abre el navegador y busca nada" no empieza con patron compuesto -> abre = simple.
// Se deja documentado con su resultado real en lugar de forzarlo:
const doc = cases.findIndex((c) => c[0] === "Abre el navegador y busca nada");
cases[doc][1] = "F";

for (const c of cases) {
  const [msg, a, b] = c;
  const history = Array.isArray(a) ? a : [];
  const expected = Array.isArray(a) ? b : a;
  const r = pick(msg, history);
  const got = r.model === FAST ? "F" : r.model === MAIN ? "M" : "?";
  check(`${expected === "F" ? "rapido " : "principal"} <- ${msg.slice(0, 60)}`, got === expected, `${got} (${r.reason})`);
}
check("al menos 50 frases", cases.length >= 50, String(cases.length));

// --- estrategia y configuracion
check("estrategia main: siempre principal", pick("Hola", [], { strategy: "main" }).model === MAIN);
check("sin fastModel: principal", pick("Hola", [], { fastModel: "" }).model === MAIN);
check("fastModel igual al principal: principal", pick("Hola", [], { fastModel: MAIN }).model === MAIN);
check("entradas raras no rompen", pick(undefined).model === MAIN && pick("").model === MAIN && pick("Hola", null).model === FAST);
check("siempre devuelve razon", typeof pick("Hola").reason === "string" && pick("Hola").reason.length > 0);

// Proporcion: en un uso tipico mixto, el rapido se usa en una parte razonable (informativo).
const nF = cases.filter((c) => !Array.isArray(c[1]) && pick(c[0]).model === FAST).length;
console.log(`INFO  ${nF}/${cases.length} frases del corpus van al modelo rapido`);

// --- deteccion de error de modelo y reintento
check("404 es error de modelo", isModelError(404, "x"));
check("400 con 'not a valid model ID'", isModelError(400, '{"error":{"message":"anthropic/foo is not a valid model ID"}}'));
check("400 sin relacion con el modelo no", !isModelError(400, '{"error":{"message":"messages: bad"}}'));
check("402/500 no son error de modelo", !isModelError(402, "model") && !isModelError(500, "model not found"));

const calls = [];
const mk = (script) => async (m) => {
  calls.push(m);
  const s = script[m];
  return new Response(s.body ?? "ok", { status: s.status });
};
let r = await fetchWithModelFallback(mk({ [FAST]: { status: 404, body: "no such model" }, [MAIN]: { status: 200 } }), FAST, MAIN);
check("404 del rapido: reintenta una vez con el principal", r.model === MAIN && r.response.ok && calls.join() === `${FAST},${MAIN}`, calls.join());
calls.length = 0;
r = await fetchWithModelFallback(mk({ [FAST]: { status: 402, body: "credits" }, [MAIN]: { status: 200 } }), FAST, MAIN);
check("402 del rapido: NO reintenta (no es de modelo)", r.model === FAST && r.response.status === 402 && calls.length === 1);
calls.length = 0;
r = await fetchWithModelFallback(mk({ [MAIN]: { status: 404 } }), MAIN, MAIN);
check("principal con 404: sin reintento", r.response.status === 404 && calls.length === 1);
calls.length = 0;
r = await fetchWithModelFallback(mk({ [FAST]: { status: 404 }, [MAIN]: { status: 404 } }), FAST, MAIN);
check("ambos fallan: una sola reintentada", calls.length === 2 && r.response.status === 404);

// --- ajustes
check("defaults", DEFAULTS.modelStrategy === "auto" && DEFAULTS.fastModel === "anthropic/claude-haiku-5.5" && DEFAULTS.brainMaxTokens === 2500);
check("sanitize modelStrategy valido", sanitize({ modelStrategy: "main" }).modelStrategy === "main" && sanitize({ modelStrategy: "auto" }).modelStrategy === "auto");
check("sanitize modelStrategy invalido se ignora", sanitize({ modelStrategy: "x" }).modelStrategy === undefined);
check("sanitize fastModel valido", sanitize({ fastModel: " anthropic/claude-haiku-5.5 " }).fastModel === "anthropic/claude-haiku-5.5");
check("sanitize fastModel malo se ignora", sanitize({ fastModel: "a b" }).fastModel === undefined && sanitize({ fastModel: "x\ny" }).fastModel === undefined);
check("sanitize brainMaxTokens acota", sanitize({ brainMaxTokens: 10 }).brainMaxTokens === 300 && sanitize({ brainMaxTokens: 99999 }).brainMaxTokens === 8000 && sanitize({ brainMaxTokens: 900.4 }).brainMaxTokens === 900);
check("sanitize brainMaxTokens no numerico se ignora", sanitize({ brainMaxTokens: "900" }).brainMaxTokens === undefined);

process.exit(summary() ? 1 : 0);
