// Órdenes instantáneas sin IA (src/lib/localcommands.ts). NO gasta nada: no llama a OpenRouter.
//  (a) unitarias del módulo puro: >= 80 frases positivas y negativas (trampas), números en español,
//      hora/fecha con zona, plantillas fijas.
//  (b) E2E contra el servidor en JARVIS_TEST_URL (por defecto :3822) con una key FALSA en
//      OPENROUTER_API_KEY: 10+ órdenes locales (JSON y SSE), firma de las 'confirm', latencia, y que
//      funcionan sin key. Las frases no locales NUNCA se envían al endpoint (llamarían a OpenRouter).
//      Nunca se ejecuta ninguna acción de sistema.
// Uso: node tests/localcommands.mjs     |  JARVIS_LOCAL_UNIT_ONLY=1 solo (a)
import "./ts-register.mjs";
import { BASE, check, post, summary } from "./lib.mjs";

const lc = await import("../src/lib/localcommands.ts");
const { matchLocalCommand: match, parseDuration, parseSpanishNumber, LOCAL_REPLY_TEMPLATES, LOCAL_FIXED_REPLIES } = lc;

// Lunes 19 de octubre de 2026 15:25 en Buenos Aires (UTC-3) = 18:25 UTC.
const NOW = new Date("2026-10-19T18:25:00Z");
const act = (m) => (m?.action ? JSON.stringify(m.action) : m ? "null" : "NO-MATCH");

