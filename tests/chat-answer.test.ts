import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ChatAnswer } from "@/components/ChatAnswer";
import type { EventCard } from "@/lib/event-fields";

const HACKATHON: EventCard = {
  ref: "a1b2c3d4",
  name: "Hackathon",
  category: "Tech",
  date: "2026-11-14",
  start_time: "10:00 AM",
  end_time: "6:00 PM",
  venue: "Main hall",
  fee: "Free",
  registration_link: "forms.gle/abc",
};

function render(content: string, cards: EventCard[] = [HACKATHON]) {
  return renderToStaticMarkup(createElement(ChatAnswer, { content, cards }));
}

describe("a chatbot answer", () => {
  test("shows the text without the marker, then a card for each event", () => {
    const html = render("It's on Saturday.\n[[events: a1b2c3d4]]");
    expect(html).toContain("It&#x27;s on Saturday.");
    expect(html).not.toContain("[[");
    expect(html).not.toContain("a1b2c3d4");
    expect(html).toContain("<h3");
    expect(html).toContain("Hackathon");
    expect(html).toContain("Sat, 14 Nov 2026");
    expect(html).toContain("10:00 AM - 6:00 PM");
    expect(html).toContain("Main hall");
    expect(html).toContain("Free");
  });

  test("hides a marker that's still arriving", () => {
    const html = render("It's on Saturday. [[events: a1b2");
    expect(html).toContain("It&#x27;s on Saturday.");
    expect(html).not.toContain("[[");
    expect(html).not.toContain("a1b2");
  });

  test("skips a ref with no card, such as a deleted event", () => {
    const html = render("Here you go. [[events: gone1234]]");
    expect(html).toContain("Here you go.");
    expect(html).not.toContain("<ul");
  });

  test("shows nothing at all for a marker with nothing to show", () => {
    expect(render("[[events: gone1234]]")).toBe("");
    expect(render("")).toBe("");
  });

  test("shows at most 3 cards", () => {
    const cards = ["r1", "r2", "r3", "r4"].map((ref) => ({ ...HACKATHON, ref, name: `Event ${ref}` }));
    const html = render("[[events: r1, r2, r3, r4]]", cards);
    expect(html).toContain("Event r3");
    expect(html).not.toContain("Event r4");
  });

  test("escapes anything written like HTML", () => {
    const html = render('<script>alert(1)</script> <img src=x onerror="alert(1)">');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
  });

  test("makes links open safely in a new tab", () => {
    const html = render("Register at https://example.com/form.");
    expect(html).toContain('href="https://example.com/form"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  test("never links to a script", () => {
    expect(render("Click javascript:alert(1) or data:text/html,x")).not.toContain("<a");
  });
});

describe("an event card", () => {
  test("has a Register button for a real link", () => {
    const html = render("[[events: a1b2c3d4]]");
    expect(html).toContain('href="https://forms.gle/abc"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("Register for Hackathon");
  });

  test.each(["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,<script>alert(1)</script>"])(
    "never links to %s, and shows it only as text",
    (registration_link) => {
      const html = render("[[events: a1b2c3d4]]", [{ ...HACKATHON, registration_link }]);
      expect(html).not.toContain("<a");
      expect(html).not.toContain("<script");
    },
  );

  test("shows registration text that isn't a link as plain text", () => {
    const html = render("[[events: a1b2c3d4]]", [{ ...HACKATHON, registration_link: "At the registration desk" }]);
    expect(html).not.toContain("<a");
    expect(html).toContain("At the registration desk");
  });

  test("leaves out details the event doesn't have", () => {
    const bare: EventCard = { ref: "bare0000", name: "Bare event", category: "", date: "", start_time: "", end_time: "", venue: "", fee: "", registration_link: "" };
    const html = render("[[events: bare0000]]", [bare]);
    expect(html).toContain("Bare event");
    expect(html).not.toContain("<dl");
    expect(html).not.toContain("<a");
  });

  test.each([
    ["10:00 AM", "", "10:00 AM"],
    ["", "6:00 PM", "Until 6:00 PM"],
  ])("shows partial times: from %j to %j", (start_time, end_time, expected) => {
    const html = render("[[events: a1b2c3d4]]", [{ ...HACKATHON, start_time, end_time }]);
    expect(html).toContain(expected);
    expect(html).not.toContain(" - ");
  });

  test("shows a date that isn't in the stored format as it is", () => {
    const html = render("[[events: a1b2c3d4]]", [{ ...HACKATHON, date: "Mid November" }]);
    expect(html).toContain("Mid November");
  });
});
