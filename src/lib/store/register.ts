// Solo servidor. Registra el almacenamiento local para las acciones de
// src/lib/actions/productivity.ts (que no pueden importar `fs` por entrar al
// bundle del navegador). Se importa desde /api/actions/execute.
import * as notes from "./notes";
import * as reminders from "./reminders";

(globalThis as { __jarvisStore?: unknown }).__jarvisStore = { ...notes, ...reminders };
