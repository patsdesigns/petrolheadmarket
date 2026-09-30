import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import * as schema from "../db/schema";
import { sendEmail } from "./email";
import { ensureProfile, roleFor } from "./profile";
import { IP_HEADERS, publicOrigin } from "./config";
import { url } from "./paths";

/**
 * Names come only from our own forms, but check them here too so no path
 * into Better Auth can store an empty or huge name.
 */
function checkName(name: unknown): string {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (trimmed.length < 2 || trimmed.length > 80) {
    throw new APIError("BAD_REQUEST", { message: "Use 2 to 80 characters for your name." });
  }
  return trimmed;
}

/**
 * Reset links an admin asked for on /app/admin/users (adminResetLink in
 * src/lib/admin-users.ts), keyed by a one-time id sent in a header. The
 * header only reaches Better Auth from that server call: the public auth
 * route serves no POSTs and callAuth() never forwards it, and an id that is
 * not waiting here is ignored.
 */
export const RESET_CAPTURE_HEADER = "x-phm-reset-capture";
export const resetCaptures = new Map<string, string | null>();

/**
 * Addresses whose confirmation email failed to send during this request
 * (Better Auth swallows the error on sign up). The signup page checks it so
 * it never says a link was sent when it was not.
 */
export const verifySendFailures = new Set<string>();

export const SUSPENDED_MESSAGE = "This account is suspended. Contact our team if you think this is a mistake.";

function createAuth() {
  const origin = publicOrigin();
  return betterAuth({
    appName: "Petrol Head Market",
    baseURL: origin,
    basePath: url("/api/auth"),
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [origin],
    database: drizzleAdapter(getDb(), { provider: "sqlite", schema }),
    emailAndPassword: {
      enabled: true,
      // Signing in works before verification; submitting a listing, making an
      // offer or sending a message checks canTransact() (config.ts) instead.
      requireEmailVerification: false,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url: link }, request) => {
        // An admin is getting this link to send from his own inbox: show it
        // to him instead of emailing or logging it.
        const capture = request?.headers.get(RESET_CAPTURE_HEADER);
        if (capture && resetCaptures.has(capture)) {
          resetCaptures.set(capture, link);
          return;
        }
        await sendEmail({
          to: user.email,
          subject: "Reset your password",
          paragraphs: [
            `Hi ${user.name}, someone asked to reset the password for your Petrol Head Market account.`,
            "The link works for one hour. If you did not ask for this, you can ignore this email.",
          ],
          action: { label: "Choose a new password", url: link },
          // While email is off, this is how the owner proves an ADMIN_EMAILS
          // address is his: the link goes to the log (only for those
          // addresses), and finishing the reset confirms the email.
          adminBootstrap: true,
        });
      },
      // A finished reset proves the person can read that inbox (or, while
      // email is off, the log, which only ever gets links for ADMIN_EMAILS
      // addresses), so it also confirms the email. The reset has already
      // replaced the password, and every session is revoked right after
      // this, so an account someone else signed up with first is fully
      // taken back. This is the only way an admin address is confirmed
      // while email is off: confirmation links are never logged.
      onPasswordReset: async ({ user }) => {
        if (user.emailVerified) return;
        await getDb().update(schema.user).set({ emailVerified: true, updatedAt: new Date() }).where(eq(schema.user.id, user.id));
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, url: link }) => {
        const sent = await sendEmail({
          to: user.email,
          subject: "Confirm your email",
          paragraphs: [
            `Hi ${user.name}, confirm your email to list a car, make offers and message sellers on Petrol Head Market.`,
            "The link works for 24 hours. If you did not create this account, ignore this email and do not open the link.",
          ],
          action: { label: "Confirm my email", url: link },
          // Never logged, even for ADMIN_EMAILS: a stranger could have signed
          // up with the owner's address, and opening the link would confirm
          // the stranger's account. Admin addresses are confirmed with a
          // password reset instead (onPasswordReset above).
        }).catch((err) => {
          verifySendFailures.add(user.email.toLowerCase());
          throw err;
        });
        if (!sent) verifySendFailures.add(user.email.toLowerCase());
      },
    },
    user: {
      changeEmail: { enabled: true },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    // Off on purpose. Behind Webflow's proxy the visitor IP is often unknown,
    // which put every visitor in one bucket, and other IP headers can be
    // spoofed. callAuth() applies the app's own limits (src/lib/auth-limits.ts).
    rateLimit: { enabled: false },
    advanced: {
      cookiePrefix: "phm",
      // Only Cloudflare's own header, which the client cannot set. Used for
      // the IP stored on sessions.
      ipAddress: { ipAddressHeaders: IP_HEADERS },
      useSecureCookies: origin.startsWith("https://"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (u) => ({ data: { ...u, name: checkName(u.name) } }),
        },
        update: {
          // Only when a name is being changed: verifying or changing an email
          // also updates the user, without a name.
          before: async (u) => (u.name !== undefined ? { data: { ...u, name: checkName(u.name) } } : { data: u }),
        },
      },
      session: {
        create: {
          // Suspended accounts (set by an admin) cannot sign in. Admin
          // addresses are never suspended (see src/lib/admin-users.ts).
          before: async (s) => {
            const p = await getDb().query.profiles.findFirst({
              where: (t, { eq }) => eq(t.userId, s.userId),
            });
            const u = p?.suspendedAt
              ? await getDb().query.user.findFirst({ where: (t, { eq }) => eq(t.id, s.userId) })
              : undefined;
            if (p?.suspendedAt && !(u && roleFor(u) === "admin")) {
              throw new APIError("FORBIDDEN", { message: SUSPENDED_MESSAGE, code: "ACCOUNT_SUSPENDED" });
            }
            return { data: s };
          },
          // Runs on every sign in: create the profile and sync the admin role.
          // The middleware also syncs it on every request.
          after: async (session) => {
            const db = getDb();
            const u = await db.query.user.findFirst({
              where: (t, { eq }) => eq(t.id, session.userId),
            });
            if (u) await ensureProfile(u, true);
          },
        },
      },
    },
    telemetry: { enabled: false },
  });
}

let instance: ReturnType<typeof createAuth> | undefined;

/** One Better Auth instance per Worker isolate. */
export function getAuth() {
  instance ??= createAuth();
  return instance;
}

export type Auth = ReturnType<typeof createAuth>;
export type SessionData = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;
