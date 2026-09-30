import { env } from "cloudflare:workers";
import { count, eq, inArray } from "drizzle-orm";
import { chunks, getDb } from "../db/client";
import { listingPhotos, listings, profiles, user as users } from "../db/schema";
import { audit } from "./audit";
import { baseSlug } from "./cms";
import { safeError } from "./log";

// Demo cars: 25 made-up listings an admin can add from /admin to see how the
// Lot and car pages look with cars on them, and remove again in one click.
// They belong to one demo seller account (which cannot sign in), their photos
// are simple drawings shipped in public/demo-cars and copied into R2, and
// every description says the car is a demo. Removing deletes the demo seller,
// which deletes the listings with their photos, offers and threads.

export const DEMO_SELLER_ID = "demo-seller";
const DEMO_EMAIL = "demo-seller@demo.invalid";
const PHOTOS_PER_CAR = 6;
const POOL = 16;

type Trans = "manual_5" | "manual_6" | "automatic" | "dct";
type Body = "coupe" | "convertible" | "targa" | "hatchback" | "sedan" | "wagon" | "truck" | "suv";
type Drive = "rwd" | "awd" | "fwd" | "4wd";

interface DemoCar {
  year: number;
  make: string;
  model: string;
  body: Body;
  drive: Drive;
  trans: Trans;
  engine: string;
  ext: string;
  int: string;
  price: number;
  miles: number;
  city: string;
  st: string;
  owners: number;
  records: boolean;
  headline: string;
  story: string;
  mods?: string;
  dealer?: boolean;
  offers?: boolean;
  accepted?: boolean;
}

