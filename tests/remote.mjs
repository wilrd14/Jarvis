// Acceso remoto (Tailscale): Host remoto, PIN, sesión y rutas solo-PC. Arranca su propio
// servidor standalone en :3824 con datos temporales y key falsa (sin gasto).
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { check, summary } from "./lib.mjs";

const PORT = 3824;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-remote-"));
const server = spawn(process.execPath, [".next/standalone/server.js"], {
  env: { ...process.env, PORT: String(PORT), HOSTNAME: "127.0.0.1", JARVIS_DATA_DIR: dataDir, OPENROUTER_API_KEY: "sk-or-v1-FALSA" },
  stdio: "ignore",
});
const REMOTE = "pc-prueba.tail1234.ts.net";

function req(method, p, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port: PORT, method, path: p, headers: { Host: `127.0.0.1:${PORT}`, ...headers } }, (res) => {
      let t = "";
      res.on("data", (c) => (t += c));
      res.on("end", () => resolve({ status: res.statusCode, text: t, headers: res.headers }));
    });
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}
const J = { "Content-Type": "application/json" };
const remote = (extra = {}) => ({ Host: REMOTE, ...extra });
const put = (b) => req("PUT", "/api/remote/config", J, JSON.stringify(b));

try {
  for (let i = 0; i < 60; i++) {
    try { if ((await req("GET", "/manifest.webmanifest")).status === 200) break; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }

  let r = await req("GET", "/api/settings", remote());
  check("remoto desactivado: Host ts.net -> 403", r.status === 403, `${r.status}`);

  r = await put({ host: "evil.example.com" });
  check("host que no es .ts.net -> 400", r.status === 400, `${r.status} ${r.text}`);
  r = await put({ enabled: true });
  check("activar sin host ni PIN -> 400", r.status === 400, `${r.status}`);
  r = await put({ pin: "123" });
  check("PIN corto -> 400", r.status === 400, `${r.status}`);
  r = await put({ host: REMOTE, pin: "pin-de-prueba-9" });
  check("guardar host + PIN -> 200", r.status === 200, `${r.status} ${r.text}`);
  check("la respuesta no filtra hash ni secreto", !/pinHash|secret|scrypt/i.test(r.text));
  r = await put({ enabled: true });
  check("activar acceso remoto -> 200", r.status === 200, `${r.status} ${r.text}`);

  r = await req("GET", "/api/settings", remote());
  check("remoto sin sesión: API -> 401", r.status === 401, `${r.status}`);
  r = await req("GET", "/", remote());
  check("remoto sin sesión: página -> redirige a /login", r.status === 307 || r.status === 308, `${r.status} ${r.headers.location}`);
  r = await req("GET", "/login", remote());
  check("/login es pública", r.status === 200, `${r.status}`);
  r = await req("GET", "/api/settings", { Host: "otro.tail1234.ts.net" });
  check("otro host .ts.net no configurado -> 403", r.status === 403, `${r.status}`);

  r = await req("POST", "/api/remote/login", remote(J), JSON.stringify({ pin: "mal" }));
  check("PIN incorrecto -> 401 sin cookie", r.status === 401 && !r.headers["set-cookie"], `${r.status}`);
  r = await req("POST", "/api/remote/login", remote({ "Content-Type": "text/plain" }), JSON.stringify({ pin: "pin-de-prueba-9" }));
  check("login con text/plain -> 415", r.status === 415, `${r.status}`);
  r = await req("POST", "/api/remote/login", remote({ ...J, Origin: "https://evil.example" }), JSON.stringify({ pin: "pin-de-prueba-9" }));
  check("login con Origin ajeno -> 403", r.status === 403, `${r.status}`);

  r = await req("POST", "/api/remote/login", remote(J), JSON.stringify({ pin: "pin-de-prueba-9" }));
  const cookie = String(r.headers["set-cookie"] ?? "").split(";")[0];
  check("PIN correcto -> 200 y cookie HttpOnly/Secure/SameSite=Strict", r.status === 200 && /HttpOnly/.test(String(r.headers["set-cookie"])) && /Secure/.test(String(r.headers["set-cookie"])) && /SameSite=Strict/.test(String(r.headers["set-cookie"])), `${r.status} ${r.headers["set-cookie"]}`);

  r = await req("GET", "/api/settings", remote({ Cookie: cookie }));
  check("con sesión: API -> 200", r.status === 200, `${r.status}`);
  r = await req("GET", "/", remote({ Cookie: cookie }));
  check("con sesión: página principal -> 200", r.status === 200, `${r.status}`);
  r = await req("POST", "/api/actions/execute", remote({ ...J, Cookie: cookie, Origin: `https://${REMOTE}`, "Sec-Fetch-Site": "same-origin" }), JSON.stringify({ action: { type: "note_list" } }));
  check("con sesión: ejecutar acción -> 200", r.status === 200, `${r.status} ${r.text.slice(0, 100)}`);
  r = await req("POST", "/api/actions/execute", remote({ ...J, Cookie: cookie, Origin: "https://evil.example" }), JSON.stringify({ action: { type: "note_list" } }));
  check("con sesión pero Origin ajeno -> 403", r.status === 403, `${r.status}`);
  r = await req("GET", "/api/settings", remote({ Cookie: cookie.slice(0, -4) + "0000" }));
  check("cookie manipulada -> 401", r.status === 401, `${r.status}`);

  r = await req("PUT", "/api/settings", remote({ ...J, Cookie: cookie }), JSON.stringify({ model: "x/y" }));
  check("sesión remota no puede cambiar Ajustes -> 403", r.status === 403, `${r.status}`);
  r = await req("PUT", "/api/remote/config", remote({ ...J, Cookie: cookie }), JSON.stringify({ pin: "otro-pin-123" }));
  check("sesión remota no puede cambiar el PIN -> 403", r.status === 403, `${r.status}`);
  r = await req("GET", "/api/remote/config", remote({ Cookie: cookie }));
  check("sesión remota no lee la config remota -> 403", r.status === 403, `${r.status}`);

  r = await put({ action: "revoke" });
  check("revocar sesiones -> 200", r.status === 200, `${r.status}`);
  r = await req("GET", "/api/settings", remote({ Cookie: cookie }));
  check("tras revocar, la cookie vieja -> 401", r.status === 401, `${r.status}`);

  r = await req("GET", "/api/settings");
  check("el PC local sigue funcionando sin PIN", r.status === 200, `${r.status}`);
  r = await req("GET", "/");
  check("página local sigue funcionando", r.status === 200, `${r.status}`);

  // Fuerza bruta: 5 fallos bloquean 15 min (incluso con el PIN correcto).
  for (let i = 0; i < 5; i++) await req("POST", "/api/remote/login", remote(J), JSON.stringify({ pin: `mal-${i}` }));
  r = await req("POST", "/api/remote/login", remote(J), JSON.stringify({ pin: "pin-de-prueba-9" }));
  check("tras 5 fallos el login queda bloqueado -> 429", r.status === 429, `${r.status}`);

  const saved = fs.readFileSync(path.join(dataDir, "remote.json"), "utf8");
  check("el PIN no se guarda en claro", !saved.includes("pin-de-prueba-9"));
} finally {
  server.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
summary();
