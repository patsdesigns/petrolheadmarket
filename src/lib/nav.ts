// The category menu under the header search: shortcuts into the Lot.
import { lotHref, parseLotQuery } from "./lot";

export interface Shortcut {
  label: string;
  /** Lot address, e.g. "/?manual=1". */
  href: string;
}

export const SHORTCUTS: Shortcut[] = [
  { label: "All Cars", href: "/" },
  { label: "Manuals", href: "/?manual=1" },
  { label: "Classics", href: "/?ymax=1989" },
  { label: "Modern Classics", href: "/?ymin=1990&ymax=2009" },
  { label: "Under $30K", href: "/?price_max=30000" },
  { label: "Convertibles", href: "/?body=convertible&body=targa" },
  { label: "Wagons", href: "/?body=wagon" },
  { label: "Trucks and SUVs", href: "/?body=truck&body=suv" },
];

/** The shortcut that matches the Lot's filters exactly (search, sort and page aside). */
export function activeShortcut(search: URLSearchParams): string | null {
  const key = (params: URLSearchParams) => lotHref({ ...parseLotQuery(params), q: "", sort: "new", page: 1 });
  const here = key(search);
  const hit = SHORTCUTS.find((s) => key(new URL(s.href, "http://x").searchParams) === here);
  return hit ? hit.href : null;
}
