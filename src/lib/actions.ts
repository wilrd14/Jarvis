export interface EmailAction {
  type: "email";
  to: string;
  subject: string;
  body: string;
}

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

export type AssistantAction = EmailAction | CalendarAction;

function toGoogleCalendarStamp(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function openEmailAction(action: EmailAction) {
  const mailto = `mailto:${encodeURIComponent(action.to)}?subject=${encodeURIComponent(
    action.subject
  )}&body=${encodeURIComponent(action.body)}`;
  window.open(mailto);
}

export function openCalendarAction(action: CalendarAction) {
  const dates = `${toGoogleCalendarStamp(action.start)}/${toGoogleCalendarStamp(action.end)}`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: action.title,
    dates,
    details: action.details,
  });
  if (action.location) params.set("location", action.location);
  window.open(`https://calendar.google.com/calendar/render?${params.toString()}`);
}

export function runAssistantAction(action: AssistantAction) {
  if (action.type === "email") openEmailAction(action);
  else openCalendarAction(action);
}