// ---------------------------------------------------------------- (a) positivas con acción exacta
const positives = [
  // volumen
  ["sube el volumen", { type: "volume", mode: "up" }],
  ["Sube el volumen, por favor", { type: "volume", mode: "up" }],
  ["Jarvis, sube el volumen", { type: "volume", mode: "up" }],
  ["oye jarvis sube un poco el volumen", { type: "volume", mode: "up" }],
  ["subir volumen", { type: "volume", mode: "up" }],
  ["más volumen", { type: "volume", mode: "up" }],
  ["aumenta el volumen", { type: "volume", mode: "up" }],
  ["baja el volumen", { type: "volume", mode: "down" }],
  ["¿Puedes bajar el volumen?", { type: "volume", mode: "down" }],
  ["baja un poco el volumen", { type: "volume", mode: "down" }],
  ["menos volumen", { type: "volume", mode: "down" }],
  ["bájale el volumen", { type: "volume", mode: "down" }],
  ["volumen al 30", { type: "volume", mode: "set", level: 30 }],
  ["pon el volumen al 45 por ciento", { type: "volume", mode: "set", level: 45 }],
  ["pon el volumen en cincuenta", { type: "volume", mode: "set", level: 50 }],
  ["volumen al 100%", { type: "volume", mode: "set", level: 100 }],
  ["baja el volumen a 20", { type: "volume", mode: "set", level: 20 }],
  ["sube el volumen al máximo", { type: "volume", mode: "set", level: 100 }],
  ["fija el volumen a la mitad", { type: "volume", mode: "set", level: 50 }],
  ["volumen al treinta y cinco por ciento", { type: "volume", mode: "set", level: 35 }],
  ["silencio", { type: "volume", mode: "mute" }],
  ["silencia el sonido", { type: "volume", mode: "mute" }],
  ["pon el pc en silencio", { type: "volume", mode: "mute" }],
  ["mutea", { type: "volume", mode: "mute" }],
  ["quita el silencio", { type: "volume", mode: "unmute" }],
  ["activa el sonido", { type: "volume", mode: "unmute" }],
  ["desactiva el silencio", { type: "volume", mode: "unmute" }],
  // carpetas y apps
  ["abre descargas", { type: "open_folder", folder: "downloads" }],
  ["abre la carpeta de documentos", { type: "open_folder", folder: "documents" }],
  ["Abre el escritorio", { type: "open_folder", folder: "desktop" }],
  ["abre mis imágenes", { type: "open_folder", folder: "pictures" }],
  ["abre la carpeta de música", { type: "open_folder", folder: "music" }],
  ["abre videos", { type: "open_folder", folder: "videos" }],
  ["me puedes abrir descargas por favor", { type: "open_folder", folder: "downloads" }],
  ["abre la calculadora", { type: "open_app", app: "calculator" }],
  ["abre el bloc de notas", { type: "open_app", app: "notepad" }],
  ["abre spotify", { type: "open_app", app: "spotify" }],
  ["abre la aplicación de discord", { type: "open_app", app: "discord" }],
  ["abre el administrador de tareas", { type: "open_app", app: "taskmgr" }],
  ["abre vs code", { type: "open_app", app: "vscode" }],
  ["abre el navegador", { type: "open_app", app: "browser" }],
  ["abre la configuración", { type: "open_app", app: "settings" }],
  ["abre el explorador de archivos", { type: "open_app", app: "explorer" }],
  ["abre la terminal", { type: "open_app", app: "terminal" }],
  // captura y bloqueo
  ["toma una captura de pantalla", { type: "screenshot" }],
  ["captura de pantalla", { type: "screenshot" }],
  ["haz una captura de pantalla", { type: "screenshot" }],
  ["screenshot", { type: "screenshot" }],
  ["toma una captura", { type: "screenshot" }],
  ["bloquea la pantalla", { type: "lock_screen" }],
  ["bloquear el pc", { type: "lock_screen" }],
  ["bloquea el ordenador por favor", { type: "lock_screen" }],
  // temporizadores
  ["temporizador de 5 minutos", { type: "timer_start", seconds: 300 }],
  ["pon un temporizador de cinco minutos", { type: "timer_start", seconds: 300 }],
  ["ponme un temporizador de 90 segundos", { type: "timer_start", seconds: 90 }],
  ["temporizador de media hora", { type: "timer_start", seconds: 1800 }],
  ["pon un temporizador de un cuarto de hora", { type: "timer_start", seconds: 900 }],
  ["temporizador de tres cuartos de hora", { type: "timer_start", seconds: 2700 }],
  ["temporizador de dos horas y media", { type: "timer_start", seconds: 9000 }],
  ["temporizador de una hora y 15 minutos", { type: "timer_start", seconds: 4500 }],
  ["pon un temporizador para veinte minutos", { type: "timer_start", seconds: 1200 }],
  ["temporizador de un minuto y medio", { type: "timer_start", seconds: 90 }],
  ["temporizador de 10 min", { type: "timer_start", seconds: 600 }],
  ["activa un temporizador de treinta y cinco segundos", { type: "timer_start", seconds: 35 }],
  ["cancela el temporizador", { type: "timer_cancel" }],
  ["para el temporizador", { type: "timer_cancel" }],
  // notas
  ["anota que mañana tengo dentista", { type: "note_add", text: "mañana tengo dentista" }],
  ["Apunta comprar pan y leche", { type: "note_add", text: "comprar pan y leche" }],
  ["anota esto: la clave del wifi es casa123", { type: "note_add", text: "la clave del wifi es casa123" }],
  ["toma nota de llamar a mamá", { type: "note_add", text: "llamar a mamá" }],
  ["guarda una nota: revisar el presupuesto", { type: "note_add", text: "revisar el presupuesto" }],
  ["anota que tengo que pagar la luz ya", { type: "note_add", text: "tengo que pagar la luz ya" }],
  ["qué notas tengo", { type: "note_list" }],
  ["lee mis notas", { type: "note_list" }],
  ["mis notas", { type: "note_list" }],
];
for (const [phrase, expected] of positives) {
  const m = match(phrase, NOW);
  check(`+ "${phrase}"`, m && JSON.stringify(m.action) === JSON.stringify(expected), act(m));
}

