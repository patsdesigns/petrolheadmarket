import { env } from "cloudflare:workers";

interface Email {
  to: string;
  subject: string;
  /** Plain paragraphs. Each string is escaped and becomes one paragraph. */
  paragraphs: string[];
  action?: { label: string; url: string };
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

/**
 * Send a transactional email through Resend. Without RESEND_API_KEY (local
 * development) the email is logged instead so flows can still be tested.
 */
export async function sendEmail(email: Email): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.log(`[email] to=${email.to} subject="${email.subject}"\n${renderText(email)}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM || "Petrol Head Market <onboarding@resend.dev>",
      to: [email.to],
      subject: email.subject,
      html: renderHtml(email),
      text: renderText(email),
    }),
  });
  if (!res.ok) {
    console.error(`[email] Resend error ${res.status}: ${await res.text()}`);
    throw new Error("Email could not be sent");
  }
}
