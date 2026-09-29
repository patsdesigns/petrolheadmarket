import { adminEmails, absoluteUrl } from "./config";
import { sendEmail } from "./email";
import { url } from "./paths";

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
      }).catch((err) => console.error("[notify] admin email failed", err)),
    ),
  );
}