// ---------------------------------------------------------------- hora y fecha
const timeCases = [
  ["qué hora es", "2026-10-19T18:25:00Z", "Son las tres y veinticinco de la tarde."],
  ["¿Qué hora es?", "2026-10-19T18:00:00Z", "Son las tres en punto de la tarde."],
  ["dime la hora", "2026-10-19T04:00:00Z", "Es la una en punto de la madrugada."],
  ["qué hora es", "2026-10-19T12:45:00Z", "Son las diez menos cuarto de la mañana."],
  ["la hora", "2026-10-19T15:30:00Z", "Son las doce y media del mediodía."],
  ["qué hora es ahora", "2026-10-20T02:50:00Z", "Son las doce menos diez de la noche."],
  ["me puedes decir la hora", "2026-10-19T23:15:00Z", "Son las ocho y cuarto de la noche."],
  ["qué hora es", "2026-10-19T04:05:00Z", "Es la una y cinco de la madrugada."],
];
for (const [phrase, iso, expected] of timeCases) {
  const m = match(phrase, new Date(iso));
  check(`hora "${phrase}" ${iso}`, m?.action === null && m.reply === expected, m?.reply);
}
{
  const m = match("qué día es hoy", NOW);
  check("fecha: qué día es hoy", m?.action === null && m.reply === "Hoy es lunes 19 de octubre de 2026.", m?.reply);
  const m2 = match("¿A qué fecha estamos?", new Date("2026-12-31T23:30:00Z")); // 20:30 en Buenos Aires: sigue siendo 31
  check("fecha usa la zona de Buenos Aires", m2?.reply === "Hoy es jueves 31 de diciembre de 2026.", m2?.reply);
  const m3 = match("qué día es", new Date("2027-01-01T02:00:00Z")); // 23:00 del 31 en Buenos Aires
  check("fecha cruzando medianoche UTC", m3?.reply === "Hoy es jueves 31 de diciembre de 2026.", m3?.reply);
}

// ---------------------------------------------------------------- saludos y cortesías (plantillas)
for (const phrase of ["hola", "Hola Jarvis", "buenos días", "buenas tardes", "buenas"]) {
  const m = match(phrase, NOW);
  check(`saludo "${phrase}"`, m?.action === null && LOCAL_REPLY_TEMPLATES.variants.greeting.includes(m.reply), m?.reply);
}
for (const phrase of ["gracias", "muchas gracias", "Gracias, Jarvis", "mil gracias", "perfecto, gracias"]) {
  const m = match(phrase, NOW);
  check(`gracias "${phrase}"`, m?.action === null && LOCAL_REPLY_TEMPLATES.variants.thanks.includes(m.reply), m?.reply);
}
{
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(match("hola", NOW).reply);
  check("los saludos varían (>= 3 de las 4 plantillas)", seen.size >= 3, [...seen].length);
}

// ---------------------------------------------------------------- negativas / trampas (todas → null)
const negatives = [
  "baja un poco la música de la película que me recomendaste",
  "sube el volumen de la tele cuando llegue mi hermano",
  "qué volumen recomiendas para escuchar música sin dañar los oídos",
  "volumen al 150",
  "volumen al 30 y abre descargas",
  "pon el volumen",
  "anota",
  "anota que",
  "apunta",
  "anota algo",
  "apunta a la luna con el telescopio",
  "anota que me recuerdes llamar a Juan mañana a las 9",
  "abre",
  "abre la puerta",
  "abre google",
  "abre youtube",
  "abre la carpeta secreta",
  "abre C:\\Windows\\System32",
  "abre descargas y borra todo",
  "abre la calculadora de la película",
  "qué hora es en Tokio",
  "qué hora es en Madrid",
  "qué día es mañana",
  "a qué hora sale el sol",
  "cuántas horas faltan para el viernes",
  "hola, ¿puedes ayudarme con mi correo?",
  "hola jarvis cómo va el mercado",
  "gracias, ahora dime la hora de Londres",
  "gracias a ti por recomendarme esa serie",
  "silencio en la sala por favor mientras hablo con mi jefe",
  "bloquea",
  "bloquea la puerta",
  "bloquea el número de teléfono de mi ex",
  "toma una captura de la ventana de chrome",
  "qué hay en la pantalla",
  "qué dice el error que tengo en pantalla",
  "temporizador",
  "temporizador de",
  "temporizador de cinco",
  "temporizador de 5 minutos para la pasta y avísame",
  "pon un temporizador de la lavadora",
  "temporizador de 0 minutos",
  "temporizador de 30 horas",
  "temporizador de minutos",
  "pon una alarma a las 7",
  "recuérdame en 20 minutos sacar la ropa",
  "manda un correo a Juan",
  "qué notas tiene el piano",
  "cuál es la capital de Francia",
  "cuéntame un chiste",
  "silencio de radio en la película",
  "",
  "   ",
  "jarvis",
  "por favor",
  "ok",
];
for (const phrase of negatives) {
  const m = match(phrase, NOW);
  check(`- "${phrase}" → null`, m === null, m && JSON.stringify(m));
}

