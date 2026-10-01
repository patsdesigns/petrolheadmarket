import type { APIRoute } from "astro";
import { searchLot } from "../../lib/lot";
import { carUrl, url } from "../../lib/paths";
import { formatMiles, formatPrice } from "../../lib/listing-rules";

// The header's live search (public): the newest matching cars on the Lot and
// the make and model groups they fall in. Only public Lot data.
export const GET: APIRoute = async ({ url: here }) => {
  const q = (here.searchParams.get("q") ?? "").trim().slice(0, 80);
  const found = await searchLot(q);
  const body = {
    q,
    total: found.total,
    all: `${url("/")}?q=${encodeURIComponent(q)}`,
    cars: found.cars.map((c) => ({
      title: c.title,
      href: carUrl(c.slug),
      price: c.price !== null ? formatPrice(c.price) : null,
      miles: c.mileage !== null ? `${formatMiles(c.mileage)} mi` : null,
      photo: c.photo,
    })),
    groups: found.groups.map((g) => ({
      label: `${g.make} ${g.model}`,
      n: g.n,
      href: `${url("/")}?${new URLSearchParams({ make: g.make, model: g.model })}`,
    })),
  };
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=30" },
  });
};
