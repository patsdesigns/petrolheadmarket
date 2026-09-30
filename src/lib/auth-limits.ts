import { env } from "cloudflare:workers";
import { lt, sql, inArray } from "drizzle-orm";
import { getDb } from "../db/client";
import { authLimits } from "../db/schema";
import { publicOrigin } from "./config";
import { basePath } from "./paths";

/**
 * App rate limits for account actions, stored in D1 (auth_limits).
 *
 * Better Auth's own limiter is off: behind Webflow's proxy the client IP is
 * often unknown (every visitor shared one bucket) or could be spoofed. These
 * limits are keyed by the email address the action is about, plus by
 * cf-connecting-ip only when Cloudflare sets it and it is not one of
 * Cloudflare's own addresses. Keys store a SHA-256 hash, never the address
 * or IP itself.
 *
 * Every attempt takes a slot atomically (one upsert that returns the new
 * count), so parallel requests can't all slip past a check before any of
 * them is counted. See takeAuthLimit().
 */
export type LimitAction = "signin" | "signup" | "email" | "contact";

interface Rule {
  max: number;
  windowSec: number;
}

// The IP limits are well above the email limits: until the live site shows
// that cf-connecting-ip is the visitor's own address (and not the address of
// Webflow's proxy, which would put every visitor in one bucket), they are
// only a backstop against one machine hammering many addresses.
const RULES: Record<LimitAction, { email: Rule; ip: Rule }> = {
  // Failed sign ins (and failed current-password checks).
  signin: { email: { max: 5, windowSec: 600 }, ip: { max: 100, windowSec: 600 } },
  signup: { email: { max: 3, windowSec: 3600 }, ip: { max: 50, windowSec: 3600 } },
  // Anything that emails a link: password reset, confirm email, change email.
  email: { email: { max: 3, windowSec: 3600 }, ip: { max: 50, windowSec: 3600 } },
  // The Contact the team form (src/lib/contact.ts).
  contact: { email: { max: 3, windowSec: 3600 }, ip: { max: 20, windowSec: 3600 } },
};

interface Bucket extends Rule {
  key: string;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Cloudflare's published ranges (cloudflare.com/ips). A Worker in front of
// the app, like Webflow's proxy, reaches us from one of these, so such a
// value names the proxy, not the visitor.
const CLOUDFLARE_V4 = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18",
  "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17",
  "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
];
const CLOUDFLARE_V6 = [
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32",
  "2a06:98c0::/29", "2c0f:f248::/32",
];

function v4ToBig(ip: string): bigint | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null;
    n = (n << 8n) | BigInt(Number(p));
  }
  return n;
}

function v6ToBig(ip: string): bigint | null {
  const halves = ip.toLowerCase().split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(Math.max(0, missing)).fill("0"), ...tail];
  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  return n;
}

function inRanges(ip: string, ranges: string[], bits: number, parse: (s: string) => bigint | null): boolean {
  const value = parse(ip);
  if (value === null) return false;
  return ranges.some((r) => {
    const [base, len] = r.split("/");
    const start = parse(base);
    if (start === null) return false;
    const shift = BigInt(bits - Number(len));
    return value >> shift === start >> shift;
  });
}

/** True for an address that belongs to Cloudflare itself (a proxy or Worker egress). */
export function isCloudflareIp(ip: string): boolean {
  return ip.includes(":")
    ? inRanges(ip, CLOUDFLARE_V6, 128, v6ToBig)
    : inRanges(ip, CLOUDFLARE_V4, 32, v4ToBig);
}

/**
 * The visitor IP, only when Cloudflare's edge set it and it is not
 * Cloudflare's own address. Never a client supplied header.
 */
function clientIp(request: Request): string | null {
  const ip = request.headers.get("cf-connecting-ip")?.trim();
  if (!ip || ip.length > 64 || ip.includes(",")) return null;
  return isCloudflareIp(ip) ? null : ip;
}

// Trusted device cookie. After a successful sign in the browser gets a
// cookie tied to that email (an HMAC with BETTER_AUTH_SECRET). Sign ins from
// that browser count against their own bucket, so strangers who fail on
// purpose to lock an address out can't lock out its owner.
const DEVICE_COOKIE = "phm_device";
const DEVICE_MAX_AGE = 60 * 60 * 24 * 365;

