// Choices sellers pick from.

export const TRANSMISSIONS = [
  { value: "manual_5", label: "5-speed manual" },
  { value: "manual_6", label: "6-speed manual" },
  { value: "automatic", label: "Automatic" },
  { value: "dct", label: "DCT / PDK" },
] as const;

export const DRIVETRAINS = [
  { value: "rwd", label: "RWD" },
  { value: "awd", label: "AWD" },
  { value: "fwd", label: "FWD" },
  { value: "4wd", label: "4WD" },
] as const;

export const BODY_STYLES = [
  { value: "coupe", label: "Coupe" },
  { value: "convertible", label: "Convertible" },
  { value: "targa", label: "Targa" },
  { value: "hatchback", label: "Hatchback" },
  { value: "sedan", label: "Sedan" },
  { value: "wagon", label: "Wagon" },
  { value: "truck", label: "Truck" },
  { value: "suv", label: "SUV" },
] as const;

export const TITLE_STATUSES = [
  { value: "clean", label: "Clean" },
  { value: "rebuilt", label: "Rebuilt" },
  { value: "salvage", label: "Salvage" },
  { value: "lien", label: "Clean, with a lien" },
  { value: "none", label: "No title (bill of sale)" },
] as const;

export const CONTACT_METHODS = [
  { value: "messages", label: "Messages only" },
  { value: "messages_phone", label: "Messages and phone" },
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
  awaiting_payment: "Approved, pay to publish",
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
