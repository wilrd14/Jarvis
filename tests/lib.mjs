// Utilidades compartidas de las pruebas E2E. Seguras: nunca ejecutan acciones de sistema reales.
export const BASE = process.env.JARVIS_TEST_URL || "http://127.0.0.1:3822";

// Únicas acciones que estas pruebas aceptan ejecutar contra /api/actions/execute.
export const SAFE_EXECUTE = new Set([
  "note_add", "note_list", "note_search", "note_delete",
  "reminder_add", "reminder_list", "reminder_cancel",
  "timer_start", "timer_cancel", "alarm_set", "daily_briefing",
  "memory_add", "memory_list", "memory_search", "memory_forget",
  "skill_use", "skill_read",
]);

let pass = 0;
let fail = 0;
export function check(name, ok, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + String(detail).slice(0, 300) : ""}`);
}
export function summary() {
  console.log(`\n${pass} pasaron, ${fail} fallaron`);
  return fail;
}

export async function post(path, body, init = {}) {
  const raw = typeof body === "string" || body instanceof Uint8Array || Buffer.isBuffer(body);
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    body: raw ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, headers: res.headers };
}

export function brain(message, history = []) {
  return post("/api/brain", { message, history });
}

export function execute(action, actionToken) {
  if (!SAFE_EXECUTE.has(action?.type)) throw new Error(`Acción no permitida en pruebas: ${action?.type}`);
  return post("/api/actions/execute", { action, actionToken });
}