async function hmac(value: string): Promise<string | null> {
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`device:${value}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

/** The trusted device id for this email, when the browser holds a valid cookie for it. */
async function trustedDevice(request: Request, email: string): Promise<string | null> {
  const raw = readCookie(request, DEVICE_COOKIE);
  const m = raw?.match(/^([0-9a-f-]{36})\.([0-9a-f]{64})$/);
  if (!m) return null;
  const expected = await hmac(`${m[1]}:${email}`);
  return expected && expected === m[2] ? m[1] : null;
}

/** Set-Cookie header that marks this browser as trusted for `email`. Null without a secret. */
export async function deviceCookie(email: string): Promise<string | null> {
  const id = crypto.randomUUID();
  const sig = await hmac(`${id}:${email.trim().toLowerCase()}`);
  if (!sig) return null;
  const secure = publicOrigin().startsWith("https://") ? "; Secure" : "";
  return `${DEVICE_COOKIE}=${id}.${sig}; Path=${basePath || "/"}; Max-Age=${DEVICE_MAX_AGE}; HttpOnly; SameSite=Lax${secure}`;
}

async function bucketsFor(request: Request, action: LimitAction, emails: (string | null)[]): Promise<Bucket[]> {
  const rules = RULES[action];
  const buckets: Bucket[] = [];
  const addresses = [...new Set(emails.filter((e): e is string => Boolean(e)).map((e) => e.trim().toLowerCase()))];
  for (const address of addresses) {
    const device = action === "signin" ? await trustedDevice(request, address) : null;
    const key = device ? `${action}:device:${await sha256(`${device}:${address}`)}` : `${action}:email:${await sha256(address)}`;
    buckets.push({ key, ...rules.email });
  }
  const ip = clientIp(request);
  if (ip) buckets.push({ key: `${action}:ip:${await sha256(ip)}`, ...rules.ip });
  return buckets;
}

/**
 * Count one attempt in every bucket in a single upsert each, and read back
 * the new count. Returns the seconds to wait (0 when every bucket is still
 * within its limit).
 */
async function take(buckets: Bucket[]): Promise<number> {
  const db = getDb();
  const now = Date.now();
  let wait = 0;
  for (const b of buckets) {
    const expired = now - b.windowSec * 1000;
    const row = await db
      .insert(authLimits)
      .values({ key: b.key, count: 1, windowStart: now })
      .onConflictDoUpdate({
        target: authLimits.key,
        set: {
          count: sql`case when ${authLimits.windowStart} <= ${expired} then 1 else ${authLimits.count} + 1 end`,
          windowStart: sql`case when ${authLimits.windowStart} <= ${expired} then ${now} else ${authLimits.windowStart} end`,
        },
      })
      .returning({ count: authLimits.count, windowStart: authLimits.windowStart })
      .get();
    if (row && row.count > b.max) {
      wait = Math.max(wait, Math.ceil((row.windowStart + b.windowSec * 1000 - now) / 1000));
    }
  }
  // Now and then, clear counters older than a day so the table stays small.
  if (Math.random() < 0.02) {
    await db.delete(authLimits).where(lt(authLimits.windowStart, now - 24 * 60 * 60 * 1000));
  }
  return wait;
}

/** Give back the slot taken for an attempt that does not count. */
async function release(buckets: Bucket[]): Promise<void> {
  if (buckets.length === 0) return;
  await getDb()
    .update(authLimits)
    .set({ count: sql`max(${authLimits.count} - 1, 0)` })
    .where(inArray(authLimits.key, buckets.map((b) => b.key)));
}

export interface Limiter {
  /** Seconds to wait before trying again, 0 when allowed. */
  wait: number;
  /** Give the slot back (the attempt was refused, or it succeeded and only failures count). */
  release: () => Promise<void>;
}

/**
 * Take a slot for one attempt in the bucket of every address given (for a
 * change of email, both the new address and the account's own), plus the IP
 * bucket when there is one. When `wait` is above 0 the attempt is refused
 * and its slots were already given back.
 */
export async function takeAuthLimit(request: Request, action: LimitAction, emails: (string | null)[]): Promise<Limiter> {
  const buckets = await bucketsFor(request, action, emails);
  const wait = await take(buckets);
  const limiter = { wait, release: () => release(buckets) };
  if (wait > 0) await limiter.release().catch(() => undefined);
  return limiter;
}

/** "Too many attempts. Wait 10 minutes and try again." */
export function tooManyMessage(waitSec: number): string {
  const minutes = Math.max(1, Math.ceil(waitSec / 60));
  return `Too many attempts. Wait ${minutes === 1 ? "a minute" : `${minutes} minutes`} and try again.`;
}
