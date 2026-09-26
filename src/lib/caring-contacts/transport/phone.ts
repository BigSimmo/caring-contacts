// src/lib/caring-contacts/transport/phone.ts
//
// Turns a stored Australian mobile number into the E.164 form a carrier expects, or refuses it.
// Only Australian mobiles (04xx / +61 4xx) are accepted: the sovereign telephony rule (deployment
// spec §4.2) is that this service texts Australian mobiles through an Australian carrier.
import { DESIGNATED_FICTIONAL_MOBILE_NUMBERS } from "../synthetic-contacts";

const AUSTRALIAN_MOBILE = /^(?:\+?61|0)(4\d{8})$/;

/** `+614XXXXXXXX`, or null when the value is not an Australian mobile number. */
export function toAustralianMobileE164(stored: string | null | undefined): string | null {
  if (typeof stored !== "string") return null;
  const compact = stored.replace(/[\s().-]/g, "");
  const match = AUSTRALIAN_MOBILE.exec(compact);
  return match ? `+61${match[1]}` : null;
}

const FICTIONAL_E164 = new Set(
  DESIGNATED_FICTIONAL_MOBILE_NUMBERS.map((number) => toAustralianMobileE164(number)).filter(
    (value): value is string => value !== null,
  ),
);

/** True for one of the reserved fictional numbers this prototype's invented people use. */
export function isDesignatedFictionalMobile(e164: string): boolean {
  return FICTIONAL_E164.has(e164);
}
