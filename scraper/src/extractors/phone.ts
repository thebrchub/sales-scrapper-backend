import { parsePhoneNumberFromString, PhoneNumber } from "libphonenumber-js";

export interface PhoneResult {
  e164: string;
  type: string; // mobile, fixed_line, voip, toll_free, unknown
  valid: boolean;
}

/** Validate + normalize a phone number string. */
export function validatePhone(
  raw: string,
  defaultCountry: string = "US"
): PhoneResult | null {
  try {
    const parsed: PhoneNumber | undefined = parsePhoneNumberFromString(
      raw,
      defaultCountry as any
    );
    if (!parsed) return null;

    return {
      e164: parsed.format("E.164"),
      type: mapType(parsed.getType()),
      valid: parsed.isValid(),
    };
  } catch {
    return null;
  }
}

function mapType(t: string | undefined): string {
  switch (t) {
    case "MOBILE":
      return "mobile";
    case "FIXED_LINE":
      return "landline";
    case "VOIP":
      return "voip";
    case "TOLL_FREE":
      return "toll_free";
    case "FIXED_LINE_OR_MOBILE":
      return "mobile";
    default:
      return "unknown";
  }
}
