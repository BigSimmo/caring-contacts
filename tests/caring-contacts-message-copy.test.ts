import { describe, expect, it } from "vitest";

import { calculateGsm7, maxSeptetsWithin } from "@/lib/caring-contacts/message-policy";
import { PROVISIONAL_MESSAGE_RULES } from "@/lib/caring-contacts/message-rules";
import {
  AUTOMATED_REPLY_GSM7,
  AUTOMATED_REPLY_RESPONSE,
  CLINICIAN_FACING_WORDING_APPROVAL_STATUS,
  EXACT_MESSAGE_GSM7,
  EXACT_PATIENT_VISIBLE_MESSAGE,
  PATIENT_VISIBLE_MESSAGE_BASE_SEPTETS,
  PATIENT_VISIBLE_NO_REPLY_NOTICE,
  PREFERRED_NAME_MAX_SEPTETS,
  SPECIMEN_PREFERRED_NAME,
  preferredNameMaxSeptets,
  resolvePatientVisibleMessage,
} from "@/lib/caring-contacts/message-copy";
import {
  DESIGNATED_FICTIONAL_MOBILE_NUMBERS,
  FICTIONAL_CONTACTS_BY_ROLE,
} from "@/lib/caring-contacts/synthetic-contacts";

describe("caring-contacts patient-visible copy", () => {
  it("keeps the patient-visible message inside its approved segment ceiling, for every name it accepts", () => {
    // THIS REPLACES THE EXACT `septets: 252` PIN, AND IT IS A STRICTLY STRONGER STATEMENT — the pin
    // was not deleted, it was superseded (2026-08-26).
    //
    // 252 was true of ONE message: the specimen, with the fictional name `Rowan` in it. The message
    // is a template now, so the interesting property is no longer "this one string is 252 septets"
    // but "no name this domain accepts can push this message past its ceiling". A number cannot say
    // that; a bound quantified over every accepted length can, and it stays true when the
    // PROVISIONAL wording changes — which the number could not.
    //
    // The specimen's own evidence is still pinned, in caring-contact-mockups.dom.test.tsx, where the
    // claim belongs: that is the string the mockups render.
    const ceiling = maxSeptetsWithin(PROVISIONAL_MESSAGE_RULES.maxSegments);

    for (let length = 1; length <= PREFERRED_NAME_MAX_SEPTETS; length += 1) {
      // Basic-set characters, so one character costs exactly one septet and `length` IS the septet
      // cost of this name. The extension-set case, where it is not, is its own test below.
      const name = "x".repeat(length);
      const resolved = resolvePatientVisibleMessage(name, { syntheticFictionalContactsAcknowledged: true as const });

      expect(resolved).toMatchObject({ ok: true });
      if (!resolved.ok) continue;

      // The name really is IN the message. Without this, a template that stopped substituting
      // would hold every septet claim below constant at the base length and this whole loop would
      // go green while the message greeted nobody.
      expect(resolved.text).toContain(name);

      const evidence = calculateGsm7(resolved.text);
      expect(evidence.valid).toBe(true);
      expect(evidence.segments).toBeLessThanOrEqual(PROVISIONAL_MESSAGE_RULES.maxSegments);
      expect(evidence.septets).toBeLessThanOrEqual(ceiling);
    }
  });

  it("caps the name at the largest one that fits, and refuses the next character", () => {
    // Both ends, because a cap that is merely SAFE is not the same claim as a cap that is RIGHT. A
    // cap of 1 would pass the bound above and quietly refuse almost every real name.
    const ceiling = maxSeptetsWithin(PROVISIONAL_MESSAGE_RULES.maxSegments);
    const longestAccepted = "x".repeat(PREFERRED_NAME_MAX_SEPTETS);

    const accepted = resolvePatientVisibleMessage(longestAccepted, {
      syntheticFictionalContactsAcknowledged: true as const,
    });
    expect(accepted).toMatchObject({ ok: true });
    if (accepted.ok) {
      const evidence = calculateGsm7(accepted.text);
      // Exactly at the ceiling, not merely below it: the cap spends all the headroom there is.
      expect(evidence.septets).toBe(ceiling);
      expect(evidence.segments).toBe(PROVISIONAL_MESSAGE_RULES.maxSegments);
    }

    expect(
      resolvePatientVisibleMessage(`${longestAccepted}x`, { syntheticFictionalContactsAcknowledged: true as const }),
    ).toEqual({
      ok: false,
      issue: {
        code: "preferred-name-too-long",
        septets: PREFERRED_NAME_MAX_SEPTETS + 1,
        maxSeptets: PREFERRED_NAME_MAX_SEPTETS,
      },
    });

    // And the refusal is not the cap being zero or negative: there is real room here. The comment in
    // message-copy.ts once read "no room left", which meant no room for one particular extra
    // sentence and was later read as meaning no headroom at all.
    expect(PREFERRED_NAME_MAX_SEPTETS).toBe(ceiling - PATIENT_VISIBLE_MESSAGE_BASE_SEPTETS);
    expect(PREFERRED_NAME_MAX_SEPTETS).toBeGreaterThan(0);
  });

  it("counts the name in septets rather than characters, so a two-septet character costs two", () => {
    // `€` is a GSM-7 EXTENSION character: one character, two septets. A cap measured in characters
    // would accept a name of `PREFERRED_NAME_MAX_SEPTETS` of them and produce a three-segment
    // message. The positive control is the half-length name, which must still be accepted — an
    // implementation that simply refused every `€` would pass the refusal alone.
    const halfLength = Math.floor(PREFERRED_NAME_MAX_SEPTETS / 2);

    const accepted = resolvePatientVisibleMessage("€".repeat(halfLength), {
      syntheticFictionalContactsAcknowledged: true as const,
    });
    expect(accepted).toMatchObject({ ok: true });
    if (accepted.ok) {
      expect(calculateGsm7(accepted.text).segments).toBe(PROVISIONAL_MESSAGE_RULES.maxSegments);
    }

    const refused = resolvePatientVisibleMessage("€".repeat(PREFERRED_NAME_MAX_SEPTETS), {
      syntheticFictionalContactsAcknowledged: true as const,
    });
    expect(refused).toMatchObject({ ok: false, issue: { code: "preferred-name-too-long" } });
  });

  it("gives the same cap rule to any text a name is substituted into, not just this template", () => {
    // A pathway version carries its own `messageTextByType`, and the demo corpus stores a copy of
    // the current wording there. A cap derived from THIS template does not bound that string, so the
    // rule is exposed rather than only its answer -- a second cap computed a second way is how two
    // answers to one question come to disagree.
    //
    // Applied to this module's own template it must give exactly the exported constant. That is the
    // control that the general function and the specific number are one rule.
    expect(preferredNameMaxSeptets(EXACT_PATIENT_VISIBLE_MESSAGE.replace(SPECIMEN_PREFERRED_NAME, ""))).toBe(
      PREFERRED_NAME_MAX_SEPTETS,
    );

    // A shorter text has more room, a longer one has less, and the difference is exactly the
    // difference in length -- so a wording change moves the cap rather than silently invalidating it.
    const ceiling = maxSeptetsWithin(PROVISIONAL_MESSAGE_RULES.maxSegments);
    expect(preferredNameMaxSeptets("Hi , from us.")).toBe(ceiling - "Hi , from us.".length);
    expect(preferredNameMaxSeptets("x".repeat(ceiling))).toBe(0);

    // A text with no room left yields a cap of zero or less, and every name is then refused as too
    // long. The honest arithmetic, not a floor that would let a name in.
    expect(preferredNameMaxSeptets("x".repeat(ceiling + 5))).toBeLessThan(0);
  });

  it("refuses rather than sending an unpersonalised greeting nobody has authored", () => {
    // There is no no-name wording, and inventing one would be an implementer drafting
    // patient-visible copy for a suicide-prevention message. So the absence is a loud refusal,
    // exactly as `resolveClosingContactMessageBody` refuses for the closing message.
    for (const absent of [null, "", "   "]) {
      expect(resolvePatientVisibleMessage(absent, { syntheticFictionalContactsAcknowledged: true })).toEqual({
        ok: false,
        issue: { code: "preferred-name-not-recorded" },
      });
    }

    // Positive control: the same function DOES produce a message when a name is recorded, so the
    // three refusals above are the absence being refused rather than the function refusing always.
    expect(
      resolvePatientVisibleMessage("Rowan", { syntheticFictionalContactsAcknowledged: true as const }),
    ).toMatchObject({ ok: true });
  });

  it("refuses a name this channel cannot carry, rather than emitting a message it would mangle", () => {
    // `ë` is outside the GSM-7 alphabet. `calculateGsm7` reports the whole message `valid: false`,
    // `validateGovernedMessage` checks the segment ceiling only when the message IS valid, and
    // `MessageValidationIssue` has no invalid-characters code — so an accepted `Zoë` produces a
    // message this domain reports as VALID with the ceiling never evaluated. The demonstrable
    // failure is that the two-segment limit silently stops being enforced, NOT that the message
    // arrives damaged: a real gateway re-encodes to UCS-2 and delivers it intact, at 70/67
    // characters per segment. Nothing here models that path, so within this system the message is
    // unencodable and refusing is the conservative answer. The character set is a telecom
    // specification, so nothing in the refusal decides anything about the patient.
    expect(resolvePatientVisibleMessage("Zoë", { syntheticFictionalContactsAcknowledged: true as const })).toEqual({
      ok: false,
      issue: { code: "preferred-name-not-sendable", unsupportedCharacters: ["ë"] },
    });

    // Positive control on the alphabet itself: accented characters that ARE in GSM-7 are accepted,
    // so this is a transport limit rather than a blanket refusal of anything unfamiliar.
    expect(
      resolvePatientVisibleMessage("José", { syntheticFictionalContactsAcknowledged: true as const }),
    ).toMatchObject({ ok: true });
  });

  it("routes candidate message text through validateGovernedMessage and refuses prohibited terms", () => {
    // Ledger #B16HW8: resolvePatientVisibleMessage routes through validateGovernedMessage.
    // If a preferred name introduces a prohibited term (e.g. "Safe"), it fails closed with that issue.
    const refused = resolvePatientVisibleMessage("Safe", { syntheticFictionalContactsAcknowledged: true });
    expect(refused).toEqual({
      ok: false,
      issue: { code: "prohibited-term", term: "safe" },
    });
  });

  it("fails closed when fictional contacts are not acknowledged", () => {
    // Omitted acknowledgment must not default to true: provisional copy embeds the fictional staffed line.
    const refused = resolvePatientVisibleMessage("Rowan");
    expect(refused).toEqual({
      ok: false,
      issue: { code: "fictional-contact-detail-present" },
    });
    const refusedExplicit = resolvePatientVisibleMessage("Rowan", { syntheticFictionalContactsAcknowledged: false });
    expect(refusedExplicit).toEqual({
      ok: false,
      issue: { code: "fictional-contact-detail-present" },
    });
  });

  it("builds the specimen from the template rather than holding a second copy of the wording", () => {
    // The reversal of Ruling [127] is narrow: the message gained a slot and nothing else changed.
    // The specimen is the template with the fictional name in it, so there is no second string that
    // could drift from the one the resolver produces.
    const resolved = resolvePatientVisibleMessage(SPECIMEN_PREFERRED_NAME, {
      syntheticFictionalContactsAcknowledged: true as const,
    });
    expect(resolved).toEqual({ ok: true, text: EXACT_PATIENT_VISIBLE_MESSAGE });
    expect(EXACT_PATIENT_VISIBLE_MESSAGE).toContain(`Hi ${SPECIMEN_PREFERRED_NAME},`);
  });

  it("keeps the pinned GSM-7 evidence for the automated reply", () => {
    // 218 -> 210 septets, owner-approved 2026-08-24 (items A2 + A3): the first sentence was
    // replaced, see the "A2 + A3" describe block below for the full covering tests. 210 -> 236,
    // owner-authorised 2026-08-27 (Ruling [144]): the fictional crisis line became the Lifeline
    // sentence, which costs 66 septets against the 40 it replaced. This one is still a fixed
    // string with no slot, so an exact pin is still the right claim about it.
    expect(AUTOMATED_REPLY_GSM7).toEqual({ invalidCharacters: [], segments: 2, septets: 236, valid: true });
  });

  it("derives its evidence from the single domain GSM-7 calculator", () => {
    expect(EXACT_MESSAGE_GSM7).toEqual(calculateGsm7(EXACT_PATIENT_VISIBLE_MESSAGE));
    expect(AUTOMATED_REPLY_GSM7).toEqual(calculateGsm7(AUTOMATED_REPLY_RESPONSE));
  });

  it("names the staffed line and crisis support in both strings and neither patient mobile", () => {
    for (const text of [EXACT_PATIENT_VISIBLE_MESSAGE, AUTOMATED_REPLY_RESPONSE]) {
      expect(text).toContain(FICTIONAL_CONTACTS_BY_ROLE.programmeStaffedLine);
      // Ruling [144]: the crisis-support contact is the owner-authorised Lifeline sentence and is
      // no longer one of this prototype's reserved fictional numbers, so it is read from the RULE
      // rather than from the fictional-contact record. The reserved number that used to sit here
      // must now be absent from both messages -- asserted separately below.
      expect(text).toContain(PROVISIONAL_MESSAGE_RULES.crisisSupportContact);
      expect(text).not.toContain(FICTIONAL_CONTACTS_BY_ROLE.crisisSupportContact);
      expect(text).not.toContain(FICTIONAL_CONTACTS_BY_ROLE.rowanPatientMobile);
      expect(text).not.toContain(FICTIONAL_CONTACTS_BY_ROLE.miraPatientMobile);
    }
  });

  it("states only that nobody reads replies, never that replies are not received", () => {
    expect(EXACT_PATIENT_VISIBLE_MESSAGE).toContain(PATIENT_VISIBLE_NO_REPLY_NOTICE);
    expect(PATIENT_VISIBLE_NO_REPLY_NOTICE).toBe("No one reads replies to this number");
    for (const text of [EXACT_PATIENT_VISIBLE_MESSAGE, AUTOMATED_REPLY_RESPONSE]) {
      expect(text).not.toMatch(/replies are not received|we monitor|monitored/i);
    }
  });

  it("includes emergency escalation and therapeutic neutrality in both patient-visible strings", () => {
    for (const text of [EXACT_PATIENT_VISIBLE_MESSAGE, AUTOMATED_REPLY_RESPONSE]) {
      expect(text).toContain("In an emergency call 000");
      expect(text).not.toContain("?");
      for (const prohibited of ["high risk", "safe", "engagement score", "campaign", "lead", "conversion", "inbox"]) {
        expect(text.toLowerCase()).not.toContain(prohibited);
      }
    }
  });

  // Ruling [131]. The module's own marker is a comment, which no screen can read and no gate can
  // check. This is the same fact as a value, so a screen states the status by reading it rather
  // than by retyping a sentence that would go on saying "provisional" after the gate had decided.
  it("states, as a value, that the patient-visible wording is not clinically approved", () => {
    expect(CLINICIAN_FACING_WORDING_APPROVAL_STATUS).toContain("has not been clinically approved");
    expect(CLINICIAN_FACING_WORDING_APPROVAL_STATUS).toContain("provisional");
    // Two approvals of a VERSION are not an approval of the words -- the distinction the sentence
    // this replaced collapsed, and the whole reason the status has to be said at all.
    expect(CLINICIAN_FACING_WORDING_APPROVAL_STATUS).toContain(
      "A pathway version's recorded approvals approve the version, not these words.",
    );
  });

  it("keeps the clinician-facing status out of both patient-visible strings", () => {
    // The positive control is the pair of assertions above: the status really is a non-empty
    // sentence, so these absences are asserted over a value that could have leaked into a message.
    expect(CLINICIAN_FACING_WORDING_APPROVAL_STATUS.length).toBeGreaterThan(0);
    // PHRASES THAT ACTUALLY OCCUR IN THE STATUS, and this is the correction M9 forced. The first
    // draft guarded "not clinically approved", which the status does not contain -- it says "has
    // not been clinically approved", and "been" sits between the two halves. A partial leak of the
    // status into a patient-visible string therefore passed the guard written to catch exactly
    // that. Both phrases below are substrings of the status and of neither message.
    for (const phrase of ["clinically approved", "provisional"]) {
      expect(CLINICIAN_FACING_WORDING_APPROVAL_STATUS, `${phrase} is not in the status`).toContain(phrase);
    }
    for (const text of [EXACT_PATIENT_VISIBLE_MESSAGE, AUTOMATED_REPLY_RESPONSE]) {
      expect(text).not.toContain(CLINICIAN_FACING_WORDING_APPROVAL_STATUS);
      expect(text).not.toContain("clinically approved");
      expect(text).not.toContain("provisional");
    }
  });

  it("uses four distinct reserved fictional numbers", () => {
    expect(new Set(DESIGNATED_FICTIONAL_MOBILE_NUMBERS).size).toBe(4);
    expect(DESIGNATED_FICTIONAL_MOBILE_NUMBERS).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// A2 + A3 (owner-approved 2026-08-24) — the automated reply no longer makes a storage claim
// nobody can currently verify, and it now tells the recipient the reply they are reading is
// automatic, so a person who was just told "no one reads this" cannot mistake a reply for a
// human response. See docs/caring-contacts/phase-2b-sdd-archive/task-c-brief.md.
// ---------------------------------------------------------------------------
describe("caring-contacts automated reply wording (A2 + A3, 2026-08-24)", () => {
  it("matches the owner-approved text exactly", () => {
    expect(AUTOMATED_REPLY_RESPONSE).toBe(
      "No one at Example Aftercare Team reads this number, and this reply is automatic. To talk to someone, " +
        `call ${FICTIONAL_CONTACTS_BY_ROLE.programmeStaffedLine}, 9 am-6 pm every day. In an emergency call 000. ` +
        "If you need to talk, Lifeline 13 11 14, any time. 13YARN 13 92 76.",
    );
  });

  it("stays within the two-segment GSM-7 ceiling (measured, not assumed)", () => {
    // 210 -> 236 septets: Ruling [144]'s crisis-line swap costs 66 septets against the 40 it
    // replaced. Message B has no name slot, so this is its whole budget and it is 70 under the
    // 306-septet two-segment ceiling. Measured here rather than assumed from Message A's figures.
    const evidence = calculateGsm7(AUTOMATED_REPLY_RESPONSE);
    expect(evidence.segments).toBe(2);
    expect(evidence.valid).toBe(true);
    expect(evidence.septets).toBe(236);
    expect(evidence.septets).toBeLessThanOrEqual(maxSeptetsWithin(PROVISIONAL_MESSAGE_RULES.maxSegments));
  });

  it("A2: drops the storage claim nobody can currently verify", () => {
    expect(AUTOMATED_REPLY_RESPONSE).not.toContain("has not been kept");
    expect(AUTOMATED_REPLY_RESPONSE).not.toContain("has not been seen by anyone");
  });

  it("A3: tells the recipient this reply itself is automatic", () => {
    expect(AUTOMATED_REPLY_RESPONSE).toContain("automatic");
  });

  it("leaves EXACT_PATIENT_VISIBLE_MESSAGE untouched by the A2/A3 wording change", () => {
    // Message A carries the A2/A3 sentence nowhere -- deliberately not touched by that change.
    // See message-copy.ts's own comment and task-c-brief.md, "A2 + A3", for why. The septet pin
    // moved 252 -> 278 for a DIFFERENT and later change (Ruling [144]'s crisis-line swap), which
    // is why the "untouched" claim above is about the A2/A3 sentence and not about the number.
    expect(EXACT_PATIENT_VISIBLE_MESSAGE).not.toContain("this reply is automatic");
    expect(calculateGsm7(EXACT_PATIENT_VISIBLE_MESSAGE).septets).toBe(278);
  });
});

// ---------------------------------------------------------------------------
// Ruling [144] (owner-authorised 2026-08-27) — the fictional crisis line is replaced by the real
// Australian crisis services, in BOTH patient-visible messages.
//
// The owner authorised the exact sentence himself, in writing, twice, having been shown the words
// and the resulting message in full and having confirmed both numbers. Nobody in this programme
// may author patient-visible wording; this is a single named exception carrying his own words.
// ---------------------------------------------------------------------------

// The owner's sentence, held here as an INDEPENDENT literal rather than read back from the module
// under test. That is the whole point of this constant: a reword, a dropped digit, or a "tidied"
// comma in message-rules.ts reddens these cases instead of being copied silently into them.
const AUTHORISED_CRISIS_LINE = "If you need to talk, Lifeline 13 11 14, any time. 13YARN 13 92 76.";

// What it replaced, reconstructed from the fictional-contact record exactly as message-copy.ts
// used to build it. Used as the positive control for every absence asserted below: a needle that
// is demonstrably a real, non-empty string, so `not.toContain` is a claim rather than decoration.
const SUPERSEDED_FICTIONAL_CRISIS_LINE = `Fictional Support Line: ${FICTIONAL_CONTACTS_BY_ROLE.crisisSupportContact}.`;

describe("caring-contacts crisis-support line (Ruling [144])", () => {
  it("holds the owner's authorised sentence byte for byte as the crisis-support rule", () => {
    expect(PROVISIONAL_MESSAGE_RULES.crisisSupportContact).toBe(AUTHORISED_CRISIS_LINE);
    // Both numbers, named individually, so a single-digit slip inside the sentence cannot hide
    // behind a whole-string comparison that someone later loosens to `toContain`.
    expect(PROVISIONAL_MESSAGE_RULES.crisisSupportContact).toContain("Lifeline 13 11 14");
    expect(PROVISIONAL_MESSAGE_RULES.crisisSupportContact).toContain("13YARN 13 92 76");
  });

  it("puts that exact sentence into both patient-visible messages", () => {
    expect(EXACT_PATIENT_VISIBLE_MESSAGE).toContain(AUTHORISED_CRISIS_LINE);
    expect(AUTOMATED_REPLY_RESPONSE).toContain(AUTHORISED_CRISIS_LINE);
  });

  it("removes the fictional crisis line, its label and its number from both messages", () => {
    // Positive control: the needle is a real, non-empty string that DOES contain both halves of
    // what is being looked for, so each absence below could have failed.
    expect(SUPERSEDED_FICTIONAL_CRISIS_LINE).toContain("Fictional Support Line");
    expect(SUPERSEDED_FICTIONAL_CRISIS_LINE).toContain(FICTIONAL_CONTACTS_BY_ROLE.crisisSupportContact);

    for (const text of [EXACT_PATIENT_VISIBLE_MESSAGE, AUTOMATED_REPLY_RESPONSE]) {
      expect(text).not.toContain(SUPERSEDED_FICTIONAL_CRISIS_LINE);
      expect(text).not.toContain("Fictional Support Line");
      expect(text).not.toContain(FICTIONAL_CONTACTS_BY_ROLE.crisisSupportContact);
    }
  });

  it("never files the real crisis service among the reserved fictional numbers", () => {
    // The failure this guards is the one Ruling [144] names: a naive swap that put a REAL, LIVE
    // crisis number into the list of numbers this system marks as fake.
    expect(Object.values(FICTIONAL_CONTACTS_BY_ROLE)).not.toContain(PROVISIONAL_MESSAGE_RULES.crisisSupportContact);
    for (const realCrisisNumber of ["13 11 14", "13 92 76"]) {
      // Positive control: each needle really is in the authorised sentence...
      expect(AUTHORISED_CRISIS_LINE).toContain(realCrisisNumber);
      // ...and appears in none of the reserved fictional numbers.
      expect(DESIGNATED_FICTIONAL_MOBILE_NUMBERS.some((number) => number.includes(realCrisisNumber))).toBe(false);
    }
    for (const fictionalNumber of DESIGNATED_FICTIONAL_MOBILE_NUMBERS) {
      expect(AUTHORISED_CRISIS_LINE).not.toContain(fictionalNumber);
    }
  });

  it("reproduces the length arithmetic rather than restating it", () => {
    const ceiling = maxSeptetsWithin(PROVISIONAL_MESSAGE_RULES.maxSegments);
    expect(ceiling).toBe(306);
    // 66 septets against the 40 the fictional line cost.
    expect(calculateGsm7(AUTHORISED_CRISIS_LINE).septets).toBe(66);
    expect(calculateGsm7(SUPERSEDED_FICTIONAL_CRISIS_LINE).septets).toBe(40);
    // 247 -> 273 with the name slot empty, so the name budget falls 59 -> 33.
    expect(PATIENT_VISIBLE_MESSAGE_BASE_SEPTETS).toBe(273);
    expect(PREFERRED_NAME_MAX_SEPTETS).toBe(33);
    // Derived, not written down: the cap follows the base cost and the ceiling automatically.
    expect(PREFERRED_NAME_MAX_SEPTETS).toBe(ceiling - PATIENT_VISIBLE_MESSAGE_BASE_SEPTETS);
    // Ample for a first name, which is the whole claim the budget has to support.
    expect(
      resolvePatientVisibleMessage("Rowan", { syntheticFictionalContactsAcknowledged: true as const }),
    ).toMatchObject({ ok: true });
    expect(
      resolvePatientVisibleMessage("Christopher", { syntheticFictionalContactsAcknowledged: true as const }),
    ).toMatchObject({ ok: true });
  });

  it("keeps both messages identifiable as non-sendable specimens", () => {
    // The concern with removing the fictional crisis line is that a message stops announcing
    // itself as fake. It does not: the fictional STAFFED line remains in both, so the marker
    // pattern still fires. Proven by running the pattern, not by reasoning about it.
    for (const text of [EXACT_PATIENT_VISIBLE_MESSAGE, AUTOMATED_REPLY_RESPONSE]) {
      expect(text).toContain(FICTIONAL_CONTACTS_BY_ROLE.programmeStaffedLine);
      expect(PROVISIONAL_MESSAGE_RULES.fictionalContactMarkerPattern.test(text)).toBe(true);
    }
    // Negative control on the same pattern: the real crisis sentence alone is NOT marked as
    // fictional, which is what stops a live crisis number being filed as a fake one.
    expect(PROVISIONAL_MESSAGE_RULES.fictionalContactMarkerPattern.test(AUTHORISED_CRISIS_LINE)).toBe(false);
  });
});