const CARS: DemoCar[] = [
  { year: 1995, make: "Porsche", model: "911 Carrera", body: "coupe", drive: "rwd", trans: "manual_6", engine: "3.6L flat six", ext: "Guards Red", int: "Black leather", price: 89500, miles: 71200, city: "Scottsdale", st: "AZ", owners: 3, records: true, headline: "993 coupe with a fresh top end and every record", story: "The top end was rebuilt at 68,000 miles with new valve guides, and the car has a thick binder of receipts back to 1997." },
  { year: 1991, make: "Mazda", model: "MX-5 Miata", body: "convertible", drive: "rwd", trans: "manual_5", engine: "1.6L I4", ext: "Mariner Blue", int: "Black cloth", price: 11900, miles: 118000, city: "Sacramento", st: "CA", owners: 4, records: false, headline: "Mariner Blue NA with the factory hardtop", story: "It comes with the factory hardtop and a new soft top fitted last spring." },
  { year: 2006, make: "BMW", model: "M3", body: "coupe", drive: "rwd", trans: "manual_6", engine: "3.2L S54 I6", ext: "Interlagos Blue", int: "Black leather", price: 36500, miles: 82000, city: "Charlotte", st: "NC", owners: 2, records: true, headline: "Six-speed E46 with the rod bearings and subframe done", story: "The rod bearings were replaced at 76,000 miles and the rear subframe mounts were reinforced by a BMW specialist." },
  { year: 1987, make: "Toyota", model: "MR2", body: "targa", drive: "rwd", trans: "manual_5", engine: "1.6L 4A-GE I4", ext: "Super White", int: "Blue cloth", price: 14800, miles: 96000, city: "Tucson", st: "AZ", owners: 3, records: false, headline: "AW11 with T-tops and no rust", story: "It spent its whole life in Arizona and the floors and rockers are clean." },
  { year: 2002, make: "Subaru", model: "Impreza WRX", body: "wagon", drive: "awd", trans: "manual_5", engine: "2.0L turbo flat four", ext: "WR Blue", int: "Black cloth", price: 15500, miles: 104000, city: "Salt Lake City", st: "UT", owners: 2, records: true, headline: "Bugeye wagon, unmodified and never tracked", story: "It has never been modified or tracked, which is rare for these." },
  { year: 1999, make: "Honda", model: "Civic Si", body: "coupe", drive: "fwd", trans: "manual_5", engine: "1.6L B16A2 I4", ext: "Electron Blue", int: "Black cloth", price: 22000, miles: 88000, city: "Houston", st: "TX", owners: 2, records: true, headline: "Stock EM1 Si in Electron Blue", story: "Everything is original down to the radio and the floor mats." },
  { year: 2015, make: "Ford", model: "Mustang GT", body: "coupe", drive: "rwd", trans: "manual_6", engine: "5.0L Coyote V8", ext: "Race Red", int: "Ebony leather", price: 27900, miles: 41000, city: "Nashville", st: "TN", owners: 1, records: false, headline: "One owner Performance Pack six-speed", story: "It has the Performance Pack with the Brembo brakes and the Torsen rear end.", accepted: true },
  { year: 1984, make: "Toyota", model: "Land Cruiser FJ60", body: "suv", drive: "4wd", trans: "manual_5", engine: "4.2L I6", ext: "Tan", int: "Tan cloth", price: 32000, miles: 185000, city: "Bend", st: "OR", owners: 3, records: true, headline: "FJ60 with a fresh restoration and a five-speed swap", story: "The body was restored in 2021 and it has a five-speed conversion done with Toyota parts.", mods: "Five-speed H55F conversion\nOld Man Emu suspension" },
  { year: 2011, make: "Porsche", model: "Cayman S", body: "coupe", drive: "rwd", trans: "manual_6", engine: "3.4L flat six", ext: "Basalt Black", int: "Black leather", price: 42900, miles: 58000, city: "San Jose", st: "CA", owners: 2, records: true, headline: "987.2 Cayman S with the limited slip", story: "It has the optional limited slip differential and Sport Chrono." },
  { year: 1973, make: "Porsche", model: "911T", body: "coupe", drive: "rwd", trans: "manual_5", engine: "2.4L flat six", ext: "Light Ivory", int: "Black leatherette", price: 118000, miles: 94000, city: "Carmel", st: "CA", owners: 5, records: true, headline: "Numbers matching 911T with a known history", story: "The engine and gearbox are numbers matching and the Kardex is included." },
  { year: 2019, make: "Toyota", model: "Tacoma TRD Pro", body: "truck", drive: "4wd", trans: "manual_6", engine: "3.5L V6", ext: "Voodoo Blue", int: "Black cloth", price: 44500, miles: 38000, city: "Boulder", st: "CO", owners: 1, records: true, headline: "Voodoo Blue TRD Pro with the six-speed", story: "It is one of the few TRD Pros built with the six-speed manual." },
  { year: 2004, make: "Audi", model: "S4 Avant", body: "wagon", drive: "awd", trans: "manual_6", engine: "4.2L V8", ext: "Mugello Blue", int: "Silver leather", price: 13900, miles: 132000, city: "Minneapolis", st: "MN", owners: 3, records: true, headline: "B6 S4 Avant with the timing chain guides done", story: "The timing chain guides were replaced at 118,000 miles, the job everyone asks about.", offers: false },
  { year: 1990, make: "Nissan", model: "300ZX Twin Turbo", body: "targa", drive: "rwd", trans: "manual_5", engine: "3.0L VG30DETT V6", ext: "Super Red", int: "Black cloth", price: 34500, miles: 77000, city: "Orlando", st: "FL", owners: 3, records: false, headline: "Z32 Twin Turbo with T-tops", story: "The timing belt and water pump were done 8,000 miles ago." },
  { year: 2008, make: "Mitsubishi", model: "Lancer Evolution X", body: "sedan", drive: "awd", trans: "manual_5", engine: "2.0L turbo I4", ext: "Wicked White", int: "Black Recaro", price: 29500, miles: 64000, city: "Phoenix", st: "AZ", owners: 2, records: false, headline: "GSR five-speed, stock and never tracked", story: "It is a GSR with the five-speed and the factory Recaros." },
  { year: 1969, make: "Chevrolet", model: "Camaro", body: "coupe", drive: "rwd", trans: "automatic", engine: "350 V8", ext: "Hugger Orange", int: "Black vinyl", price: 68000, miles: 12000, city: "Dallas", st: "TX", owners: 5, records: true, headline: "Restored first-gen Camaro in Hugger Orange", story: "It was restored in 2018 and has covered about 12,000 miles since.", dealer: true },
  { year: 2013, make: "Scion", model: "FR-S", body: "coupe", drive: "rwd", trans: "manual_6", engine: "2.0L flat four", ext: "Firestorm", int: "Black cloth", price: 16900, miles: 72000, city: "Portland", st: "OR", owners: 2, records: false, headline: "Clean FR-S with the six-speed", story: "It has the factory limited slip and has never been lowered." },
  { year: 1997, make: "BMW", model: "M3", body: "sedan", drive: "rwd", trans: "manual_5", engine: "3.2L S52 I6", ext: "Cosmos Black", int: "Gray cloth", price: 21500, miles: 121000, city: "Denver", st: "CO", owners: 3, records: true, headline: "E36 M3 sedan with the cooling system done", story: "The whole cooling system was replaced at 115,000 miles.", accepted: true },
  { year: 2016, make: "Volkswagen", model: "Golf R", body: "hatchback", drive: "awd", trans: "manual_6", engine: "2.0L turbo I4", ext: "Lapiz Blue", int: "Black leather", price: 26900, miles: 54000, city: "Seattle", st: "WA", owners: 1, records: false, headline: "One owner Golf R with the manual", story: "It has the six-speed and the Driver Assistance package." },
  { year: 1991, make: "Acura", model: "NSX", body: "coupe", drive: "rwd", trans: "manual_5", engine: "3.0L C30A V6", ext: "Formula Red", int: "Black leather", price: 104000, miles: 52000, city: "Irvine", st: "CA", owners: 2, records: true, headline: "Formula Red NSX with the timing belt done", story: "The timing belt service was done last year by an NSX specialist.", dealer: true },
  { year: 2005, make: "Mercedes-Benz", model: "E55 AMG Wagon", body: "wagon", drive: "rwd", trans: "automatic", engine: "5.4L supercharged V8", ext: "Obsidian Black", int: "Black leather", price: 24500, miles: 98000, city: "Chicago", st: "IL", owners: 3, records: true, headline: "E55 wagon with the third row seat", story: "It has the rear facing third row and the SBC pump was replaced." },
  { year: 1985, make: "Jeep", model: "CJ-7", body: "suv", drive: "4wd", trans: "manual_5", engine: "4.2L I6", ext: "Olive Green", int: "Black vinyl", price: 23500, miles: 99000, city: "Asheville", st: "NC", owners: 4, records: false, headline: "Last-year CJ-7 with a new soft top", story: "It is one of the last CJ-7s built and has a new soft top and doors." },
  { year: 2020, make: "Porsche", model: "718 Cayman GT4", body: "coupe", drive: "rwd", trans: "manual_6", engine: "4.0L flat six", ext: "Racing Yellow", int: "Black leather", price: 124500, miles: 9800, city: "Miami", st: "FL", owners: 1, records: true, headline: "One owner GT4 with full buckets", story: "It has the full bucket seats, the Clubsport package and paint protection film.", dealer: true },
  { year: 1996, make: "Toyota", model: "Supra Turbo", body: "targa", drive: "rwd", trans: "manual_6", engine: "3.0L 2JZ-GTE I6", ext: "Black", int: "Black leather", price: 98000, miles: 69000, city: "Las Vegas", st: "NV", owners: 3, records: true, headline: "Six-speed Supra Turbo with the sport roof", story: "It is a six-speed turbo car with the targa roof and a clean history." },
  { year: 2007, make: "Honda", model: "S2000", body: "convertible", drive: "rwd", trans: "manual_6", engine: "2.2L F22C1 I4", ext: "Laguna Blue", int: "Black leather", price: 27500, miles: 61000, city: "San Diego", st: "CA", owners: 2, records: true, headline: "Laguna Blue AP2 with a new top", story: "The soft top was replaced with a factory glass window top in 2023." },
  { year: 1979, make: "Ford", model: "F-150 Ranger", body: "truck", drive: "4wd", trans: "automatic", engine: "5.8L V8", ext: "Wimbledon White", int: "Red vinyl", price: 21000, miles: 86000, city: "Austin", st: "TX", owners: 3, records: false, headline: "Two-tone F-150 Ranger 4x4", story: "It has the two-tone paint and the original bench seat." },
];

