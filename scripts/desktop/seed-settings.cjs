// Primera instalación: si aún no hay settings.json en %APPDATA%\Jarvis, copia la key de .env.local
// (solo en este mismo equipo). Si no hay key, el panel de ajustes la pedirá al abrir.
const fs = require("fs");
const path = require("path");

const dir = path.join(process.env.APPDATA || "", "Jarvis");
const file = path.join(dir, "settings.json");
if (fs.existsSync(file)) {
  console.log("settings.json ya existe; no se toca.");
  process.exit(0);
}
const envFile = path.join(__dirname, "..", "..", ".env.local");
const match = fs.existsSync(envFile)
  ? fs.readFileSync(envFile, "utf8").match(/^OPENROUTER_API_KEY=(.+)$/m)
  : null;
if (!match) {
  console.log("Sin key en .env.local: Jarvis la pedirá en Ajustes al abrirse.");
  process.exit(0);
}
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(file, JSON.stringify({ openrouterApiKey: match[1].trim() }, null, 2));
console.log("Key copiada a", file);
