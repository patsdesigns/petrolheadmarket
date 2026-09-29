import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { env } from "cloudflare:workers";
import { getDb } from "../db/client";
import * as schema from "../db/schema";
import { sendEmail } from "./email";
import { ensureProfile } from "./profile";
import { IP_HEADERS, publicOrigin } from "./config";
import { url } from "./paths";

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
      // offer or sending a message checks emailVerified instead.
      requireEmailVerification: false,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url: link }) => {
        await sendEmail({
          to: user.email,
          subject: "Reset your password",
          paragraphs: [
            `Hi ${user.name}, someone asked to reset the password for your Petrol Head Market account.`,
            "The link works for one hour. If you did not ask for this, you can ignore this email.",
          ],
          action: { label: "Choose a new password", url: link },
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, url: link }) => {
        await sendEmail({
          to: user.email,
          subject: "Confirm your email",
          paragraphs: [
            `Hi ${user.name}, confirm your email to list a car, make offers and message sellers on Petrol Head Market.`,
            "The link works for 24 hours.",
          ],
          action: { label: "Confirm my email", url: link },
        });
      },
    },
    user: {
      changeEmail: { enabled: true },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 3 },
        "/request-password-reset": { window: 300, max: 3 },
        "/send-verification-email": { window: 300, max: 3 },
      },
    },
    advanced: {
      cookiePrefix: "phm",
      // Rate limits are keyed by client IP. Webflow Cloud runs on Cloudflare.
      ipAddress: { ipAddressHeaders: IP_HEADERS },
      useSecureCookies: origin.startsWith("https://"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
    },
    databaseHooks: {
      session: {
        create: {
          // Runs on every sign in: create the profile and sync the admin role.
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
