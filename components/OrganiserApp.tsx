"use client";

import { Camera, CircleAlert, ImageUp, LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { AppHeader } from "@/components/AppHeader";
import type { Role } from "@/lib/roles";
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

const MAX_POSTERS = 5;
// Keeps all posters together under Vercel's request size limit of about 4.5 MB.
const MAX_POSTER_DATA_URL_LENGTH = 800_000;
const SHRINK_STEPS = [
  { side: 2000, quality: 0.85 },
  { side: 2000, quality: 0.7 },
  { side: 1600, quality: 0.7 },
  { side: 1200, quality: 0.7 },
  { side: 1000, quality: 0.6 },
];

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("unreadable image"));
    };
    image.src = url;
  });
}

// Phone photos can be very large, so shrink them until they fit before sending.
async function shrinkImage(file: File) {
  const image = await loadImage(file);
  let dataUrl = "";
  for (const { side, quality } of SHRINK_STEPS) {
    const scale = Math.min(1, side / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no canvas");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    dataUrl = canvas.toDataURL("image/jpeg", quality);
    if (dataUrl.length <= MAX_POSTER_DATA_URL_LENGTH) break;
  }
  return dataUrl;
}

async function errorFrom(response: Response) {
  const body = await response.json().catch(() => ({}));
  return (body.error as string) || "Something went wrong. Please try again.";
}

function formatEventLine(event: FestEvent) {
  return [event.date, event.start_time, event.venue].filter(Boolean).join(" · ") || "No date or venue yet";
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export function OrganiserApp({ role }: { role: Role }) {
  const [mode, setMode] = useState<Mode>("poster");
  const [details, setDetails] = useState<EventDetails>(EMPTY_EVENT);
  const [uncertain, setUncertain] = useState<EventField[]>([]);
  const [addedSections, setAddedSections] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [posters, setPosters] = useState<string[]>([]);
  const [extracted, setExtracted] = useState(false);
  const [adding, setAdding] = useState(false);
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
    setPosters([]);
    setExtracted(false);
    setPosterError("");
    setNameError("");
    setFormError("");
    setMode(nextMode);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function addPosters(files: File[]) {
    if (files.length === 0) return;
    setPosterError("");
    setSaved("");
    if (files.some((file) => !file.type.startsWith("image/"))) {
      setPosterError("Please choose image files, such as JPG or PNG.");
      return;
    }
    const room = MAX_POSTERS - posters.length;
    if (files.length > room) {
      setPosterError(`You can add up to ${MAX_POSTERS} posters for one event.`);
      return;
    }
    setAdding(true);
    try {
      const added = await Promise.all(files.map(shrinkImage));
      setPosters((current) => [...current, ...added]);
    } catch {
      setPosterError("Couldn't open that image. Try a different file, or enter the details manually.");
    } finally {
      setAdding(false);
    }
  }

  async function readPosters() {
    setPosterError("");
    setReading(true);
    try {
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          images: posters.map((poster) => ({ data: poster.split(",")[1], mediaType: "image/jpeg" })),
        }),
      });
      if (!response.ok) {
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
      setExtracted(true);
    } catch {
      setPosterError("Couldn't reach the server. Please try again.");
    } finally {
      setReading(false);
    }
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (!reading && !adding) addPosters([...event.dataTransfer.files]);
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

  const showForm = mode === "manual" || extracted;
  const posterWord = posters.length === 1 ? "poster" : "posters";

  return (
    <div className="min-h-dvh pb-12">
      <AppHeader role={role} />

      <main className="mx-auto max-w-5xl space-y-6 px-4 pt-8">
        <div>
          <h1 ref={formTop} className="scroll-mt-4 text-3xl font-semibold tracking-tight">
            {editingId ? "Edit event" : "Add an event"}
          </h1>
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
                {option === "poster" ? "From posters" : "Enter manually"}
              </button>
            ))}
          </div>
        )}

        {saved && (
          <p role="status" className="rounded-xl bg-accent-soft p-3 text-[15px]">{saved}</p>
        )}

        {mode === "poster" && !extracted && (
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
              <span className="mt-3 text-lg font-medium">Drop posters here, or choose files</span>
              <span className="mt-1 max-w-md text-[15px] text-muted">
                Add up to {MAX_POSTERS} posters for one event. AI reads them together and fills in the details for you
                to check. The images are sent to an AI service for this. Nothing is saved until you press Save.
              </span>
              <input
                ref={fileInput}
                id="poster"
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,image/gif"
                disabled={reading || adding}
                onChange={(event) => {
                  addPosters([...(event.target.files ?? [])]);
                  event.target.value = "";
                }}
                className="sr-only"
              />
            </label>
            {/* Only shown on touch devices, where capture opens the camera directly. */}
            <label className="mt-3 hidden min-h-11 w-full items-center justify-center gap-2 rounded-full border border-control-line px-6 font-medium transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent pointer-coarse:flex">
              <Camera aria-hidden className="size-5" />
              {posters.length > 0 ? "Take another photo" : "Take a photo of the poster"}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                disabled={reading || adding}
                onChange={(event) => {
                  addPosters([...(event.target.files ?? [])]);
                  event.target.value = "";
                }}
                className="sr-only"
              />
            </label>

            {posters.length > 0 && (
              <div className="mt-4 rounded-2xl bg-surface p-4">
                <p className="text-[15px] font-semibold">
                  {posters.length} {posterWord} added
                </p>
                <ul className="mt-3 flex flex-wrap gap-3">
                  {posters.map((poster, index) => (
                    <li key={index} className="w-28">
                      {/* A local data URL from the organiser's own file, so next/image doesn't apply. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={poster} alt={`Poster ${index + 1}`} className="h-36 w-28 rounded-lg border border-line object-cover" />
                      <button
                        type="button"
                        disabled={reading}
                        aria-label={`Remove poster ${index + 1}`}
                        onClick={() => setPosters((current) => current.filter((_, i) => i !== index))}
                        className="mt-1 inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-[15px] font-medium text-danger transition-colors hover:bg-danger-soft disabled:opacity-40"
                      >
                        <Trash2 aria-hidden className="size-4" />
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={reading || adding}
                  onClick={readPosters}
                  className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-accent px-6 font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-40"
                >
                  {reading && <LoaderCircle aria-hidden className="size-5 animate-spin" />}
                  {reading ? `Reading ${posterWord}…` : `Read ${posters.length} ${posterWord} with AI`}
                </button>
                {reading && (
                  <p role="status" className="mt-2 text-sm text-muted">
                    This can take a few seconds.
                  </p>
                )}
              </div>
            )}

            {posterError && (
              <p role="alert" className="mt-3 flex items-start gap-2 text-[15px] text-danger">
                <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                {posterError}
              </p>
            )}
          </div>
        )}

        {showForm && (
          <div className={extracted ? "grid items-start gap-6 lg:grid-cols-[280px_1fr]" : ""}>
            {extracted && (
              <figure className="lg:sticky lg:top-4">
                <div className="flex gap-3 overflow-x-auto lg:max-h-[75vh] lg:flex-col lg:overflow-x-visible lg:overflow-y-auto">
                  {posters.map((poster, index) => (
                    // A local data URL from the organiser's own file, so next/image doesn't apply.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={index}
                      src={poster}
                      alt={`Poster ${index + 1} of ${posters.length}`}
                      className="max-h-96 w-auto shrink-0 rounded-xl border border-line lg:max-h-none lg:w-full"
                    />
                  ))}
                </div>
                <figcaption className="mt-2 text-sm text-muted">
                  Compare {posters.length === 1 ? "this" : "these"} with the details before saving.
                  {" "}
                  <button
                    type="button"
                    onClick={() => resetForm("poster")}
                    className="font-medium text-accent underline underline-offset-4"
                  >
                    Use different posters
                  </button>
                </figcaption>
              </figure>
            )}

            <form onSubmit={save} noValidate className="space-y-6">
              {extracted && (uncertain.length > 0 || addedSections > 0) && (
                <p className="flex items-start gap-2 rounded-xl border border-check-line bg-check-soft p-3 text-[15px] text-check">
                  <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                  {[
                    uncertain.length > 0 &&
                      `${uncertain.length === 1 ? "1 detail needs" : `${uncertain.length} details need`} checking, marked "Check this".`,
                    addedSections > 0 &&
                      `${addedSections === 1 ? "1 extra section was" : `${addedSections} extra sections were`} added further down, which you can edit or remove.`,
                  ]
                    .filter(Boolean)
                    .join(" ")}
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
