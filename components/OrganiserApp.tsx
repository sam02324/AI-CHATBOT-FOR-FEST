"use client";

import { UserButton } from "@clerk/nextjs";
import { Camera, CircleAlert, ImageUp, LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import {
  EMPTY_EVENT,
  EVENT_FIELDS,
  type CustomSection,
  type EventDetails,
  type EventField,
  type FestEvent,
} from "@/lib/event-fields";

type Mode = "poster" | "manual";

type FieldConfig = { key: EventField; label: string; type?: "date" | "textarea"; placeholder?: string; wide?: boolean };

const SECTIONS: { title: string; fields: FieldConfig[] }[] = [
  {
    title: "About the event",
    fields: [
      { key: "name", label: "Event name", wide: true },
      { key: "description", label: "Description", type: "textarea", wide: true },
      { key: "category", label: "Category", placeholder: "Dance, coding, quiz" },
      { key: "organiser", label: "Organised by" },
    ],
  },
  {
    title: "When and where",
    fields: [
      { key: "date", label: "Date", type: "date" },
      { key: "venue", label: "Venue" },
      { key: "start_time", label: "Start time", placeholder: "10:00 AM" },
      { key: "end_time", label: "End time", placeholder: "1:00 PM" },
    ],
  },
  {
    title: "Taking part",
    fields: [
      { key: "registration_link", label: "Registration link", wide: true },
      { key: "fee", label: "Fee" },
      { key: "team_size", label: "Team size" },
      { key: "eligibility", label: "Who can take part" },
      { key: "prizes", label: "Prizes" },
    ],
  },
  {
    title: "Anything else",
    fields: [
      { key: "coordinator_contact", label: "Coordinator contact", wide: true },
      { key: "notes", label: "Other details", type: "textarea", wide: true },
    ],
  },
];

const inputClass =
  "min-h-11 w-full rounded-lg border bg-transparent px-3 py-2 text-base placeholder:text-muted";

// Phone photos can be very large, so shrink them before sending.
function shrinkImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, 2000 / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      const context = canvas.getContext("2d");
      if (!context) return reject(new Error("no canvas"));
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("unreadable image"));
    };
    image.src = url;
  });
}

async function errorFrom(response: Response) {
  const body = await response.json().catch(() => ({}));
  return (body.error as string) || "Something went wrong. Please try again.";
}

