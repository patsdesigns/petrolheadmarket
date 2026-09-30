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

export const ERAS = [
  { value: "pre70", label: "Before 1970", from: 0, to: 1969 },
  { value: "70s", label: "1970s", from: 1970, to: 1979 },
  { value: "80s", label: "1980s", from: 1980, to: 1989 },
  { value: "90s", label: "1990s", from: 1990, to: 1999 },
  { value: "00s", label: "2000s", from: 2000, to: 2009 },
  { value: "10s", label: "2010 and newer", from: 2010, to: 9999 },
] as const;

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
  hay: string;
}

export interface LotQuery {
  q: string;
  manual: boolean;
  records: boolean;
  price: string[];
  era: string[];
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
  return {
    q: (params.get("q") ?? "").trim().slice(0, 80),
    manual: params.get("manual") === "1",
    records: params.get("records") === "1",
    price: pick(list("price"), PRICES).slice(0, 1),
    era: pick(list("era"), ERAS),
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
  if (s.manual) p.set("manual", "1");
  for (const k of ["price", "era", "drive", "body", "seller"] as const) for (const v of s[k]) p.append(k, v);
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

type Group = "manual" | "price" | "era" | "drive" | "body" | "seller" | "records";

function inRange(n: number | null, ranges: readonly { value: string; from: number; to: number }[], picked: string[]) {
  return n !== null && picked.some((v) => {
    const r = ranges.find((x) => x.value === v);
    return !!r && n >= r.from && n <= r.to;
  });
}

/** Does a car pass every active filter (except `skip`, for that group's counts)? */
function passes(c: Row, q: LotQuery, terms: string[], skip?: Group): boolean {
  if (terms.some((t) => !c.hay.includes(` ${t}`))) return false;
  if (skip !== "manual" && q.manual && !MANUALS.includes(c.transmission ?? "")) return false;
  if (skip !== "records" && q.records && !c.recordsOnFile) return false;
  if (skip !== "price" && q.price.length && !inRange(c.price, PRICES, q.price)) return false;
  if (skip !== "era" && q.era.length && !inRange(c.year, ERAS, q.era)) return false;
  if (skip !== "drive" && q.drive.length && !q.drive.includes(c.drivetrain ?? "")) return false;
  if (skip !== "body" && q.body.length && !q.body.includes(c.bodyStyle ?? "")) return false;
  if (skip !== "seller" && q.seller.length && !q.seller.includes(c.sellerType)) return false;
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
  counts: Record<Group, Record<string, number>>;
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
  const counts: LotResult["counts"] = {
    manual: { "1": countFor("manual", (c) => MANUALS.includes(c.transmission ?? "")) },
    records: { "1": countFor("records", (c) => c.recordsOnFile) },
    price: Object.fromEntries(PRICES.map((p) => [p.value, countFor("price", (c) => inRange(c.price, PRICES, [p.value]))])),
    era: Object.fromEntries(ERAS.map((e) => [e.value, countFor("era", (c) => inRange(c.year, ERAS, [e.value]))])),
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
  return { total: matched.length, lotSize: rows.length, page, pages, cards, counts };
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
