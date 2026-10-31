import { CalendarDays, ClipboardList, Clock, MapPin, Ticket } from "lucide-react";
import { formatEventDate, parseAnswer, safeLink, splitLinks } from "@/lib/chat-format";
import type { EventCard } from "@/lib/event-fields";

function formatTime(start: string, end: string) {
  if (start && end) return `${start} - ${end}`;
  return start || (end && `Until ${end}`);
}

function EventCardItem({ card }: { card: EventCard }) {
  const registerUrl = safeLink(card.registration_link);
  // Only the details this event has. Registration text that isn't a link is one of them.
  const details = [
    { icon: CalendarDays, label: "Date", value: card.date && formatEventDate(card.date) },
    { icon: Clock, label: "Time", value: formatTime(card.start_time, card.end_time) },
    { icon: MapPin, label: "Venue", value: card.venue },
    { icon: Ticket, label: "Fee", value: card.fee },
    { icon: ClipboardList, label: "Registration", value: registerUrl ? "" : card.registration_link },
  ].filter((detail) => detail.value);

  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 [overflow-wrap:anywhere]">
      <div>
        {card.category && <p className="mb-1 text-xs font-medium text-muted">{card.category}</p>}
        <h3 className="font-semibold">{card.name}</h3>
      </div>
      {details.length > 0 && (
        <dl className="space-y-1.5 text-sm">
          {details.map(({ icon: Icon, label, value }) => (
            <div key={label} className="flex items-start gap-2">
              <dt className="mt-0.5 shrink-0">
                <Icon aria-hidden className="size-4 text-muted" />
                <span className="sr-only">{label}</span>
              </dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {registerUrl && (
        <a
          href={registerUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Register for ${card.name}`}
          className="mt-auto inline-flex min-h-11 w-fit items-center rounded-full bg-accent px-6 font-medium text-on-accent transition-colors hover:bg-accent-hover"
        >
          Register
        </a>
      )}
    </li>
  );
}

// One chatbot message: what it says, then a card for each event it points to.
export function ChatAnswer({ content, cards }: { content: string; cards: EventCard[] }) {
  const { text, refs } = parseAnswer(content);
  // A ref with no card is skipped, such as an event that has since been deleted.
  const shown = refs.flatMap((ref) => cards.find((card) => card.ref === ref) ?? []);
  if (!text && shown.length === 0) return null;

  return (
    <div className="space-y-3">
      {text && (
        <p className="max-w-[92%] leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap">
          {splitLinks(text).map((part, index) =>
            "href" in part ? (
              <a
                key={index}
                href={part.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline underline-offset-2"
              >
                {part.text}
              </a>
            ) : (
              part.text
            ),
          )}
        </p>
      )}
      {shown.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {shown.map((card) => (
            <EventCardItem key={card.ref} card={card} />
          ))}
        </ul>
      )}
    </div>
  );
}