// ---------------------------------------------------------------- números y duraciones en español
const nums = [
  [["cero"], 0], [["cinco"], 5], [["quince"], 15], [["veintiuno"], 21], [["veinticinco"], 25],
  [["treinta", "y", "cinco"], 35], [["noventa", "y", "nueve"], 99], [["cien"], 100],
  [["ciento", "veinte"], 120], [["doscientos", "cincuenta"], 250], [["45"], 45],
];
for (const [words, v] of nums) check(`número ${words.join(" ")} = ${v}`, parseSpanishNumber(words) === v, parseSpanishNumber(words));
check("número inválido → null", parseSpanishNumber(["cinco", "gatos"]) === null && parseSpanishNumber([]) === null);
const durs = [
  ["cinco minutos", 300], ["un minuto", 60], ["una hora", 3600], ["dos horas y media", 9000],
  ["media hora", 1800], ["un cuarto de hora", 900], ["tres cuartos de hora", 2700], ["una hora y cuarto", 4500],
  ["una hora y media", 5400], ["2 horas y 30 minutos", 9000], ["noventa segundos", 90], ["1 minuto y 30 segundos", 90],
  ["5min", 300], ["medio minuto", 30], ["veinticuatro horas", 86400],
];
for (const [phrase, secs] of durs) check(`duración "${phrase}" = ${secs}s`, parseDuration(phrase.split(" ")) === secs, parseDuration(phrase.split(" ")));
for (const bad of ["25 horas", "cero minutos", "cinco", "minutos", "cinco minutos y", "5 minutos 5 minutos", "cinco gatos", "y media hora"]) {
  check(`duración inválida "${bad}" → null`, parseDuration(bad.split(" ")) === null, parseDuration(bad.split(" ")));
}

// ---------------------------------------------------------------- invariantes
{
  const fixed = new Set(LOCAL_FIXED_REPLIES);
  const phrases = positives.map(([p]) => p).concat(["hola", "gracias"]);
  check(
    "toda respuesta con acción o saludo sale de las plantillas fijas",
    phrases.every((p) => fixed.has(match(p, NOW).reply)),
    phrases.find((p) => !fixed.has(match(p, NOW).reply)),
  );
  check("hay pocas plantillas fijas (< 30)", LOCAL_FIXED_REPLIES.length < 30, LOCAL_FIXED_REPLIES.length);
  const dangerous = positives.filter(([, a]) => ["volume", "open_app", "open_folder", "screenshot", "lock_screen"].includes(a.type));
  check(
    "las respuestas de acciones 'confirm' no dicen que ya está hecho",
    dangerous.every(([p]) => /solo falta que lo confirmes/.test(match(p, NOW).reply)),
  );
  check("mensaje enorme → null sin colgarse", match("anota que " + "a".repeat(5000), NOW) === null && match("a ".repeat(500), NOW) === null);
}
check("[unit] total de frases probadas >= 80", positives.length + negatives.length + timeCases.length >= 80, positives.length + negatives.length + timeCases.length);

