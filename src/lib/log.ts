/**
 * Error text that is safe to write to the log (and to audit_log).
 *
 * drizzle-orm wraps every failed query in a DrizzleQueryError whose message
 * ends with the bound parameters ("params: ..."), and Better Auth looks
 * sessions up by token and users by email, so a whole error object can carry
 * a session token or an address. This keeps the error name and message (and
 * those of its causes) with the params cut off and any email address masked.
 * Logs never carry links, tokens, contact details or message bodies.
 */
function redact(message: string): string {
  const cut = message.search(/\n?\s*params:/);
  const text = cut >= 0 ? message.slice(0, cut) : message;
  return text.replace(/[^\s@<>"',;:()]+@[^\s@<>"',;:()]+\.[a-z]{2,}/gi, "[email]").slice(0, 500);
}

/** The error's message, redacted. For the audit log and user facing errors. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return redact(err.message);
  return typeof err === "string" ? redact(err) : "error";
}

/** "Name: message <- CauseName: cause message", redacted. Never the object itself. */
export function safeError(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current !== undefined && current !== null; depth++) {
    if (current instanceof Error) {
      parts.push(`${current.name}: ${redact(current.message)}`);
      current = (current as Error & { cause?: unknown }).cause;
    } else {
      parts.push(typeof current === "string" ? redact(current) : "error");
      break;
    }
  }
  return parts.join(" <- ") || "error";
}
