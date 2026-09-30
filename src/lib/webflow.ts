import { env } from "cloudflare:workers";

// WEBFLOW_API_BASE is only for local tests against a fake API. Leave it unset.
const api = () => env.WEBFLOW_API_BASE || "https://api.webflow.com/v2";
const MAX_ATTEMPTS = 4;

// Non-secret IDs of the Petrol Head Market site and its Listings collection.
// WEBFLOW_SITE_ID and WEBFLOW_COLLECTION_ID override them (tests, a new site).
export const DEFAULT_SITE_ID = "6a8cb05d39be95366772994d";
export const DEFAULT_COLLECTION_ID = "6a8cb2028c898e7ed8517d9c";

export const siteId = (): string => env.WEBFLOW_SITE_ID || DEFAULT_SITE_ID;

/** Publishing works once the API token is set; the IDs have defaults. */
export const webflowConfigured = (): boolean => Boolean(env.WEBFLOW_API_TOKEN);

/** Shown to admins while publishing is off. */
export const NOT_CONFIGURED_MESSAGE =
  "WEBFLOW_API_TOKEN is not set. Add it in the Webflow Cloud environment settings. Approved listings then publish the next time you open an admin page.";

export class WebflowError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Call the Webflow Data API v2. Retries on 429 (honoring Retry-After) and on
 * 5xx with backoff. A POST is not retried on 5xx, because Webflow may have
 * created the item already (publishListing adopts it by slug on the next try).
 * The token never leaves the server.
 */
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!env.WEBFLOW_API_TOKEN) throw new WebflowError(NOT_CONFIGURED_MESSAGE, 0, null);
  let lastError: WebflowError | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(`${api()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.WEBFLOW_API_TOKEN}`,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.ok) return (res.status === 204 ? null : await res.json()) as T;

    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = JSON.parse(text);
    } catch {}
    const detail = Array.isArray(parsed?.details) && parsed.details.length ? ` ${JSON.stringify(parsed.details)}` : "";
    lastError = new WebflowError(`Webflow ${res.status}: ${parsed?.message ?? text}${detail}`, res.status, parsed);

    if (res.status === 429 || (res.status >= 500 && method !== "POST")) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt;
      await sleep(Math.min(wait, 10_000));
      continue;
    }
    throw lastError;
  }
  throw lastError!;
}

function collectionId(): string {
  return env.WEBFLOW_COLLECTION_ID || DEFAULT_COLLECTION_ID;
}

export interface CmsItem {
  id: string;
  fieldData: Record<string, unknown>;
}

/** Create an item and publish it to the live site in one call. */
export function createLiveItem(fieldData: Record<string, unknown>): Promise<CmsItem> {
  return call<CmsItem>("POST", `/collections/${collectionId()}/items/live`, {
    isArchived: false,
    isDraft: false,
    fieldData,
  });
}

/** Update a live item and publish the change. */
export function updateLiveItem(itemId: string, fieldData: Record<string, unknown>): Promise<CmsItem> {
  return call<CmsItem>("PATCH", `/collections/${collectionId()}/items/${itemId}/live`, {
    isArchived: false,
    isDraft: false,
    fieldData,
  });
}

/** The item (draft or live) that uses this slug, if any. */
export async function findItemBySlug(slug: string): Promise<CmsItem | null> {
  const res = await call<{ items: CmsItem[] }>(
    "GET",
    `/collections/${collectionId()}/items?slug=${encodeURIComponent(slug)}&limit=1`,
  );
  return (res.items ?? []).find((i) => i.fieldData?.slug === slug) ?? null;
}

/** True if any item (draft or live) already uses this slug. */
export async function slugTaken(slug: string): Promise<boolean> {
  return (await findItemBySlug(slug)) !== null;
}

/**
 * Take an item off the live site (DELETE .../items/{itemId}/live). The item
 * stays in the CMS as staged. An item that is already gone counts as done.
 */
export async function unpublishLiveItem(itemId: string): Promise<void> {
  try {
    await call<null>("DELETE", `/collections/${collectionId()}/items/${itemId}/live`);
  } catch (err) {
    if (err instanceof WebflowError && err.status === 404) return;
    throw err;
  }
}

/**
 * Delete an item from the CMS entirely (used when a seller deletes a listing
 * that was taken down). An item that is already gone counts as done.
 */
export async function deleteItem(itemId: string): Promise<void> {
  try {
    await call<null>("DELETE", `/collections/${collectionId()}/items/${itemId}`);
  } catch (err) {
    if (err instanceof WebflowError && err.status === 404) return;
    throw err;
  }
}
