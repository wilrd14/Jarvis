// Registra los hooks que permiten importar módulos .ts de src/ sin extensión (ver ts-hooks.mjs).
import { register } from "node:module";
register("./ts-hooks.mjs", import.meta.url);
