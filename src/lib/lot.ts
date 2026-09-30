import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { listingPhotos, listings } from "../db/schema";
import { BODY_STYLES, DRIVETRAINS, TRANSMISSIONS } from "./listing-options";
import { photoUrl } from "./paths";

// The Lot: search, filters and sort over every car on the site, run on the
// server. The whole Lot is read in one small query (only the columns the
// filters need), filtered and sorted here, and only the cars on the current
// page load their photos. That keeps the filter counts exact and is cheap
// for a curated marketplace (thousands of cars, not millions).

/** Statuses shown on the Lot. Sold cars keep their page but leave the Lot. */
export const LOT_STATUSES = ["live", "offer_accepted"] as const;
export const PER_PAGE = 24;

export const MILES = [
  { value: "10k", label: "Under 10,000 miles", to: 9_999 },
  { value: "25k", label: "Under 25,000 miles", to: 24_999 },
  { value: "50k", label: "Under 50,000 miles", to: 49_999 },
  { value: "100k", label: "Under 100,000 miles", to: 99_999 },
] as const;

/** Years the year filter accepts. */
const YEAR_MIN = 1900;
const YEAR_MAX = 2100;

export const PRICES = [
  { value: "u25", label: "Under $25,000", from: 0, to: 24_999 },
  { value: "25-50", label: "$25,000 to $50,000", from: 25_000, to: 50_000 },
  { value: "50-100", label: "$50,000 to $100,000", from: 50_000, to: 100_000 },
  { value: "100up", label: "$100,000 and up", from: 100_000, to: Number.MAX_SAFE_INTEGER },
] as const;

export const SORTS = [
  { value: "new", label: "Newest listings" },
  { value: "price-asc", label: "Price, low to high" },
  { value: "price-desc", label: "Price, high to low" },
  { value: "miles", label: "Lowest miles" },
  { value: "year-desc", label: "Year, newest first" },
  { value: "year-asc", label: "Year, oldest first" },
] as const;
export type SortKey = (typeof SORTS)[number]["value"];

const MANUALS = ["manual_5", "manual_6"];

interface Row {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  price: number | null;
  mileage: number | null;
  transmission: string | null;
  drivetrain: string | null;
  bodyStyle: string | null;
  sellerType: "private" | "dealer";
  recordsOnFile: boolean;
  locationCity: string | null;
  locationState: string | null;
  headline: string | null;
  publishedAt: Date | null;
  makeKey: string;
  modelKey: string;
  hay: string;
}

export interface LotQuery {
  q: string;
  ymin: number | null;
  ymax: number | null;
  make: string;
  model: string;
  miles: string;
  manual: boolean;
  records: boolean;
  price: string[];
  drive: string[];
  body: string[];
  seller: string[];
  sort: SortKey;
  page: number;
}

const pick = (values: string[], allowed: readonly { value: string }[]) =>
  [...new Set(values)].filter((v) => allowed.some((a) => a.value === v));

