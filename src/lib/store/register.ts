// Solo servidor. Registra el almacenamiento local para las acciones de
// src/lib/actions/productivity.ts (que no pueden importar `fs` por entrar al
// bundle del navegador). Se importa desde /api/actions/execute.
import * as notes from "./notes";
import * as reminders from "./reminders";
import * as memory from "./memory";
import * as skills from "../skills.server";

(globalThis as { __jarvisStore?: unknown }).__jarvisStore = { ...notes, ...reminders, ...memory };
(globalThis as { __jarvisSkills?: unknown }).__jarvisSkills = skills;
