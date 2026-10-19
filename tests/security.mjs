// Protección contra páginas web ajenas (CSRF / DNS rebinding) en el servidor local.
// Usa node:http para poder fijar cabeceras Origin/Host/Sec-Fetch-Site (fetch las restringe).
import http from "node:http";
import { BASE, check, summary } from "./lib.mjs";

const u = new URL(BASE);

function req(method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { host: u.hostname, port: u.port, method, path, headers: { Host: u.host, ...headers } },
      (res) => {
        let t = "";
        res.on("data", (c) => (t += c));
        res.on("end", () => resolve({ status: res.statusCode, text: t }));
      }
    );
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

const note = JSON.stringify({ action: { type: "note_add", text: "csrf-test" } });
const plain = { "Content-Type": "text/plain" };

let r = await req("POST", "/api/actions/execute", { ...plain, Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" }, note);
check("POST cross-origin (text/plain, sin preflight) a /api/actions/execute -> 403", r.status === 403, `${r.status} ${r.text}`);
r = await req("POST", "/api/actions/execute", { ...plain, Host: "evil.example:3822" }, note);
check("Host no loopback (DNS rebinding) -> 403", r.status === 403, `${r.status} ${r.text}`);
r = await req("PUT", "/api/settings", { ...plain, Origin: "https://evil.example" }, JSON.stringify({ model: "x/y" }));
check("PUT /api/settings cross-origin -> 403", r.status === 403, `${r.status}`);
r = await req("POST", "/api/speak", { ...plain, Origin: "null" }, JSON.stringify({ text: "hola" }));
check("POST /api/speak con Origin null -> 403", r.status === 403, `${r.status}`);
r = await req("GET", "/api/reminders/due", { Origin: "https://evil.example" });
check("GET /api/reminders/due cross-origin -> 403", r.status === 403, `${r.status}`);

r = await req("POST", "/api/actions/execute", { "Content-Type": "application/json", Origin: u.origin, "Sec-Fetch-Site": "same-origin" }, JSON.stringify({ action: { type: "note_add", text: "csrf-test" } }));
check("mismo origen legítimo sigue funcionando", r.status === 200, `${r.status} ${r.text}`);
r = await req("POST", "/api/actions/execute", { "Content-Type": "application/json", Host: `localhost:${u.port}` }, JSON.stringify({ action: { type: "note_delete", query: "csrf-test" } }));
check("Host localhost (sin Origin) funciona", r.status === 200, `${r.status} ${r.text}`);

process.exit(summary() ? 1 : 0);
