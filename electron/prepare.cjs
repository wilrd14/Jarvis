// Copia .next/static y public dentro de .next/standalone (requisito del modo standalone).
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const sa = path.join(root, ".next", "standalone");
if (!fs.existsSync(path.join(sa, "server.js"))) {
  console.error("Falta .next/standalone/server.js: ejecuta `next build` primero.");
  process.exit(1);
}
fs.cpSync(path.join(root, ".next", "static"), path.join(sa, ".next", "static"), { recursive: true });
if (fs.existsSync(path.join(root, "public"))) {
  fs.cpSync(path.join(root, "public"), path.join(sa, "public"), { recursive: true });
}
if (fs.existsSync(path.join(root, "skills-bundled"))) {
  fs.cpSync(path.join(root, "skills-bundled"), path.join(sa, "skills-bundled"), { recursive: true });
}
console.log("standalone preparado");
