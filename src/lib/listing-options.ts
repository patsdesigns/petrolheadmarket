// Choices sellers pick from. `cms` is the Webflow option ID (see CLAUDE.md).

export const TRANSMISSIONS = [
  { value: "manual_5", label: "5-speed manual", cms: "b0355584a92f5f24e9e5267bb1e67f0f" },
  { value: "manual_6", label: "6-speed manual", cms: "1717b997803538680039794389f71c38" },
  { value: "automatic", label: "Automatic", cms: "5ff57da4ed58cf496487084506423a34" },
  { value: "dct", label: "DCT / PDK", cms: "6a075c32f925dba2b078b861b2d06cf4" },
] as const;

export const DRIVETRAINS = [
  { value: "rwd", label: "RWD", cms: "3d655f503bf5f33a04dfbd7421c29631" },
  { value: "awd", label: "AWD", cms: "0d7f9e4f7e11952182d141455e09d11f" },
  { value: "fwd", label: "FWD", cms: "6520ed8ff4f9edff6cf5f07203d24fc3" },
  { value: "4wd", label: "4WD", cms: "f84ded1a3fae0dc54b82c10255e2d059" },
] as const;

export const BODY_STYLES = [
  { value: "coupe", label: "Coupe", cms: "f9d87ca79b2f9c8c54f3bf10a3d78c50" },
  { value: "convertible", label: "Convertible", cms: "7fa15466ab07a06a709d187d6faf9780" },
  { value: "targa", label: "Targa", cms: "0126f3babe618adc23c7f66e6d75fe46" },
  { value: "hatchback", label: "Hatchback", cms: "a02520d6a0a379241c7628dee386b76f" },
  { value: "sedan", label: "Sedan", cms: "89458d180894b3e13d2d5f03ef8dec61" },
  { value: "wagon", label: "Wagon", cms: "5bb363601c870d8c12c1c93302112477" },
  { value: "truck", label: "Truck", cms: "9bffdbd99cc85c414ed0a48196dd75fe" },
  { value: "suv", label: "SUV", cms: "ea30a73de35eb831a6fc833a94850961" },
] as const;

export const TITLE_STATUSES = [
  { value: "clean", label: "Clean" },
  { value: "rebuilt", label: "Rebuilt" },
  { value: "salvage", label: "Salvage" },
  { value: "lien", label: "Clean, with a lien" },
  { value: "none", label: "No title (bill of sale)" },
] as const;

export const CONTACT_METHODS = [
  { value: "messages", label: "Messages only", cms: "9241b2ba438eb46eb9001ced00f2fa1d" },
  { value: "messages_phone", label: "Messages and phone", cms: "ed8ceffa431c12d0d6e8d3da1f109765" },
] as const;

export const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
  "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM",
  "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA",
  "WV", "WI", "WY",
] as const;

export function optionLabel(
  list: readonly { value: string; label: string }[],
  value: string | null | undefined,
): string {
  return list.find((o) => o.value === value)?.label ?? "";
}

export const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  awaiting_payment: "Awaiting payment",
  submitted: "In review",
  changes_requested: "Changes requested",
  approved: "Approved",
  live: "Live",
  offer_accepted: "Offer accepted",
  sold: "Sold",
  rejected: "Not accepted",
  withdrawn: "Withdrawn",
};

/** Statuses where the seller can still edit everything. */
export const EDITABLE_STATUSES = ["draft", "changes_requested"] as const;

export const MIN_PHOTOS = 20;
export const MAX_PHOTOS = 80;
export const MIN_DESCRIPTION = 300;
