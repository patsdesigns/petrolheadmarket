import { z } from "zod";
import type { Listing } from "../db/schema";
import {
  BODY_STYLES,
  DRIVETRAINS,
  TITLE_STATUSES,
  TRANSMISSIONS,
  US_STATES,
  MIN_DESCRIPTION,
  MIN_PHOTOS,
} from "./listing-options";

const values = <T extends readonly { value: string }[]>(list: T) =>
  list.map((o) => o.value) as [T[number]["value"], ...T[number]["value"][]];

/** Blank strings become null so clearing a field clears it in the draft. */
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max.toLocaleString("en-US")} characters or fewer.`)
    .transform((v) => (v === "" ? null : v));

const whole = (label: string, min: number, max: number | (() => number)) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") return null;
      const n = Number(v.replace(/[,$\s]/g, ""));
      // Evaluated per request: Workers report 1970 while a module is loading.
      const upper = typeof max === "function" ? max() : max;
      if (!Number.isInteger(n) || n < min || n > upper) {
        ctx.addIssue({ code: "custom", message: `Enter ${label} as a whole number.` });
        return z.NEVER;
      }
      return n;
    });

const choice = <T extends [string, ...string[]]>(opts: T, message: string) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") return null;
      if (!opts.includes(v)) {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      return v as T[number];
    });

const checkbox = z
  .string()
  .optional()
  .transform((v) => v === "on" || v === "true");

export const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

/** Field rules for saving a draft. Each field is optional; required checks happen at submit. */
export const FIELD_RULES = {
  year: whole("a year", 1886, () => new Date().getUTCFullYear() + 1),
  make: text(40),
  model: text(60),
  bodyStyle: choice(values(BODY_STYLES), "Pick a body style."),
  engine: text(60),
  transmission: choice(values(TRANSMISSIONS), "Pick a transmission."),
  drivetrain: choice(values(DRIVETRAINS), "Pick a drivetrain."),
  exteriorColor: text(40),
  interiorColor: text(40),
  mileage: whole("the mileage", 0, 2_000_000),
  vin: z
    .string()
    .trim()
    .toUpperCase()
    .transform((v, ctx) => {
      const clean = v.replace(/[\s-]/g, "");
      if (clean === "") return null;
      if (clean.length > 17) {
        ctx.addIssue({ code: "custom", message: "A VIN is 17 characters." });
        return z.NEVER;
      }
      return clean;
    }),
  headline: text(90),

  description: text(8000),
  highlights: text(3000),
  knownIssues: text(3000),
  modifications: text(3000),
  serviceHistory: text(6000),
  ownerCount: whole("the number of owners", 1, 50),
  titleStatus: choice(values(TITLE_STATUSES), "Pick a title status."),
  titleState: choice([...US_STATES] as [string, ...string[]], "Pick the state on the title."),
  recordsOnFile: checkbox,
  videoUrl: z
    .string()
    .trim()
    .max(300)
    .transform((v, ctx) => {
      if (v === "") return null;
      try {
        const u = new URL(v);
        const host = u.hostname.replace(/^www\./, "");
        if (u.protocol === "https:" && ["youtube.com", "youtu.be", "m.youtube.com", "vimeo.com"].includes(host)) return v;
      } catch {}
      ctx.addIssue({ code: "custom", message: "Use a YouTube or Vimeo link." });
      return z.NEVER;
    }),

  price: whole("the price in whole dollars", 500, 50_000_000),
  acceptsOffers: checkbox,
  locationCity: text(60),
  locationState: choice([...US_STATES] as [string, ...string[]], "Pick a state."),
  contactMethod: z.enum(["messages", "messages_phone"]).catch("messages"),
  contactPhone: z
    .string()
    .trim()
    .max(25)
    .transform((v, ctx) => {
      if (v === "") return null;
      if (!/^[+()\d\s.-]+$/.test(v) || v.replace(/\D/g, "").length < 10) {
        ctx.addIssue({ code: "custom", message: "Enter a phone number with area code." });
        return z.NEVER;
      }
      return v;
    }),
} as const;

export type ListingField = keyof typeof FIELD_RULES;

export const STEPS = [
  {
    key: "car",
    title: "The car",
    fields: ["year", "make", "model", "bodyStyle", "engine", "transmission", "drivetrain", "exteriorColor", "interiorColor", "mileage", "vin", "headline"],
  },
  {
    key: "history",
    title: "Condition and history",
    fields: ["description", "highlights", "knownIssues", "modifications", "serviceHistory", "ownerCount", "titleStatus", "titleState", "recordsOnFile", "videoUrl"],
  },
  { key: "photos", title: "Photos", fields: [] },
  {
    key: "price",
    title: "Price and contact",
    fields: ["price", "acceptsOffers", "locationCity", "locationState", "contactMethod", "contactPhone"],
  },
  { key: "review", title: "Review and submit", fields: [] },
] as const satisfies readonly { key: string; title: string; fields: readonly ListingField[] }[];

export type StepKey = (typeof STEPS)[number]["key"];

/**
 * Validate the fields of one step from a submitted form. Valid values are
 * returned for saving even when other fields have errors, so autosave never
 * loses work.
 */
/** "Clean title, CA", or just the status when there is no title. */
export function titleText(titleStatusLabel: string, listing: Pick<Listing, "titleStatus" | "titleState">): string {
  const state = listing.titleStatus === "none" ? "" : listing.titleState;
  return [titleStatusLabel, state].filter(Boolean).join(", ");
}

export function parseStep(step: StepKey, form: Record<string, string>) {
  const def = STEPS.find((s) => s.key === step)!;
  const data: Partial<Record<ListingField, unknown>> = {};
  const errors: Partial<Record<ListingField, string>> = {};
  for (const field of def.fields as readonly ListingField[]) {
    const result = (FIELD_RULES[field] as z.ZodType).safeParse(form[field] ?? "");
    if (result.success) data[field] = result.data;
    else errors[field] = result.error.issues[0]?.message ?? "Check this field.";
  }
  // No title (bill of sale) means there is no title state: clear any old one.
  if (data.titleStatus === "none") {
    data.titleState = null;
    delete errors.titleState;
  }
  return { data: data as Partial<Listing>, errors };
}

const NONE_ANSWERS = /^(none|no|n\/?a|nothing|no issues?|zero|perfect|none known|nothing to report)[.!]*$/i;

export interface ChecklistItem {
  step: StepKey;
  field?: ListingField;
  message: string;
}

/**
 * The review checklist (CLAUDE.md). Used by the wizard to show what is left
 * and by the server before a listing can be submitted.
 */
export function checklist(listing: Listing, photoCount: number): ChecklistItem[] {
  const issues: ChecklistItem[] = [];
  const need = (step: StepKey, field: ListingField, ok: unknown, message: string) => {
    if (!ok) issues.push({ step, field, message });
  };

  need("car", "year", listing.year, "Add the year.");
  need("car", "make", listing.make, "Add the make.");
  need("car", "model", listing.model, "Add the model.");
  need("car", "mileage", listing.mileage !== null && listing.mileage !== undefined, "Add the mileage.");
  need("car", "transmission", listing.transmission, "Pick the transmission.");
  if (listing.year && listing.year >= 1981) {
    need("car", "vin", listing.vin, "Add the VIN. Cars from 1981 on have a 17 character VIN.");
    if (listing.vin && !VIN_PATTERN.test(listing.vin)) {
      issues.push({
        step: "car",
        field: "vin",
        message: "Check the VIN. It should be 17 letters and numbers, with no I, O or Q.",
      });
    }
  }

  const descLen = listing.description?.length ?? 0;
  if (descLen < MIN_DESCRIPTION) {
    issues.push({
      step: "history",
      field: "description",
      message: descLen
        ? `Write a little more in the description (${descLen} of ${MIN_DESCRIPTION} characters).`
        : `Write a description of at least ${MIN_DESCRIPTION} characters.`,
    });
  }
  if (!listing.knownIssues) {
    issues.push({ step: "history", field: "knownIssues", message: "Tell buyers about any known issues." });
  } else if (NONE_ANSWERS.test(listing.knownIssues.trim())) {
    issues.push({
      step: "history",
      field: "knownIssues",
      message:
        "Every used car has some wear. Tell buyers about chips, scuffs, leaks or anything a careful inspection would find. Honest listings sell faster here.",
    });
  }
  need("history", "titleStatus", listing.titleStatus, "Pick the title status.");
  if (listing.titleStatus !== "none") need("history", "titleState", listing.titleState, "Pick the state on the title.");

  if (photoCount < MIN_PHOTOS) {
    issues.push({
      step: "photos",
      message: `Add at least ${MIN_PHOTOS} photos (you have ${photoCount}).`,
    });
  }

  need("price", "price", listing.price, "Set your price.");
  need("price", "locationCity", listing.locationCity, "Add the city where the car is.");
  need("price", "locationState", listing.locationState, "Pick the state where the car is.");
  if (listing.contactMethod === "messages_phone") {
    need("price", "contactPhone", listing.contactPhone, "Add the phone number buyers should call.");
  }

  return issues;
}

export function listingTitle(l: Pick<Listing, "year" | "make" | "model">): string {
  const t = [l.year, l.make, l.model].filter(Boolean).join(" ");
  return t || "Untitled listing";
}

export function formatPrice(n: number | null | undefined): string {
  return n === null || n === undefined ? "" : `$${n.toLocaleString("en-US")}`;
}

export function formatMiles(n: number | null | undefined): string {
  return n === null || n === undefined ? "" : n.toLocaleString("en-US");
}
