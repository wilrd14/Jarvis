// Uso: node tests/probe.mjs "mensaje"  -> imprime la respuesta del cerebro (reply + acción propuesta).
import { brain } from "./lib.mjs";

const r = await brain(process.argv[2] ?? "hola");
console.log(r.status, JSON.stringify(r.json ?? r.text).slice(0, 700));
