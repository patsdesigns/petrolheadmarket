import { env } from "cloudflare:workers";

// WEBFLOW_API_BASE is only for local tests against a fake API. Leave it unset.
const api = () => env.WEBFLOW_API_BASE || "https://api.webflow.com/v2";
const MAX_ATTEMPTS = 4;

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
 * 5xx with backoff. The token never leaves the server.
 */
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!env.WEBFLOW_API_TOKEN) throw new WebflowError("WEBFLOW_API_TOKEN is not set", 0, null);
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

    if (res.status === 429 || res.status >= 500) {
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
  if (!env.WEBFLOW_COLLECTION_ID) throw new WebflowError("WEBFLOW_COLLECTION_ID is not set", 0, null);
  return env.WEBFLOW_COLLECTION_ID;
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

/** True if any item (draft or live) already uses this slug. */
export async function slugTaken(slug: string): Promise<boolean> {
  const res = await call<{ items: CmsItem[] }>(
    "GET",
    `/collections/${collectionId()}/items?slug=${encodeURIComponent(slug)}&limit=1`,
  );
  return (res.items ?? []).some((i) => i.fieldData?.slug === slug);
}
