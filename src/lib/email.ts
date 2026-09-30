import { env } from "cloudflare:workers";
import { emailConfigured, isAdminEmail, supportEmail } from "./config";

export { emailConfigured };

interface Email {
  to: string;
  subject: string;
  /** Plain paragraphs. Each string is escaped and becomes one paragraph. */
  paragraphs: string[];
  action?: { label: string; url: string };
  /**
   * Only the password reset sets this. With email off, it lets the full text
   * (with the link) go to the log when the recipient is in ADMIN_EMAILS, so
   * the owner can prove his address. Confirmation links never go to the log.
   */
  adminBootstrap?: boolean;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderHtml({ subject, paragraphs, action }: Email): string {
  const body = paragraphs
    .map((p) => `<p style="margin:0 0 16px;line-height:1.5">${escapeHtml(p)}</p>`)
    .join("");
  const button = action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:#D5001C;color:#fff;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:8px">${escapeHtml(action.label)}</a></p>
       <p style="margin:0 0 16px;font-size:13px;color:#5A5E66">Or paste this link into your browser:<br>${escapeHtml(action.url)}</p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#F6F6F3;font-family:Arial,Helvetica,sans-serif;color:#15171B">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="background:#15171B;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;font-weight:900">Petrol Head Market</div>
    <div style="background:#fff;border:1px solid #DDDDD5;border-top:0;border-radius:0 0 12px 12px;padding:24px 20px">
      <h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(subject)}</h1>
      ${body}${button}
    </div>
  </div></body></html>`;
}

function renderText({ paragraphs, action }: Email): string {
  return [...paragraphs, action ? `${action.label}: ${action.url}` : ""].filter(Boolean).join("\n\n");
}

/** "dave@example.com" -> "example.com". Logs never carry full addresses. */
function domainOf(address: string): string {
  return address.split("@").pop() || "unknown";
}

/**
 * Send a transactional email through Resend. Returns true when Resend
 * accepted it and false when email is not switched on (no RESEND_API_KEY).
 *
 * Without a key nothing is delivered. The log gets only the recipient's
 * domain and the subject, never links, tokens or bodies. The one exception
 * is the password reset to an ADMIN_EMAILS address, which is logged in full
 * so the owner can reset (and so confirm, or take back) his own account from
 * the Webflow Cloud log while email is off. Every other email to an admin is
 * logged like any other (it can hold contact details or message text).
 */
export async function sendEmail(email: Email): Promise<boolean> {
  if (!emailConfigured()) {
    if (email.adminBootstrap && isAdminEmail(email.to)) {
      console.log(`[email] not sent (email is off), admin copy subject="${email.subject}"\n${renderText(email)}`);
    } else {
      console.log(`[email] not sent (email is off) to=@${domainOf(email.to)} subject="${email.subject}"`);
    }
    return false;
  }
  const replyTo = supportEmail();
  // RESEND_API_BASE is only for local tests against a fake API. Leave it unset.
  const res = await fetch(`${env.RESEND_API_BASE || "https://api.resend.com"}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM || "Petrol Head Market <onboarding@resend.dev>",
      to: [email.to],
      ...(replyTo ? { reply_to: replyTo } : {}),
      subject: email.subject,
      html: renderHtml(email),
      text: renderText(email),
    }),
  });
  if (!res.ok) {
    // Status only: Resend's error text can repeat the recipient's address.
    console.error(`[email] Resend error ${res.status} to=@${domainOf(email.to)} subject="${email.subject}"`);
    throw new Error("Email could not be sent");
  }
  return true;
}