// ---------------------------------------------------------------- (b) E2E contra el endpoint (key falsa)
if (!process.env.JARVIS_LOCAL_UNIT_ONLY) {
  const ping = await fetch(BASE + "/api/settings").catch(() => null);
  if (!ping) {
    check(`servidor accesible en ${BASE}`, false, "arráncalo con OPENROUTER_API_KEY falsa y JARVIS_DATA_DIR temporal");
  } else {
    const ask = async (message, stream = false) => {
      const t0 = performance.now();
      const res = await fetch(BASE + "/api/brain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history: [], stream }),
      });
      const raw = await res.text();
      return { status: res.status, raw, ms: performance.now() - t0, headers: res.headers };
    };
    const tokenOk = (t) => typeof t === "string" && /^\d{13}\.[0-9a-f]{64}$/.test(t);
    const e2e = [
      ["sube el volumen", { type: "volume", mode: "up" }, true],
      ["volumen al 30", { type: "volume", mode: "set", level: 30 }, true],
      ["silencio", { type: "volume", mode: "mute" }, true],
      ["abre descargas", { type: "open_folder", folder: "downloads" }, true],
      ["abre la calculadora", { type: "open_app", app: "calculator" }, true],
      ["toma una captura de pantalla", { type: "screenshot" }, true],
      ["bloquea la pantalla", { type: "lock_screen" }, true],
      ["temporizador de media hora", { type: "timer_start", seconds: 1800 }, false],
      ["cancela el temporizador", { type: "timer_cancel" }, false],
      ["anota que el servidor local funciona", { type: "note_add", text: "el servidor local funciona" }, false],
      ["qué notas tengo", { type: "note_list" }, false],
    ];
    let lockToken;
    for (const [phrase, expected, signed] of e2e) {
      const r = await ask(phrase);
      const j = JSON.parse(r.raw || "{}");
      check(
        `E2E JSON "${phrase}"`,
        r.status === 200 && j.local === true && JSON.stringify(j.action) === JSON.stringify(expected) &&
          LOCAL_FIXED_REPLIES.includes(j.reply) && (signed ? tokenOk(j.actionToken) : j.actionToken === undefined),
        r.raw.slice(0, 200),
      );
      if (expected.type === "lock_screen") lockToken = j.actionToken;
    }
    for (const phrase of ["qué hora es", "qué día es hoy", "gracias"]) {
      const r = await ask(phrase);
      const j = JSON.parse(r.raw || "{}");
      check(`E2E JSON "${phrase}" (sin acción)`, r.status === 200 && j.local === true && j.action === null && !!j.reply && j.actionToken === undefined, r.raw.slice(0, 200));
    }

    // SSE: la acción 'confirm' habla la frase y manda done; la de riesgo bajo solo manda done.
    const sseEvents = (raw) =>
      raw.split("\n\n").filter(Boolean).map((b) => ({
        event: /^event: (.+)$/m.exec(b)?.[1],
        data: JSON.parse(/^data: (.+)$/m.exec(b)?.[1] ?? "null"),
      }));
    let r = await ask("sube el volumen", true);
    let ev = sseEvents(r.raw);
    check(
      "E2E SSE confirm: sentence + done firmado",
      (r.headers.get("content-type") ?? "").includes("text/event-stream") &&
        ev.map((e) => e.event).join() === "sentence,done" && ev[0].data.text === ev[1].data.reply &&
        ev[1].data.streamed === 1 && tokenOk(ev[1].data.actionToken) && ev[1].data.local === true,
      r.raw.slice(0, 300),
    );
    r = await ask("hola", true);
    ev = sseEvents(r.raw);
    check("E2E SSE saludo: frases y done sin acción", ev.at(-1)?.event === "done" && ev.at(-1).data.action === null && ev.length >= 2 && ev.slice(0, -1).every((e) => e.event === "sentence"), r.raw.slice(0, 300));
    r = await ask("anota que prueba sse", true);
    ev = sseEvents(r.raw);
    check("E2E SSE acción de riesgo bajo: solo done (el cliente dice el resultado)", ev.length === 1 && ev[0].event === "done" && ev[0].data.action?.type === "note_add" && ev[0].data.streamed === 0, r.raw.slice(0, 300));

    // Firma: el token de lock_screen no vale para otra acción (no se ejecuta nada si la firma falla).
    const forged = await post("/api/actions/execute", { action: { type: "screenshot" }, actionToken: lockToken });
    check("la firma de una acción no sirve para otra (403)", forged.status === 403, forged.text.slice(0, 120));

    // Sin key ni crédito: la key del servidor es falsa y aun así responde; una frase no local NO se prueba aquí.
    // Latencia.
    const times = [];
    for (let i = 0; i < 20; i++) times.push((await ask("sube el volumen")).ms);
    times.sort((a, b) => a - b);
    const median = times[10];
    console.log(`LATENCIA orden local vía HTTP (20 llamadas): mediana ${median.toFixed(1)} ms, p95 ${times[18].toFixed(1)} ms, máx ${times[19].toFixed(1)} ms`);
    check("latencia de una orden local < 100 ms (mediana)", median < 100, median.toFixed(1));
  }
}

process.exit(summary() ? 1 : 0);