/** Read the Lot's state from the address bar, dropping anything unknown. */
export function parseLotQuery(params: URLSearchParams): LotQuery {
  const list = (k: string) => params.getAll(k).flatMap((v) => v.split(","));
  const sort = params.get("sort");
  const page = Number(params.get("page"));
  const year = (k: string) => {
    const n = Number(params.get(k));
    return Number.isInteger(n) && n >= YEAR_MIN && n <= YEAR_MAX ? n : null;
  };
  let [ymin, ymax] = [year("ymin"), year("ymax")];
  if (ymin !== null && ymax !== null && ymin > ymax) [ymin, ymax] = [ymax, ymin];
  const text = (k: string, max: number) => (params.get(k) ?? "").trim().slice(0, max);
  const make = text("make", 40);
  const miles = params.get("miles") ?? "";
  return {
    q: text("q", 80),
    ymin,
    ymax,
    make,
    // A model only means something with its make.
    model: make ? text("model", 60) : "",
    miles: MILES.some((m) => m.value === miles) ? miles : "",
    manual: params.get("manual") === "1",
    records: params.get("records") === "1",
    price: pick(list("price"), PRICES).slice(0, 1),
    drive: pick(list("drive"), DRIVETRAINS),
    body: pick(list("body"), BODY_STYLES),
    seller: pick(list("seller"), [{ value: "private" }, { value: "dealer" }]),
    sort: SORTS.some((s) => s.value === sort) ? (sort as SortKey) : "new",
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** The address bar for a Lot state (page 1 and defaults are left out). */
export function lotHref(q: LotQuery, change: Partial<LotQuery> = {}): string {
  const s = { ...q, page: 1, ...change };
  const p = new URLSearchParams();
  if (s.q) p.set("q", s.q);
  if (s.ymin !== null) p.set("ymin", String(s.ymin));
  if (s.ymax !== null) p.set("ymax", String(s.ymax));
  if (s.make) p.set("make", s.make);
  if (s.make && s.model) p.set("model", s.model);
  if (s.miles) p.set("miles", s.miles);
  if (s.manual) p.set("manual", "1");
  for (const k of ["price", "drive", "body", "seller"] as const) for (const v of s[k]) p.append(k, v);
  if (s.records) p.set("records", "1");
  if (s.sort !== "new") p.set("sort", s.sort);
  if (s.page > 1) p.set("page", String(s.page));
  const str = p.toString();
  return str ? `/?${str}` : "/";
}

export function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type Group = "year" | "make" | "model" | "miles" | "manual" | "price" | "drive" | "body" | "seller" | "records";

/** The filters that are set, apart from the search box. */
export function activeFilterCount(q: LotQuery): number {
  return (
    (q.ymin !== null || q.ymax !== null ? 1 : 0) +
    (q.make ? 1 : 0) +
    (q.model ? 1 : 0) +
    (q.miles ? 1 : 0) +
    (q.manual ? 1 : 0) +
    (q.records ? 1 : 0) +
    q.price.length +
    q.drive.length +
    q.body.length +
    q.seller.length
  );
}

function inRange(n: number | null, ranges: readonly { value: string; from: number; to: number }[], picked: string[]) {
  return n !== null && picked.some((v) => {
    const r = ranges.find((x) => x.value === v);
    return !!r && n >= r.from && n <= r.to;
  });
}

/** Does a car pass every active filter (except the `skip` groups, for their counts)? */
function passes(c: Row, q: LotQuery, terms: string[], ...skip: Group[]): boolean {
  const on = (g: Group) => !skip.includes(g);
  if (terms.some((t) => !c.hay.includes(` ${t}`))) return false;
  if (on("year") && q.ymin !== null && (c.year === null || c.year < q.ymin)) return false;
  if (on("year") && q.ymax !== null && (c.year === null || c.year > q.ymax)) return false;
  if (on("make") && q.make && c.makeKey !== norm(q.make)) return false;
  if (on("model") && q.model && c.modelKey !== norm(q.model)) return false;
  if (on("miles") && q.miles && !(c.mileage !== null && c.mileage <= (MILES.find((m) => m.value === q.miles)?.to ?? 0))) return false;
  if (on("manual") && q.manual && !MANUALS.includes(c.transmission ?? "")) return false;
  if (on("records") && q.records && !c.recordsOnFile) return false;
  if (on("price") && q.price.length && !inRange(c.price, PRICES, q.price)) return false;
  if (on("drive") && q.drive.length && !q.drive.includes(c.drivetrain ?? "")) return false;
  if (on("body") && q.body.length && !q.body.includes(c.bodyStyle ?? "")) return false;
  if (on("seller") && q.seller.length && !q.seller.includes(c.sellerType)) return false;
  return true;
}

const optionLabels = (list: readonly { value: string; label: string }[], v: string | null) =>
  list.find((o) => o.value === v)?.label ?? "";

const nullsLast = (a: number | null, b: number | null, dir: 1 | -1) =>
  a === null ? (b === null ? 0 : 1) : b === null ? -1 : (a - b) * dir;

const SORTERS: Record<SortKey, (a: Row, b: Row) => number> = {
  new: (a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
  "price-asc": (a, b) => nullsLast(a.price, b.price, 1),
  "price-desc": (a, b) => nullsLast(a.price, b.price, -1),
  miles: (a, b) => nullsLast(a.mileage, b.mileage, 1),
  "year-desc": (a, b) => nullsLast(a.year, b.year, -1),
  "year-asc": (a, b) => nullsLast(a.year, b.year, 1),
};

export interface LotCard {
  id: string;
  slug: string;
  status: string;
  title: string;
  headline: string | null;
  price: number | null;
  mileage: number | null;
  transmission: string;
  location: string;
  ownerCount: number | null;
  recordsOnFile: boolean;
  acceptsOffers: boolean;
  verifiedSeller: boolean;
  sellerType: "private" | "dealer";
  publishedAt: Date | null;
  photo: { url: string; width: number | null; height: number | null } | null;
  photoCount: number;
}

export interface LotResult {
  total: number;
  lotSize: number;
  page: number;
  pages: number;
  cards: LotCard[];
  /** For each filter group, how many cars each choice would show. */
  counts: Record<"manual" | "price" | "miles" | "drive" | "body" | "seller" | "records", Record<string, number>>;
  /** Choices for the year, make and model menus, from the cars on the Lot. */
  years: number[];
  makes: { name: string; n: number }[];
  models: { name: string; n: number }[];
}

export async function queryLot(q: LotQuery): Promise<LotResult> {
  const db = getDb();
  const lotWhere = and(inArray(listings.status, [...LOT_STATUSES]), isNull(listings.deletedAt));
  const raw = await db
    .select({
      id: listings.id,
      year: listings.year,
      make: listings.make,
      model: listings.model,
      price: listings.price,
      mileage: listings.mileage,
      transmission: listings.transmission,
      drivetrain: listings.drivetrain,
      bodyStyle: listings.bodyStyle,
      sellerType: listings.sellerType,
      recordsOnFile: listings.recordsOnFile,
      locationCity: listings.locationCity,
      locationState: listings.locationState,
      headline: listings.headline,
      publishedAt: listings.publishedAt,
    })
    .from(listings)
    .where(lotWhere)
    .all();

  const rows: Row[] = raw.map((r) => ({
    ...r,
    makeKey: norm(r.make ?? ""),
    modelKey: norm(r.model ?? ""),
    hay: ` ${norm(
      [
        r.year,
        r.make,
        r.model,
        r.locationCity,
        r.locationState,
        optionLabels(BODY_STYLES, r.bodyStyle),
        optionLabels(DRIVETRAINS, r.drivetrain),
        MANUALS.includes(r.transmission ?? "") ? "manual stick" : r.transmission,
        r.sellerType === "dealer" ? "dealer" : "private",
      ]
        .filter(Boolean)
        .join(" "),
    )} `,
  }));

  const terms = norm(q.q).split(" ").filter(Boolean).slice(0, 8);
  const matched = rows.filter((c) => passes(c, q, terms)).sort((a, b) => SORTERS[q.sort](a, b) || a.id.localeCompare(b.id));

  const countFor = (group: Group, test: (c: Row) => boolean) => rows.filter((c) => passes(c, q, terms, group) && test(c)).length;

  // Menus list what the other filters leave, with the chosen values kept so
  // a choice never disappears from its own menu. Makes ignore the model too.
  const years = [...new Set(rows.filter((c) => passes(c, q, terms, "year")).flatMap((c) => (c.year === null ? [] : [c.year])))];
  for (const y of [q.ymin, q.ymax]) if (y !== null && !years.includes(y)) years.push(y);
  years.sort((a, b) => b - a);
  const tally = (list: Row[], key: (c: Row) => string, name: (c: Row) => string | null) => {
    const m = new Map<string, { name: string; n: number }>();
    for (const c of list) {
      const k = key(c);
      const label = name(c);
      if (!k || !label) continue;
      const e = m.get(k) ?? { name: label, n: 0 };
      e.n++;
      m.set(k, e);
    }
    return m;
  };
  const makeMap = tally(rows.filter((c) => passes(c, q, terms, "make", "model")), (c) => c.makeKey, (c) => c.make);
  if (q.make && !makeMap.has(norm(q.make))) makeMap.set(norm(q.make), { name: q.make, n: 0 });
  const modelMap = q.make
    ? tally(rows.filter((c) => passes(c, q, terms, "model")), (c) => c.modelKey, (c) => c.model)
    : new Map<string, { name: string; n: number }>();
  if (q.model && !modelMap.has(norm(q.model))) modelMap.set(norm(q.model), { name: q.model, n: 0 });
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "en", { sensitivity: "base", numeric: true });

  const counts: LotResult["counts"] = {
    manual: { "1": countFor("manual", (c) => MANUALS.includes(c.transmission ?? "")) },
    records: { "1": countFor("records", (c) => c.recordsOnFile) },
    price: Object.fromEntries(PRICES.map((p) => [p.value, countFor("price", (c) => inRange(c.price, PRICES, [p.value]))])),
    miles: Object.fromEntries(MILES.map((m) => [m.value, countFor("miles", (c) => c.mileage !== null && c.mileage <= m.to)])),
    drive: Object.fromEntries(DRIVETRAINS.map((d) => [d.value, countFor("drive", (c) => c.drivetrain === d.value)])),
    body: Object.fromEntries(BODY_STYLES.map((b) => [b.value, countFor("body", (c) => c.bodyStyle === b.value)])),
    seller: {
      private: countFor("seller", (c) => c.sellerType === "private"),
      dealer: countFor("seller", (c) => c.sellerType === "dealer"),
    },
  };

  const pages = Math.max(1, Math.ceil(matched.length / PER_PAGE));
  const page = Math.min(q.page, pages);
  const pageIds = matched.slice((page - 1) * PER_PAGE, page * PER_PAGE).map((c) => c.id);
  const cards = pageIds.length ? await cardsFor(pageIds) : [];
  return {
    total: matched.length,
    lotSize: rows.length,
    page,
    pages,
    cards,
    counts,
    years,
    makes: [...makeMap.values()].sort(byName),
    models: [...modelMap.values()].sort(byName),
  };
}

/** Full card data, in the given order, for one page of cars (at most PER_PAGE ids). */
async function cardsFor(ids: string[]): Promise<LotCard[]> {
  const db = getDb();
  const full = await db.select().from(listings).where(inArray(listings.id, ids)).all();
  const photoCounts = await db
    .select({ listingId: listingPhotos.listingId, n: count() })
    .from(listingPhotos)
    .where(inArray(listingPhotos.listingId, ids))
    .groupBy(listingPhotos.listingId)
    .all();
  const mains = await db
    .select({ listingId: listingPhotos.listingId, r2Key: listingPhotos.r2Key, width: listingPhotos.width, height: listingPhotos.height })
    .from(listingPhotos)
    .where(and(inArray(listingPhotos.listingId, ids), eq(listingPhotos.position, sql`(SELECT MIN(p2.position) FROM listing_photos p2 WHERE p2.listing_id = ${listingPhotos.listingId})`)))
    .orderBy(asc(listingPhotos.listingId))
    .all();
  const byId = new Map(full.map((l) => [l.id, l]));
  const countBy = new Map(photoCounts.map((p) => [p.listingId, p.n]));
  const mainBy = new Map(mains.map((m) => [m.listingId, m]));
  return ids.flatMap((id) => {
    const l = byId.get(id);
    if (!l || !l.slug) return [];
    const main = mainBy.get(id);
    return [
      {
        id,
        slug: l.slug,
        status: l.status,
        title: [l.year, l.make, l.model].filter(Boolean).join(" "),
        headline: l.headline,
        price: l.price,
        mileage: l.mileage,
        transmission: optionLabels(TRANSMISSIONS, l.transmission),
        location: [l.locationCity, l.locationState].filter(Boolean).join(", "),
        ownerCount: l.ownerCount,
        recordsOnFile: l.recordsOnFile,
        acceptsOffers: l.acceptsOffers,
        verifiedSeller: l.verifiedSeller,
        sellerType: l.sellerType,
        publishedAt: l.publishedAt,
        photo: main ? { url: photoUrl(main.r2Key), width: main.width, height: main.height } : null,
        photoCount: countBy.get(id) ?? 0,
      },
    ];
  });
}

/** "Listed today", "Listed 3 days ago", or the date for older cars. Computed per request. */
export function listedAgo(d: Date | null): string {
  if (!d) return "";
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days < 1) return "Listed today";
  if (days === 1) return "Listed yesterday";
  if (days < 30) return `Listed ${days} days ago`;
  return `Listed ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" })}`;
}