// Which drawings suit each body style (public/demo-cars/car-01.jpg to car-16.jpg).
const BY_BODY: Record<Body, number[]> = {
  coupe: [1, 3, 8, 11, 14],
  targa: [3, 11, 14, 1],
  hatchback: [8, 14],
  convertible: [5, 13],
  sedan: [2, 9, 16],
  wagon: [6, 12],
  truck: [7, 15],
  suv: [4, 10],
};

function describe(c: DemoCar, i: number): string {
  const years = 2 + (i % 9);
  return [
    `This ${c.year} ${c.make} ${c.model} is finished in ${c.ext} over ${c.int.toLowerCase()}. ${c.story} I have owned it for ${years} years and drive it most weekends. It starts on the first turn, idles smoothly and pulls cleanly through every gear.`,
    `It has always been stored indoors. There are small stone chips on the front bumper and hood that match the miles, and the driver's seat shows light wear on the outer bolster. Everything works, including the air conditioning, the windows and every gauge.`,
    `This is a demo listing for trying out the site. It is not a real car for sale.`,
  ].join("\n\n");
}

export async function demoCount(): Promise<number> {
  const row = await getDb().select({ n: count() }).from(listings).where(eq(listings.userId, DEMO_SELLER_ID)).get();
  return row?.n ?? 0;
}