function formatEventLine(event: FestEvent) {
  return [event.date, event.start_time, event.venue].filter(Boolean).join(" · ") || "No date or venue yet";
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export function OrganiserApp() {
  const [mode, setMode] = useState<Mode>("poster");
  const [details, setDetails] = useState<EventDetails>(EMPTY_EVENT);
  const [uncertain, setUncertain] = useState<EventField[]>([]);
  const [addedSections, setAddedSections] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [poster, setPoster] = useState("");
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [posterError, setPosterError] = useState("");
  const [nameError, setNameError] = useState("");
  const [formError, setFormError] = useState("");
  const [saved, setSaved] = useState("");
  const [events, setEvents] = useState<FestEvent[] | null>(null);
  const [listError, setListError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const formTop = useRef<HTMLHeadingElement>(null);

  async function loadEvents() {
    try {
      const response = await fetch("/api/events");
      if (!response.ok) throw new Error();
      setEvents(await response.json());
      setListError("");
    } catch {
      setListError("Couldn't load events. Refresh the page to try again.");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadEvents();
  }, []);

  function resetForm(nextMode: Mode = mode) {
    setDetails(EMPTY_EVENT);
    setUncertain([]);
    setAddedSections(0);
    setEditingId(null);
    setPoster("");
    setPosterError("");
    setNameError("");
    setFormError("");
    setMode(nextMode);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function readPoster(file: File | undefined) {
    if (!file) return;
    setPosterError("");
    setSaved("");
    if (!file.type.startsWith("image/")) {
      setPosterError("Please choose an image file, such as a JPG or PNG.");
      return;
    }
    setReading(true);
    try {
      const dataUrl = await shrinkImage(file);
      setPoster(dataUrl);
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ image: dataUrl.split(",")[1], mediaType: "image/jpeg" }),
      });
      if (!response.ok) {
        setPoster("");
        setPosterError(await errorFrom(response));
        return;
      }
      const data = (await response.json()) as Partial<Record<EventField, string | null>> & {
        custom_sections: CustomSection[];
        uncertain_fields: string[];
      };
      const next = { ...EMPTY_EVENT };
      const flagged = new Set(data.uncertain_fields.filter((f): f is EventField => EVENT_FIELDS.includes(f as EventField)));
      for (const field of EVENT_FIELDS) next[field] = data[field] ?? "";
      next.custom_sections = data.custom_sections;
      if (next.date && !/^\d{4}-\d{2}-\d{2}$/.test(next.date)) {
        next.date = "";
        flagged.add("date");
      }
      setDetails(next);
      setUncertain([...flagged]);
      setAddedSections(data.custom_sections.length);
    } catch {
      setPoster("");
      setPosterError("Couldn't open that image. Try a different file, or enter the details manually.");
    } finally {
      setReading(false);
    }
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (!reading) readPoster(event.dataTransfer.files[0]);
  }

  function setField(field: EventField, value: string) {
    setDetails((current) => ({ ...current, [field]: value }));
    setUncertain((current) => current.filter((item) => item !== field));
    if (field === "name") setNameError("");
  }

  function setSections(sections: CustomSection[]) {
    setDetails((current) => ({ ...current, custom_sections: sections }));
  }

  function updateSection(index: number, change: Partial<CustomSection>) {
    setSections(details.custom_sections.map((section, i) => (i === index ? { ...section, ...change } : section)));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setFormError("");
    setSaved("");
    if (!details.name.trim()) {
      setNameError("Enter the event name.");
      nameInput.current?.focus();
      return;
    }
    const incomplete = details.custom_sections.findIndex((section) => !section.title.trim() !== !section.content.trim());
    if (incomplete !== -1) {
      setFormError(`Section ${incomplete + 1} needs both a heading and details, or remove it.`);
      return;
    }
    try {
      const response = await fetch(editingId ? `/api/events/${editingId}` : "/api/events", {
        method: editingId ? "PUT" : "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(details),
      });
      if (!response.ok) {
        setFormError(await errorFrom(response));
        return;
      }
      const name = details.name.trim();
      resetForm();
      setSaved(`${name} is saved. The chatbot can now answer questions about it.`);
      loadEvents();
    } catch {
      setFormError("Couldn't reach the server. Your details are still here, so please try again.");
    }
  }

  function startEdit(item: FestEvent) {
    resetForm("manual");
    const { id, ...rest } = item;
    setDetails(rest);
    setEditingId(id);
    setSaved("");
    formTop.current?.scrollIntoView({ behavior: "smooth" });
  }

  async function remove(item: FestEvent) {
    if (!confirm(`Delete "${item.name}"? The chatbot will stop answering questions about it.`)) return;
    setListError("");
    try {
      const response = await fetch(`/api/events/${item.id}`, { method: "DELETE" });
      if (!response.ok) {
        setListError(await errorFrom(response));
        return;
      }
      if (editingId === item.id) resetForm();
      loadEvents();
    } catch {
      setListError("Couldn't reach the server. Please try again.");
    }
  }

  const showForm = mode === "manual" || Boolean(poster && !reading);

  return (
    <div className="min-h-dvh pb-12">
      <header className="border-b border-line bg-surface px-4 py-3">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <h1 className="text-[17px] font-semibold">Fest Organiser</h1>
          <div className="flex items-center gap-4">
            <Link href="/chat" className="flex min-h-11 items-center text-[15px] font-medium text-accent underline-offset-4 hover:underline">
              Open chat
            </Link>
            <UserButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 pt-8">
        <div>
          <h2 ref={formTop} className="scroll-mt-4 text-3xl font-semibold tracking-tight">
            {editingId ? "Edit event" : "Add an event"}
          </h2>
          <p className="mt-2 text-muted">Attendants can ask the chatbot about any event you save here.</p>
        </div>

        {!editingId && (
          <div role="group" aria-label="How to add the event" className="inline-flex rounded-xl bg-line p-1">
            {(["poster", "manual"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={mode === option}
                onClick={() => {
                  setMode(option);
                  setPosterError("");
                }}
                className={`min-h-10 rounded-lg px-4 text-[15px] font-medium transition-colors ${
                  mode === option ? "bg-surface shadow-sm" : "text-muted"
                }`}
              >
                {option === "poster" ? "From a poster" : "Enter manually"}
              </button>
            ))}
          </div>
        )}

        {saved && (
          <p role="status" className="rounded-xl bg-accent-soft p-3 text-[15px]">{saved}</p>
        )}

        {mode === "poster" && !poster && (
          <div>
            <label
              htmlFor="poster"
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              className={`flex min-h-56 flex-col items-center justify-center rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${
                dragging ? "border-accent bg-accent-soft" : "border-control-line bg-surface hover:bg-accent-soft"
              }`}
            >
              <ImageUp aria-hidden className="size-8 text-accent" />
              <span className="mt-3 text-lg font-medium">Drop a poster here, or choose a file</span>
              <span className="mt-1 max-w-md text-[15px] text-muted">
                Claude reads the poster and fills in the details for you to check. The image is sent to Anthropic for
                this. Nothing is saved until you press Save.
              </span>
              <input
                ref={fileInput}
                id="poster"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                disabled={reading}
                onChange={(event) => readPoster(event.target.files?.[0])}
                className="sr-only"
              />
            </label>
            {/* Only shown on touch devices, where capture opens the camera directly. */}
            <label className="mt-3 hidden min-h-11 w-full items-center justify-center gap-2 rounded-full bg-accent px-6 font-medium text-on-accent transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent pointer-coarse:flex">
              <Camera aria-hidden className="size-5" />
              Take a photo of the poster
              <input
                type="file"
                accept="image/*"
                capture="environment"
                disabled={reading}
                onChange={(event) => {
                  readPoster(event.target.files?.[0]);
                  event.target.value = "";
                }}
                className="sr-only"
              />
            </label>
            {posterError && (
              <p role="alert" className="mt-3 flex items-start gap-2 text-[15px] text-danger">
                <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                {posterError}
              </p>
            )}
          </div>
        )}

        {reading && poster && (
          <div role="status" className="flex items-center gap-3 rounded-2xl bg-surface p-6">
            <LoaderCircle aria-hidden className="size-5 animate-spin text-accent" />
            <span>Reading the poster. This can take a few seconds.</span>
          </div>
        )}

        {showForm && (
          <div className={poster ? "grid items-start gap-6 lg:grid-cols-[280px_1fr]" : ""}>
            {poster && (
              <figure className="lg:sticky lg:top-4">
                {/* A local data URL from the organiser's own file, so next/image doesn't apply. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={poster} alt="The poster you uploaded" className="max-h-96 w-auto rounded-xl border border-line lg:max-h-[80vh]" />
                <figcaption className="mt-2 text-sm text-muted">
                  Compare this with the details before saving.
                  {" "}
                  <button
                    type="button"
                    onClick={() => resetForm("poster")}
                    className="font-medium text-accent underline underline-offset-4"
                  >
                    Use a different poster
                  </button>
                </figcaption>
              </figure>
            )}

            <form onSubmit={save} noValidate className="space-y-6">
              {poster && (
                <p className="flex items-start gap-2 rounded-xl border border-check-line bg-check-soft p-3 text-[15px] text-check">
                  <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                  {uncertain.length > 0
                    ? `Claude wasn't sure about ${uncertain.length === 1 ? "1 detail" : `${uncertain.length} details`}, marked "Check this". Review everything before saving.`
                    : "Claude can make mistakes, so review everything before saving."}
                  {addedSections > 0 &&
                    ` It also added ${addedSections === 1 ? "1 extra section" : `${addedSections} extra sections`} further down, which you can edit or remove.`}
                </p>
              )}

              {SECTIONS.map((section) => (
                <fieldset key={section.title} className="rounded-2xl bg-surface p-4 sm:p-5">
                  <legend className="float-left mb-3 w-full text-[15px] font-semibold">{section.title}</legend>
                  <div className="clear-both grid gap-4 sm:grid-cols-2">
                    {section.fields.map((field) => {
                      const isUncertain = uncertain.includes(field.key);
                      const invalid = field.key === "name" && Boolean(nameError);
                      const border = invalid ? "border-danger" : isUncertain ? "border-check-line bg-check-soft" : "border-control-line";
                      const describedBy = invalid ? "name-error" : undefined;
                      return (
                        <div key={field.key} className={field.wide ? "sm:col-span-2" : ""}>
                          <label htmlFor={field.key} className="mb-1 flex flex-wrap items-center gap-2 text-sm font-medium">
                            {field.label}
                            {field.key === "name" && <span className="font-normal text-muted">(required)</span>}
                            {isUncertain && <span className="font-semibold text-check">Check this</span>}
                          </label>
                          {field.type === "textarea" ? (
                            <textarea
                              id={field.key}
                              rows={3}
                              value={details[field.key]}
                              onChange={(event) => setField(field.key, event.target.value)}
                              className={`${inputClass} ${border} resize-y`}
                            />
                          ) : (
                            <input
                              id={field.key}
                              ref={field.key === "name" ? nameInput : undefined}
                              type={field.type ?? "text"}
                              placeholder={field.placeholder}
                              value={details[field.key]}
                              aria-invalid={invalid}
                              aria-describedby={describedBy}
                              onChange={(event) => setField(field.key, event.target.value)}
                              className={`${inputClass} ${border}`}
                            />
                          )}
                          {invalid && (
                            <p id="name-error" role="alert" className="mt-1 text-sm text-danger">{nameError}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </fieldset>
              ))}

              <fieldset className="rounded-2xl bg-surface p-4 sm:p-5">
                <legend className="float-left w-full text-[15px] font-semibold">Extra sections</legend>
                <p className="clear-both mb-3 text-sm text-muted">
                  Add anything else attendants might ask about, such as rules, judging or a schedule.
                </p>
                <div className="space-y-4">
                  {details.custom_sections.map((section, index) => (
                    <div key={index} className="space-y-3 rounded-xl border border-line p-3">
                      <div>
                        <label htmlFor={`section-title-${index}`} className="mb-1 block text-sm font-medium">
                          Section {index + 1} heading
                        </label>
                        <input
                          id={`section-title-${index}`}
                          value={section.title}
                          maxLength={100}
                          placeholder="Rules"
                          onChange={(event) => updateSection(index, { title: event.target.value })}
                          className={`${inputClass} border-control-line`}
                        />
                      </div>
                      <div>
                        <label htmlFor={`section-content-${index}`} className="mb-1 block text-sm font-medium">
                          Section {index + 1} details
                        </label>
                        <textarea
                          id={`section-content-${index}`}
                          rows={3}
                          value={section.content}
                          maxLength={5000}
                          onChange={(event) => updateSection(index, { content: event.target.value })}
                          className={`${inputClass} border-control-line resize-y`}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setSections(details.custom_sections.filter((_, i) => i !== index))}
                        className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-[15px] font-medium text-danger transition-colors hover:bg-danger-soft"
                      >
                        <Trash2 aria-hidden className="size-4" />
                        Remove section {index + 1}
                      </button>
                    </div>
                  ))}
                </div>
                {details.custom_sections.length < 20 && (
                  <button
                    type="button"
                    onClick={() => setSections([...details.custom_sections, { title: "", content: "" }])}
                    className={`${details.custom_sections.length > 0 ? "mt-4 " : ""}inline-flex min-h-11 items-center gap-2 rounded-full border border-control-line px-4 text-[15px] font-medium transition-colors hover:bg-accent-soft`}
                  >
                    <Plus aria-hidden className="size-4" />
                    Add a section
                  </button>
                )}
              </fieldset>

              {formError && (
                <p role="alert" className="flex items-start gap-2 text-[15px] text-danger">
                  <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                  {formError}
                </p>
              )}

              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  className="min-h-11 rounded-full bg-accent px-6 font-medium text-on-accent transition-colors hover:bg-accent-hover"
                >
                  {editingId ? "Save changes" : "Save event"}
                </button>
                <button
                  type="button"
                  onClick={() => resetForm(editingId ? "poster" : mode)}
                  className="min-h-11 rounded-full px-5 font-medium text-accent transition-colors hover:bg-accent-soft"
                >
                  {editingId ? "Cancel" : "Clear"}
                </button>
              </div>
            </form>
          </div>
        )}

        <section aria-labelledby="saved-heading" className="pt-6">
          <h2 id="saved-heading" className="text-xl font-semibold tracking-tight">Saved events</h2>
          {listError && (
            <p role="alert" className="mt-3 text-[15px] text-danger">{listError}</p>
          )}
          {events && events.length === 0 && (
            <p className="mt-3 text-muted">No events yet. The chatbot can only answer once you add one.</p>
          )}
          {events && events.length > 0 && (
            <ul className="mt-3 divide-y divide-line rounded-2xl bg-surface">
              {events.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-medium [overflow-wrap:anywhere]">{item.name}</p>
                    <p className="text-[15px] text-muted [overflow-wrap:anywhere]">{formatEventLine(item)}</p>
                  </div>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => startEdit(item)}
                      className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-[15px] font-medium text-accent transition-colors hover:bg-accent-soft"
                    >
                      <Pencil aria-hidden className="size-4" />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(item)}
                      className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-[15px] font-medium text-danger transition-colors hover:bg-danger-soft"
                    >
                      <Trash2 aria-hidden className="size-4" />
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
