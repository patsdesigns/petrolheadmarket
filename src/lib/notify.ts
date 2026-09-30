import { adminEmails, absoluteUrl } from "./config";
import { questionsLine } from "./contact";
import { sendEmail } from "./email";
import { url, carUrl, GARAGE } from "./paths";
import { safeError } from "./log";

/** Tell the review team a listing is waiting. Failures are logged, not thrown. */
export async function notifyAdminsSubmitted(listingId: string, title: string): Promise<void> {
  const link = absoluteUrl(url(`/admin/listings/${listingId}`));
  await Promise.all(
    [...adminEmails()].map((to) =>
      sendEmail({
        to,
        subject: `New listing to review: ${title}`,
        paragraphs: [`${title} was submitted for review.`],
        action: { label: "Review listing", url: link },
      }).catch((err) => console.error("[notify] admin email failed", safeError(err))),
    ),
  );
}

interface Seller {
  email: string;
  name: string;
  /** profiles.email_notifications: emails for new messages and offers. */
  notify?: boolean;
}

export async function notifySellerLive(seller: Seller, listingId: string, title: string, slug: string) {
  await sendEmail({
    to: seller.email,
    subject: `Your ${title} is live`,
    paragraphs: [
      `Good news, ${seller.name}. Your ${title} passed review and is now live on Petrol Head Market.`,
      // Only promise message and offer emails when the seller gets them.
      seller.notify === false
        ? "Buyers' messages and offers show up in your inbox and on the Offers page. You can change the price, offers and contact settings any time from My garage."
        : "We will email you when a buyer sends a message or an offer. You can change the price, offers and contact settings any time from My garage.",
    ],
    action: { label: "See your listing", url: absoluteUrl(carUrl(slug)) },
  }).catch((err) => console.error("[notify] live email failed", listingId, safeError(err)));
}

export async function notifySellerChanges(seller: Seller, listingId: string, title: string, notes: string) {
  await sendEmail({
    to: seller.email,
    subject: `A few changes needed on your ${title}`,
    paragraphs: [
      `Hi ${seller.name}, thanks for listing your ${title}. Our reviewer asked for a few changes before it goes live:`,
      notes,
      "Make the changes and submit it again for another review.",
    ],
    action: { label: "Update my listing", url: absoluteUrl(url(`/listings/${listingId}/edit`)) },
  }).catch((err) => console.error("[notify] changes email failed", listingId, safeError(err)));
}

export async function notifySellerRejected(seller: Seller, listingId: string, title: string, notes: string) {
  await sendEmail({
    to: seller.email,
    subject: `About your ${title} listing`,
    paragraphs: [
      `Hi ${seller.name}, thanks for listing your ${title} with Petrol Head Market. We are not able to accept this listing.`,
      notes,
      questionsLine(listingId),
    ],
    // Through sign in: a signed-out visit to /app goes to the Lot instead.
    action: { label: "Open My garage", url: absoluteUrl(`${url("/login")}?next=${encodeURIComponent(url(GARAGE))}`) },
  }).catch((err) => console.error("[notify] rejected email failed", listingId, safeError(err)));
}
