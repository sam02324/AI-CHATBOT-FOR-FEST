import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, test } from "vitest";
import { formatEventDate, parseAnswer, safeLink, splitLinks } from "@/lib/chat-format";
import { apiErrorMessage, chatSystem, eventsForPrompt, festDate, posterPrompt } from "@/lib/claude";
import { EMPTY_EVENT, eventRef, type FestEvent } from "@/lib/event-fields";
import { cleanEvent } from "@/lib/api";

function festEvent(details: Partial<FestEvent> = {}): FestEvent {
  return { ...EMPTY_EVENT, id: "a1b2c3d4-0000-4000-8000-000000000000", name: "Hackathon", ...details };
}

describe("parseAnswer", () => {
  test("removes a marker and reads its refs", () => {
    const { text, refs } = parseAnswer("The hackathon is on Saturday.\n[[events: a1b2c3d4, e5f6a7b8]]");
    expect(text).toBe("The hackathon is on Saturday.");
    expect(refs).toEqual(["a1b2c3d4", "e5f6a7b8"]);
  });

  test.each([
    ["[[event: a1]]"],
    ["[[EVENTS: a1]]"],
    ["[[ events : a1 ]]"],
    ["[[events:a1]]"],
  ])("understands the marker %s", (marker) => {
    expect(parseAnswer(`Hello ${marker}`)).toEqual({ text: "Hello", refs: ["a1"] });
  });

  test("leaves text with no marker alone", () => {
    expect(parseAnswer("Just text.")).toEqual({ text: "Just text.", refs: [] });
  });

  test("gives at most 3 refs, without repeats, across all markers", () => {
    const { refs } = parseAnswer("[[events: a, b, a]] and [[events: c, d, e]]");
    expect(refs).toEqual(["a", "b", "c"]);
  });

  test("copes with an empty marker and stray commas", () => {
    expect(parseAnswer("Hi [[events: ]]")).toEqual({ text: "Hi", refs: [] });
    expect(parseAnswer("Hi [[events: , a,, ]]")).toEqual({ text: "Hi", refs: ["a"] });
  });

  test("gives the same answer when called twice, so its regular expressions keep no state", () => {
    const raw = "Hi [[events: a]]";
    expect(parseAnswer(raw)).toEqual(parseAnswer(raw));
    expect(parseAnswer(raw).refs).toEqual(["a"]);
  });

  test("keeps double brackets that aren't a marker", () => {
    expect(parseAnswer("See [[the rules]] first.").text).toBe("See [[the rules]] first.");
  });

  test("keeps single brackets", () => {
    expect(parseAnswer("Rules [1] and [2] apply.").text).toBe("Rules [1] and [2] apply.");
  });

  describe("while an answer streams in", () => {
    const FULL = "The hackathon is on Saturday. [[events: a1b2c3d4, e5f6a7b8]]";
    const BEFORE_MARKER = FULL.indexOf("[[");
    const prefixes = Array.from({ length: FULL.length - BEFORE_MARKER }, (_, index) => FULL.slice(0, BEFORE_MARKER + index + 1));

    test.each(prefixes)("%j hides the marker", (prefix) => {
      const { text } = parseAnswer(prefix);
      expect(text).toBe("The hackathon is on Saturday.");
    });

    test("no refs show until the marker is complete", () => {
      for (const prefix of prefixes.slice(0, -1)) expect(parseAnswer(prefix).refs).toEqual([]);
      expect(parseAnswer(FULL).refs).toEqual(["a1b2c3d4", "e5f6a7b8"]);
    });

    test("text before the marker never goes backwards as it arrives", () => {
      let shown = "";
      for (let end = 1; end <= FULL.length; end++) {
        const { text } = parseAnswer(FULL.slice(0, end));
        // Spaces can be trimmed for a moment, but what's visible only ever grows.
        expect(text.startsWith(shown.trimEnd())).toBe(true);
        shown = text;
      }
    });

    test("a marker in the middle of an answer stays hidden as more text arrives", () => {
      const raw = "Before [[events: a]] after";
      for (let end = 1; end <= raw.length; end++) {
        expect(parseAnswer(raw.slice(0, end)).text).not.toMatch(/\[|events:/);
      }
    });

    test("a marker split across two lines is hidden while it arrives", () => {
      const { text } = parseAnswer("Hello [[events:\n a1");
      expect(text).toBe("Hello");
    });
  });
});

describe("safeLink", () => {
  test.each([
    ["https://example.com/path?a=1#b", "https://example.com/path?a=1#b"],
    ["http://example.com", "http://example.com/"],
    ["HTTPS://EXAMPLE.COM", "https://example.com/"],
    ["  https://example.com  ", "https://example.com/"],
    ["forms.gle/abc", "https://forms.gle/abc"],
    ["example.com", "https://example.com/"],
    ["www.example.com", "https://www.example.com/"],
    ["my-fest.example.co.in/register?id=5", "https://my-fest.example.co.in/register?id=5"],
  ])("accepts %j", (value, expected) => {
    expect(safeLink(value)).toBe(expected);
  });

  test.each([
    ["javascript:alert(1)"],
    ["JavaScript:alert(1)"],
    ["  javascript:alert(1)"],
    ["javascript://example.com/%0Aalert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
    ["DATA:text/html;base64,AAAA"],
    ["vbscript:msgbox(1)"],
    ["file:///etc/passwd"],
    ["ftp://example.com"],
    ["mailto:someone@example.com"],
    ["blob:https://example.com/abc"],
  ])("rejects %j", (value) => {
    expect(safeLink(value)).toBeNull();
  });

  test.each([
    [""],
    ["   "],
    ["TBA"],
    ["At the registration desk"],
    ["https://exa mple.com"],
    ["java\nscript:alert(1)"],
    ["java\tscript:alert(1)"],
    ["//example.com"],
    ["/relative/path"],
    ["https://"],
    ["example"],
  ])("isn't fooled by %j", (value) => {
    expect(safeLink(value)).toBeNull();
  });

  test.each([["N.A"], ["10.30"], ["1.5"]])("isn't fooled by text that only looks like a domain: %j", (value) => {
    expect(safeLink(value)).toBeNull();
  });
});

describe("splitLinks", () => {
  test("splits text around a link", () => {
    expect(splitLinks("Register at https://example.com/a today")).toEqual([
      { text: "Register at " },
      { text: "https://example.com/a", href: "https://example.com/a" },
      { text: " today" },
    ]);
  });

  test("gives back text with no link as it is", () => {
    expect(splitLinks("No links here.")).toEqual([{ text: "No links here." }]);
    expect(splitLinks("")).toEqual([]);
  });

  test.each([".", ",", ";", ":", "!", "?", ")", "]", "}", "'", '"', ").", '".'])(
    "keeps a trailing %j out of the link",
    (punctuation) => {
      const parts = splitLinks(`See https://example.com/a${punctuation}`);
      expect(parts).toEqual([
        { text: "See " },
        { text: "https://example.com/a", href: "https://example.com/a" },
        { text: punctuation },
      ]);
    },
  );

  test("adds https to a www link", () => {
    expect(splitLinks("www.example.com")).toEqual([{ text: "www.example.com", href: "https://www.example.com/" }]);
  });

  test("finds several links", () => {
    const links = splitLinks("https://a.example, and http://b.example.").filter((part) => "href" in part);
    expect(links.map((part) => part.text)).toEqual(["https://a.example", "http://b.example"]);
  });

  test("handles a link in brackets", () => {
    expect(splitLinks("(https://example.com)")).toEqual([
      { text: "(" },
      { text: "https://example.com", href: "https://example.com/" },
      { text: ")" },
    ]);
  });

  test.each([
    "https://example.com/a, then (www.example.org). Done!",
    "Nothing to see",
    "www. isn't a link, nor is https:// on its own.",
    "javascript:alert(1) stays plain text",
    "two https://a.example https://b.example links",
  ])("loses no text: %j", (text) => {
    expect(
      splitLinks(text)
        .map((part) => part.text)
        .join(""),
    ).toBe(text);
  });

  test("never makes a link that isn't http or https", () => {
    const parts = splitLinks("javascript:alert(1) data:text/html,x vbscript:x");
    expect(parts.some((part) => "href" in part)).toBe(false);
  });
});

describe("formatEventDate", () => {
  test("formats a stored date", () => {
    expect(formatEventDate("2026-11-14")).toBe("Sat, 14 Nov 2026");
    expect(formatEventDate("2026-01-01")).toBe("Thu, 1 Jan 2026");
  });

  test("doesn't move across midnight, whatever the time zone", () => {
    expect(formatEventDate("2026-12-31")).toBe("Thu, 31 Dec 2026");
  });

  test.each(["", "TBA", "14 Nov 2026", "2026-11", "2026-13-01", "2026-11-99"])("leaves %j as it is", (date) => {
    expect(formatEventDate(date)).toBe(date);
  });

  test("leaves a date that doesn't exist as it is", () => {
    expect(formatEventDate("2026-02-30")).toBe("2026-02-30");
  });
});

describe("festDate", () => {
  test.each([
    ["2026-11-14T18:29:00Z", "2026-11-14"],
    ["2026-11-14T18:30:00Z", "2026-11-15"],
    ["2026-11-14T00:00:00Z", "2026-11-14"],
    ["2026-12-31T18:30:00Z", "2027-01-01"],
  ])("%s is %s at the fest", (instant, expected) => {
    expect(festDate(new Date(instant))).toBe(expected);
  });
});

describe("eventsForPrompt", () => {
  test("replaces the ID with a short ref and leaves out empty fields", () => {
    const [details] = eventsForPrompt([festEvent({ venue: "Main hall", fee: "" })]);
    expect(details).toEqual({ ref: "a1b2c3d4", name: "Hackathon", venue: "Main hall" });
  });

  test("includes custom sections only when there are some", () => {
    const sections = [{ title: "Rules", content: "Be kind" }];
    expect(eventsForPrompt([festEvent()])[0]).not.toHaveProperty("custom_sections");
    expect(eventsForPrompt([festEvent({ custom_sections: sections })])[0].custom_sections).toEqual(sections);
  });

  test("fields come out in the same order whatever order they were given in", () => {
    const shuffled = Object.fromEntries(Object.entries(festEvent({ venue: "Hall", date: "2026-11-14" })).reverse());
    const a = JSON.stringify(eventsForPrompt([shuffled as FestEvent]));
    const b = JSON.stringify(eventsForPrompt([festEvent({ venue: "Hall", date: "2026-11-14" })]));
    expect(a).toBe(b);
  });

  test("eventRef is the first 8 characters of the ID", () => {
    expect(eventRef("a1b2c3d4-0000-4000-8000-000000000000")).toBe("a1b2c3d4");
  });
});

describe("chatSystem", () => {
  const events = [festEvent({ venue: "Main hall" })];
  const morning = chatSystem(events, new Date("2026-11-14T03:00:00Z"));
  const night = chatSystem(events, new Date("2026-11-15T17:45:00Z"));

  test("marks only the first block for caching", () => {
    expect(morning).toHaveLength(2);
    expect(morning[0].cache_control).toEqual({ type: "ephemeral" });
    expect(morning[1]).not.toHaveProperty("cache_control");
  });

  test("the first block is byte-identical at two different times", () => {
    expect(night[0].text).toBe(morning[0].text);
    expect(night[0]).toEqual(morning[0]);
  });

  test("the time goes in the second block, in India time", () => {
    expect(morning[1].text).toBe("Right now it's Saturday, 14 November 2026, 8:30 am India time.");
    expect(night[1].text).toBe("Right now it's Sunday, 15 November 2026, 11:15 pm India time.");
  });

  test.each([
    ["2026-11-14T18:30:00Z", "Sunday, 15 November 2026, 12:00 am"],
    ["2026-11-15T06:30:00Z", "Sunday, 15 November 2026, 12:00 pm"],
  ])("%s reads as %s", (instant, expected) => {
    expect(chatSystem(events, new Date(instant))[1].text).toContain(expected);
  });

  test("the first block has the events, without their full IDs", () => {
    expect(morning[0].text).toContain('"ref":"a1b2c3d4"');
    expect(morning[0].text).toContain('"venue":"Main hall"');
    expect(morning[0].text).not.toContain(events[0].id);
  });

  test("copes with no events", () => {
    expect(chatSystem([])[0].text).toContain("<events>\n[]\n</events>");
  });
});

describe("posterPrompt", () => {
  test("uses today's date at the fest and the number of posters", () => {
    expect(posterPrompt(1)).toContain("This image should be a poster");
    expect(posterPrompt(3)).toContain("These 3 images should be posters");
    expect(posterPrompt(1)).toContain(`Today's date is ${festDate()}.`);
  });
});

describe("apiErrorMessage", () => {
  const headers = new Headers();
  const CASES: [Error, string][] = [
    [new Anthropic.AuthenticationError(401, undefined, "bad key", headers), "The API key was rejected. Check the key in .env.local."],
    [new Anthropic.RateLimitError(429, undefined, "slow", headers), "Too many requests right now. Please try again in a moment."],
    [new Anthropic.APIConnectionTimeoutError(), "The AI service took too long to respond. Please try again."],
    [new Anthropic.APIUserAbortError(), "The AI service took too long to respond. Please try again."],
    [new Anthropic.APIConnectionError({ message: "down" }), "Couldn't reach the AI service. Check your internet connection."],
    [new Anthropic.InternalServerError(500, undefined, "oops", headers), "The AI service returned an error (500)."],
    [new Anthropic.APIError(undefined, undefined, "mid-stream", headers), "Something went wrong. Please try again."],
    [new Error("Anthropic said something odd"), "Something went wrong. Please try again."],
  ];

  test.each(CASES)("%s", (error, expected) => {
    expect(apiErrorMessage(error)).toBe(expected);
  });

  test("never names the AI provider", () => {
    for (const [error] of CASES) expect(apiErrorMessage(error)).not.toMatch(/anthropic|claude/i);
    expect(apiErrorMessage("just a string")).not.toMatch(/anthropic|claude/i);
  });
});

describe("cleanEvent", () => {
  test("keeps only known fields, trimmed", () => {
    const cleaned = cleanEvent({ id: "forced-id", name: "  Hackathon  ", venue: "Hall", role: "organiser", "name; DROP": "x" });
    expect(cleaned).toEqual({ ...EMPTY_EVENT, name: "Hackathon", venue: "Hall" });
  });

  test.each([[null], [undefined], [5], ["text"], [[]]])("copes with the body %j", (body) => {
    expect(cleanEvent(body)).toEqual(EMPTY_EVENT);
  });

  test("turns anything that isn't text into an empty field", () => {
    expect(cleanEvent({ name: 5, venue: { a: 1 }, fee: null }).name).toBe("");
  });

  test("cuts long fields", () => {
    expect(cleanEvent({ name: "x".repeat(3000) }).name).toHaveLength(2000);
  });

  test("keeps sections with both a heading and details, up to the limits", () => {
    const { custom_sections } = cleanEvent({
      custom_sections: [
        { title: " Rules ", content: " Be kind " },
        { title: "", content: "No heading" },
        { title: "No details", content: "  " },
        { title: 5, content: "Number heading" },
        null,
        "text",
        { title: "x".repeat(200), content: "y".repeat(6000) },
      ],
    });
    expect(custom_sections).toEqual([
      { title: "Rules", content: "Be kind" },
      { title: "x".repeat(100), content: "y".repeat(5000) },
    ]);
  });

  test("keeps at most 20 sections, and ignores anything that isn't a list", () => {
    const many = Array.from({ length: 30 }, (_, index) => ({ title: `T${index}`, content: "C" }));
    expect(cleanEvent({ custom_sections: many }).custom_sections).toHaveLength(20);
    expect(cleanEvent({ custom_sections: "nope" }).custom_sections).toEqual([]);
  });
});
