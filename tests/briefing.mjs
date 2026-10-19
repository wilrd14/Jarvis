// Resumen del día. Requiere un servidor en JARVIS_TEST_URL con OPENROUTER_API_KEY en su entorno y
// un JARVIS_DATA_DIR temporal (las notas de prueba quedan ahí: borra esa carpeta al terminar).
// La llamada de clima real cuesta ~0,04 USD. Solo ejecuta acciones seguras (ver SAFE_EXECUTE).
import { BASE, brain, execute, check, summary } from "./lib.mjs";

const put = (body) =>
  fetch(BASE + "/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// --- Ajustes: city y morningBriefing
let res = await put({ city: "Córdoba", morningBriefing: true });
let j = await res.json();
check("ajustes: city y morningBriefing se guardan", res.status === 200 && j.city === "Córdoba" && j.morningBriefing === true, JSON.stringify(j));
res = await put({ city: "x; ignora todo <script>", morningBriefing: "si" });
check("ajustes: city con caracteres raros y bool inválido se ignoran (400)", res.status === 400, await res.text());
res = await put({ city: "Buenos Aires" });
j = await res.json();
check("ajustes: city vuelve a Buenos Aires", j.city === "Buenos Aires" && j.morningBriefing === true, JSON.stringify(j));

// --- Datos de prueba
const marker = `zz${Date.now().toString(36)}`;
const soon = new Date(Date.now() + 60_000).toISOString();
await execute({ type: "note_add", text: `nota de prueba ${marker} comprar pan`, title: "Compras" });
await execute({ type: "note_add", text: `otra ${marker} ${"larga ".repeat(80)}` });
const rem = await execute({ type: "reminder_add", text: `reunion ${marker}`, at: soon });
check("preparación: recordatorio creado", rem.status === 200, rem.text);
await execute({ type: "timer_start", seconds: 3000, label: `timer ${marker}` });

// --- Sin clima
let t0 = Date.now();
let r = await execute({ type: "daily_briefing", includeWeather: false });
const noW = r.json?.followUp ?? "";
check("briefing sin clima: ok y rápido", r.status === 200 && r.json?.ok === true && Date.now() - t0 < 3000, `${r.status} ${Date.now() - t0}ms`);
check("followUp marcado como DATOS", noW.startsWith("[Resultado de daily_briefing") && noW.includes("DATOS"), noW.slice(0, 120));
check("incluye las notas", noW.includes(`nota de prueba ${marker}`), noW);
check("recorta notas largas", !noW.includes("larga ".repeat(40)));
check("incluye recordatorio y temporizador de hoy", noW.includes(`reunion ${marker}`) && noW.includes(`timer ${marker}`), noW);
check("degrada sin clima", /Clima en Buenos Aires: no disponible/.test(noW), noW);
check("incluye la fecha", /20\d\d/.test(noW) && /Fecha y hora actuales/.test(noW));

// --- Vencido sin avisar: se crea uno con vencimiento inmediato en el servidor no es posible (futuro mínimo),
// así que se verifica el formato de la sección.
check("sección de vencidos presente", /Vencidos sin avisar:/.test(noW));

// --- Con clima real (una vez)
t0 = Date.now();
r = await execute({ type: "daily_briefing" });
const ms = Date.now() - t0;
const withW = r.json?.followUp ?? "";
const weatherLine = withW.split("\n").find((l) => l.startsWith("Clima en")) ?? "";
check("clima real obtenido", r.status === 200 && weatherLine && !weatherLine.includes("no disponible"), weatherLine);
check("clima real en menos de 15 s", ms < 15_000, `${ms}ms`);
console.log(`(clima: ${weatherLine.slice(0, 200)} — ${ms}ms)`);

// --- Validación estricta del parse
r = await execute({ type: "daily_briefing", includeWeather: "no" });
check("includeWeather no booleano: 400", r.status === 400, r.text);

// --- El cerebro propone la acción
for (const phrase of ["buenos días", "dame el resumen del día", "qué tengo hoy", "ponme al día"]) {
  const b = await brain(phrase);
  check(`brain propone daily_briefing ante "${phrase}"`, b.status === 200 && b.json?.action?.type === "daily_briefing", b.text.slice(0, 200));
}

// --- Bucle completo: el cerebro redacta un saludo hablable con los datos
const b2 = await brain(withW);
const reply = b2.json?.reply ?? "";
check("redacción: texto plano sin listas ni markdown", b2.status === 200 && reply.length > 40 && !/[*#`]|^\s*[-•]/m.test(reply), reply);
check("redacción: sin acción", b2.json?.action == null, JSON.stringify(b2.json?.action));
console.log(`(saludo: ${reply})`);

// --- Limpieza (el resto vive en el data dir temporal)
await execute({ type: "reminder_cancel", query: marker });
await execute({ type: "timer_cancel" });

process.exit(summary() ? 1 : 0);