/** Add the 25 demo cars. Returns how many were added (0 when they are already there). */
export async function addDemoCars(actorId: string, origin: string): Promise<number> {
  const db = getDb();
  if ((await demoCount()) > 0) return 0;

  // The pictures ship with the site as static files.
  const pool = new Map<number, ArrayBuffer>();
  for (let n = 1; n <= POOL; n++) {
    const res = await env.ASSETS.fetch(new Request(new URL(`/demo-cars/car-${String(n).padStart(2, "0")}.jpg`, origin)));
    if (!res.ok) throw new Error(`Demo photo ${n} is missing (${res.status}).`);
    pool.set(n, await res.arrayBuffer());
  }

  const now = Date.now();
  await db
    .insert(users)
    .values({ id: DEMO_SELLER_ID, name: "Demo Seller", email: DEMO_EMAIL, emailVerified: true, createdAt: new Date(now), updatedAt: new Date(now) })
    .onConflictDoNothing();
  await db.insert(profiles).values({ userId: DEMO_SELLER_ID, displayName: "Demo seller", role: "user", emailNotifications: false }).onConflictDoNothing();

  const taken = new Set((await db.select({ slug: listings.slug }).from(listings).all()).map((r) => r.slug));
  const listingRows: (typeof listings.$inferInsert)[] = [];
  const photoRows: (typeof listingPhotos.$inferInsert)[] = [];
  const puts: { key: string; n: number }[] = [];

  CARS.forEach((c, i) => {
    const id = crypto.randomUUID();
    let slug = baseSlug(c);
    while (taken.has(slug)) slug = `${baseSlug(c)}-${crypto.randomUUID().slice(0, 4)}`;
    taken.add(slug);
    // Spread over the last three weeks; the first few count as Just listed.
    const published = new Date(now - (i < 4 ? i * 14 + 2 : 30 + i * 18) * 3_600_000);
    listingRows.push({
      id,
      userId: DEMO_SELLER_ID,
      status: c.accepted ? "offer_accepted" : "live",
      year: c.year,
      make: c.make,
      model: c.model,
      bodyStyle: c.body,
      engine: c.engine,
      transmission: c.trans,
      drivetrain: c.drive,
      exteriorColor: c.ext,
      interiorColor: c.int,
      mileage: c.miles,
      headline: c.headline,
      description: describe(c, i),
      highlights: [c.headline, `${c.owners} ${c.owners === 1 ? "owner" : "owners"} from new`, c.records ? "Service records on file" : "Clean title in hand"].join("\n"),
      knownIssues: ["Small stone chips on the front bumper and hood", i % 2 ? "The driver's seat bolster shows light wear" : "A small scuff on the rear bumper corner"].join("\n"),
      modifications: c.mods ?? "None. It is stock.",
      serviceHistory: `Oil changed every 5,000 miles. ${c.records ? "Receipts for every service are in the binder." : "Recent receipts are included."}`,
      ownerCount: c.owners,
      titleStatus: "clean",
      titleState: c.st,
      recordsOnFile: c.records,
      price: c.price,
      acceptsOffers: c.offers !== false,
      locationCity: c.city,
      locationState: c.st,
      sellerType: c.dealer ? "dealer" : "private",
      slug,
      submittedAt: published,
      reviewedAt: published,
      reviewerId: actorId,
      publishedAt: published,
      createdAt: published,
      updatedAt: published,
    });
    const fits = BY_BODY[c.body];
    const order = [fits[i % fits.length], ...Array.from({ length: POOL }, (_, k) => ((i * 5 + k) % POOL) + 1).filter((n) => n !== fits[i % fits.length])];
    order.slice(0, PHOTOS_PER_CAR).forEach((n, position) => {
      const photoId = crypto.randomUUID();
      const key = `listings/${id}/${photoId}.jpg`;
      photoRows.push({ id: photoId, listingId: id, r2Key: key, position, width: 1200, height: 800 });
      puts.push({ key, n });
    });
  });

  // Photos first, so no car shows up on the Lot without its pictures.
  for (const group of chunks(puts, 10)) {
    await Promise.all(group.map((p) => env.PHOTOS.put(p.key, pool.get(p.n)!, { httpMetadata: { contentType: "image/jpeg" } })));
  }
  try {
    const statements = [
      ...listingRows.map((row) => db.insert(listings).values(row)),
      // D1 takes at most 100 bound values per statement: 14 photos of 7 columns.
      ...chunks(photoRows, 14).map((rows) => db.insert(listingPhotos).values(rows)),
    ];
    await db.batch(statements as [(typeof statements)[number], ...(typeof statements)[number][]]);
  } catch (err) {
    await env.PHOTOS.delete(puts.map((p) => p.key)).catch(() => {});
    throw err;
  }
  await audit(actorId, "demo_cars_added", "listing", DEMO_SELLER_ID, { count: listingRows.length });
  return listingRows.length;
}

/** Remove every demo car (and anything people did with them). Returns how many were removed. */
export async function removeDemoCars(actorId: string): Promise<number> {
  const db = getDb();
  const ids = (await db.select({ id: listings.id }).from(listings).where(eq(listings.userId, DEMO_SELLER_ID)).all()).map((r) => r.id);
  const keys: string[] = [];
  for (const group of chunks(ids)) {
    keys.push(...(await db.select({ key: listingPhotos.r2Key }).from(listingPhotos).where(inArray(listingPhotos.listingId, group)).all()).map((r) => r.key));
  }
  // Deleting the demo seller deletes the listings, photos, offers and threads with it.
  await db.delete(users).where(eq(users.id, DEMO_SELLER_ID));
  for (const group of chunks(keys, 1000)) {
    try {
      await env.PHOTOS.delete(group);
    } catch (err) {
      console.error("[demo] photo delete failed", safeError(err));
    }
  }
  await audit(actorId, "demo_cars_removed", "listing", DEMO_SELLER_ID, { count: ids.length });
  return ids.length;
}
