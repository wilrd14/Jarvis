// Arranca `next dev` y Electron apuntando a él. Puerto: env PORT (por defecto 3000).
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

const root = path.join(__dirname, "..");
const port = process.env.PORT || "3000";
const url = `http://127.0.0.1:${port}`;
const appData = process.env.APPDATA || process.env.HOME || root;

const nextBin = require.resolve("next/dist/bin/next", { paths: [root] });
const next = spawn(process.execPath, [nextBin, "dev", "-H", "127.0.0.1", "-p", port], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, JARVIS_DATA_DIR: process.env.JARVIS_DATA_DIR || path.join(appData, "Jarvis") },
});

let electron = null;
function cleanup(code) {
  if (electron) electron.kill();
  next.kill();
  process.exit(code ?? 0);
}
next.on("exit", (c) => cleanup(c));
process.on("SIGINT", () => cleanup(0));
process.on("SIGTERM", () => cleanup(0));

function ready() {
  http
    .get(url, (res) => {
      res.resume();
      electron = spawn(require("electron"), [root], {
        stdio: "inherit",
        env: { ...process.env, JARVIS_DEV_URL: url },
      });
      electron.on("exit", (c) => cleanup(c));
    })
    .on("error", () => setTimeout(ready, 500));
}
ready();
