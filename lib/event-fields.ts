// Shared by the organiser page and the server, so this file must not import server-only code.
export const EVENT_FIELDS = [
  "name",
  "description",
  "date",
  "start_time",
  "end_time",
  "venue",
  "category",
  "organiser",
  "coordinator_contact",
  "registration_link",
  "fee",
  "eligibility",
  "team_size",
  "prizes",
  "notes",
] as const;

export type EventField = (typeof EVENT_FIELDS)[number];
// A heading and details the organiser adds themselves, such as "Rules" or "Judging".
export type CustomSection = { title: string; content: string };
export type EventDetails = Record<EventField, string> & { custom_sections: CustomSection[] };
export type FestEvent = EventDetails & { id: string };

export const EMPTY_EVENT = {
  ...Object.fromEntries(EVENT_FIELDS.map((field) => [field, ""])),
  custom_sections: [],
} as unknown as EventDetails;
