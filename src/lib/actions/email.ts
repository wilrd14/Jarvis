import { isRecord, str, type ActionDefinition } from "./types";

export interface EmailAction {
  type: "email";
  to: string;
  subject: string;
  body: string;
}

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

export const emailAction: ActionDefinition<EmailAction> = {
  type: "email",
  description: "Preparar un correo para enviar (abre el cliente de correo del usuario).",
  schema: `{ "type": "email", "to": "destinatario@ejemplo.com", "subject": "...", "body": "..." }`,
  risk: "confirm",
  label: (a) => ({ title: "Correo listo", detail: `Para: ${a.to} — ${a.subject}` }),
  parse(raw) {
    if (!isRecord(raw)) return null;
    const to = str(raw.to, 3, 254);
    const subject = str(raw.subject, 1, 200);
    const body = str(raw.body, 1, 5000);
    if (!to || !EMAIL_RE.test(to) || !subject || !body) return null;
    return { type: "email", to, subject, body };
  },
  execution: {
    kind: "client",
    run(a) {
      const mailto = `mailto:${encodeURIComponent(a.to)}?subject=${encodeURIComponent(
        a.subject
      )}&body=${encodeURIComponent(a.body)}`;
      window.open(mailto);
    },
  },
};
