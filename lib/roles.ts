// Shared by pages and the server, so this file must not import server-only code.
export type Role = "attendant" | "moderator" | "organiser";

export const ROLE_LABELS: Record<Role, string> = {
  attendant: "Attendant",
  moderator: "Moderator",
  organiser: "Organiser",
};

export function roleFromMetadata(metadata: Record<string, unknown>): Role {
  if (metadata.role === "organiser" || metadata.role === "moderator") return metadata.role;
  return "attendant";
}

export function isStaff(role: Role) {
  return role === "organiser" || role === "moderator";
}

export const TICKET_STATUSES = ["open", "in_progress", "resolved"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
};

export type Ticket = {
  id: string;
  user_name: string;
  user_email: string;
  subject: string;
  description: string;
  status: TicketStatus;
  response: string;
  live: boolean;
  // Only included for staff.
  resolved_by?: string;
  resolved_at?: string | null;
  transcript_count?: number;
  created_at: string;
  updated_at: string;
};

export type TicketMessage = {
  id: string;
  sender_role: "attendant" | "staff";
  sender_name: string;
  content: string;
  created_at: string;
};

export type TicketThread = { status: TicketStatus; messages: TicketMessage[] };

// One page of the staff ticket list, with the total for each status.
export type TicketPage = { tickets: Ticket[]; counts: Record<TicketStatus, number> };

export type ConversationSummary = { id: string; title: string; updated_at: string };
export type ChatMessage = { role: "user" | "assistant"; content: string };
export type TeamMember = { id: string; name: string; email: string; role: Role; isSelf: boolean };
