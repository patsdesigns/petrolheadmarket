import { z } from "zod";
import { url, GARAGE } from "./paths";

/** Read a POSTed form and validate it. Field errors are keyed by field name. */
export async function parseForm<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<
  | { ok: true; data: z.infer<S>; values: Record<string, string> }
  | { ok: false; errors: Record<string, string>; values: Record<string, string> }
> {
  const form = await request.formData();
  const values: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") values[k] = v;

  const result = schema.safeParse(values);
  if (result.success) return { ok: true, data: result.data, values };

  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "form");
    errors[key] ??= issue.message;
  }
  return { ok: false, errors, values };
}

export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Enter your email.")
  .max(254, "That email is too long.")
  .pipe(z.email("Enter a valid email, like name@example.com."));

export const passwordField = z
  .string()
  .min(8, "Use at least 8 characters.")
  .max(128, "Use 128 characters or fewer.");

/**
 * Only allow redirects to a page on this site, never to another site.
 * Old "/app/..." links (from before the move off Webflow) lose the prefix.
 * Anything else falls back to My Garage.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next) return url(GARAGE);
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return url(GARAGE);
  if (next === "/app" || next.startsWith("/app/") || next.startsWith("/app?")) {
    const rest = next.slice(4);
    return !rest || rest.startsWith("?") ? `${url(GARAGE)}${rest}` : rest;
  }
  return next;
}
