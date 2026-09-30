// Sellers type plain text. These turn it into safe HTML for the car page's
// rich text sections. Everything is escaped; no user HTML ever passes through.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Blank lines separate paragraphs. Single line breaks become <br>. */
export function toParagraphs(text: string | null | undefined): string | null {
  if (!text?.trim()) return null;
  const paras = text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${p.split("\n").map((l) => escapeHtml(l.trim())).join("<br>")}</p>`);
  return paras.length ? paras.join("") : null;
}

/** Each non-empty line becomes a list item. Leading "-", "*" or "•" is dropped. */
export function toList(text: string | null | undefined): string | null {
  if (!text?.trim()) return null;
  const items = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim().replace(/^[-*•]\s*/, ""))
    .filter(Boolean)
    .map((l) => `<li>${escapeHtml(l)}</li>`);
  return items.length ? `<ul>${items.join("")}</ul>` : null;
}
