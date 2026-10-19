import { isRecord, isoDate, str, type ActionDefinition } from "./types";

export interface CalendarAction {
  type: "calendar";
  title: string;
  details: string;
  location?: string;
  /** ISO 8601 start datetime, e.g. 2026-08-15T18:00:00Z */
  start: string;
  /** ISO 8601 end datetime, e.g. 2026-08-15T19:00:00Z */
  end: string;
}

function toGoogleCalendarStamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export const calendarAction: ActionDefinition<CalendarAction> = {
  type: "calendar",
  description:
    "Crear un evento de calendario (abre Google Calendar). Usa fechas ISO 8601 con zona horaria (Z u offset); si no dan duración, 1 hora.",
  schema: `{ "type": "calendar", "title": "...", "details": "...", "location": "...", "start": "2026-08-15T18:00:00Z", "end": "2026-08-15T19:00:00Z" }`,
  risk: "confirm",
  label: (a) => ({ title: "Evento listo", detail: a.title }),
  parse(raw) {
    if (!isRecord(raw)) return null;
    const title = str(raw.title, 1, 200);
    const start = isoDate(raw.start);
    const end = isoDate(raw.end);
    if (!title || !start || !end || end.time <= start.time) return null;
    const details = raw.details == null ? "" : str(raw.details, 0, 2000);
    if (details === undefined) return null;
    const out: CalendarAction = { type: "calendar", title, details, start: start.value, end: end.value };
    if (raw.location != null && raw.location !== "") {
      const location = str(raw.location, 1, 300);
      if (!location) return null;
      out.location = location;
    }
    return out;
  },
  execution: {
    kind: "client",
    run(a) {
      const params = new URLSearchParams({
        action: "TEMPLATE",
        text: a.title,
        dates: `${toGoogleCalendarStamp(a.start)}/${toGoogleCalendarStamp(a.end)}`,
        details: a.details,
      });
      if (a.location) params.set("location", a.location);
      window.open(`https://calendar.google.com/calendar/render?${params.toString()}`);
    },
  },
};
