import {
  calculateGsm7,
  maxSeptetsWithin,
  validateGovernedMessage,
  type Gsm7Evidence,
  type MessageValidationIssue,
} from "./message-policy";
import type { ContactState, MessageType, PlanState } from "./model";
import { PROVISIONAL_MESSAGE_RULES } from "./message-rules";
import { FICTIONAL_CONTACTS_BY_ROLE } from "./synthetic-contacts";

// PROVISIONAL — not clinically approved. Corrected 2026-08-19 under production-build spec §2.1, which
// replaced the non-receiving sender with a receiving-capable number that auto-responds and discards.
// The previous wording ("Replies are not received, stored, analysed or monitored") became untrue the
// moment the number could receive: replies ARE received, then discarded unread. Stating something false
// about a safety boundary is the failure this programme can least afford, so the claim now describes only
// what remains true — that nobody reads them. Final wording is a clinical decision owned by the
// lived-experience and clinical-programme approval gate (docs/caring-contacts/message-review-pack.md §1).
export const PATIENT_VISIBLE_NO_REPLY_NOTICE = "No one reads replies to this number";

/**
 * The patient-visible message, with the recipient's preferred name substituted into it.
 *
 * PROVISIONAL — not clinically approved. Ruling [127] called this string a SPECIMEN rather than a
 * template, on the ground that it carried a hardcoded name and had no slot. The owner decided on
 * 2026-08-26 that it should have one, so it is a template now. Final wording is still owned by the
 * lived-experience and clinical-programme approval gate (docs/caring-contacts/message-review-pack.md
 * §1), and adding a slot to a draft is not authoring one.
 *
 * TWO CHANGES HAVE BEEN MADE TO THIS TEXT SINCE, BOTH BY THE OWNER AND NEITHER BY THIS PROGRAMME.
 * The name became a slot (above), and on 2026-08-27 the closing sentence became the real crisis
 * services — `PROVISIONAL_MESSAGE_RULES.crisisSupportContact`, whose exact wording the owner
 * authorised in writing (Ruling [144]). It is interpolated from the rule rather than retyped here,
 * so the sentence a patient reads and the sentence `message-policy.ts` requires cannot drift apart;
 * two hand-maintained copies of a crisis-support sentence is precisely how one of them ends up
 * carrying a wrong number. The independent copy of the owner's words lives in
 * caring-contacts-message-copy.test.ts, where a reword reddens a test instead of being copied.
 *
 * The rule's value ends in its own full stop, so nothing follows it here but the sign-off.
 *
 * `preferredName` IS WHAT THE CLINICIAN WAS TOLD TO CALL THIS PERSON, ASKED FOR AS ITS OWN FIELD.
 * It is never derived from the stored `patientName`, here or anywhere else, and no code in this
 * task splits a name on anything. `patientName` is one free-text box: splitting it at the first
 * space greets a person with one name by their only name, a person whose family name is written
 * first by their surname, `Mr John Smith` as "Mr", and someone with two given names by half of
 * them. A suicide-prevention message that opens with a surname or a title is worse than one that
 * opens with no name at all, and the clinician is the person actually talking to the patient.
 */
function personalisedPatientVisibleMessage(preferredName: string): string {
  return `Hi ${preferredName}, Alex from Example Aftercare Team is thinking of you. This is a one-way message. ${PATIENT_VISIBLE_NO_REPLY_NOTICE}. For timing changes call ${FICTIONAL_CONTACTS_BY_ROLE.programmeStaffedLine}, 9 am-6 pm. In an emergency call 000. ${PROVISIONAL_MESSAGE_RULES.crisisSupportContact} - Alex`;
}

/**
 * The fictional first name every specimen of this message is shown with. One of this prototype's
 * own reserved fictional people (see `synthetic-contacts.ts`), never a real one.
 */
export const SPECIMEN_PREFERRED_NAME = "Rowan";

/**
 * The message as the mockups and the review pack show it: the template above with the fictional
 * specimen name in the slot. Byte-identical to the constant that stood here before the slot
 * existed, which is what makes the reversal narrow rather than a wording change in disguise.
 */
export const EXACT_PATIENT_VISIBLE_MESSAGE = personalisedPatientVisibleMessage(SPECIMEN_PREFERRED_NAME);

/**
 * What the message costs with the slot empty — every septet that is NOT the preferred name.
 *
 * Derived rather than written down, and the derivation is exact rather than approximate: GSM-7
 * septet cost is per character and additive, so substituting a name of `n` septets produces a
 * message of `PATIENT_VISIBLE_MESSAGE_BASE_SEPTETS + n`. That is the whole basis of the bound
 * below, and it is why the bound can be stated for every accepted name rather than sampled.
 */
export const PATIENT_VISIBLE_MESSAGE_BASE_SEPTETS = calculateGsm7(personalisedPatientVisibleMessage("")).septets;

/**
 * The largest septet cost a preferred name may have and still leave the message inside its approved
 * segment ceiling.
 *
 * COMPUTED FROM THE CONSTANTS, NEVER WRITTEN AS A LITERAL, and that is not tidiness. The wording is
 * PROVISIONAL and the approval gate is expected to change it; a literal cap would be right only
 * until it did, and would then be silently wrong in whichever direction the wording moved — a
 * shorter message would refuse names it could carry, and a longer one would accept names that push
 * the message to a third segment. `maxSeptetsWithin` and `PROVISIONAL_MESSAGE_RULES.maxSegments`
 * both move with their own owners, so this number moves with them.
 *
 * A NOTE IN THIS FILE USED TO SAY THE MESSAGE HAD "no room left". Read in its own context it meant
 * no room for one specific extra sentence someone wanted to add; it did not mean no room at all.
 * The sentence has been rewritten below so the next reader does not inherit the wider claim.
 */
export const PREFERRED_NAME_MAX_SEPTETS = preferredNameMaxSeptets(personalisedPatientVisibleMessage(""));

/**
 * The cap for ANY message text a preferred name is substituted into, given that text with its slot
 * empty.
 *
 * `PREFERRED_NAME_MAX_SEPTETS` above is this rule applied to the one template this module owns.
 * The rule is exposed separately because that template is not the only text a preferred name may
 * one day be substituted into: a pathway version carries its own `messageTextByType`, and the demo
 * corpus stores a copy of the current wording there. A cap derived from THIS template does not bound
 * a different string, and a second cap computed a second way is how two answers to one question come
 * to disagree. Whatever text is actually substituted, ask this.
 *
 * `unpersonalisedText` is the text with the slot EMPTY, not with a name in it. GSM-7 septet cost is
 * per character and additive, so a name of `n` septets makes the message `septets(unpersonalisedText)
 * + n` — which is why the bound holds for every accepted name rather than for a sampled few.
 *
 * A text already at or past the ceiling yields a cap of zero or less, and every name is then refused
 * as too long. That is the honest answer: such a text has no room for a name, and this returns the
 * arithmetic rather than a floor that would let one in.
 */
export function preferredNameMaxSeptets(unpersonalisedText: string): number {
  return maxSeptetsWithin(PROVISIONAL_MESSAGE_RULES.maxSegments) - calculateGsm7(unpersonalisedText).septets;
}

export type PatientVisibleMessageIssue =
  | { code: "preferred-name-not-recorded" }
  | { code: "preferred-name-too-long"; septets: number; maxSeptets: number }
  | { code: "preferred-name-not-sendable"; unsupportedCharacters: string[] }
  | MessageValidationIssue;

export type PatientVisibleMessageResolution =
  { ok: true; text: string } | { ok: false; issue: PatientVisibleMessageIssue };

/**
 * The message this plan would send, or a named refusal saying why there is none.
 *
 * WHY A REFUSAL RATHER THAN AN UNPERSONALISED FALLBACK, and it is the same argument
 * `resolveClosingContactMessageBody` in ./message-policy makes for the closing message. No
 * no-name wording has ever been written. Producing one here — "Hi, Alex from …", or dropping the
 * greeting — would be ME drafting patient-visible copy for a suicide-prevention message, which is
 * the one thing an implementer in this programme may never do. So a plan with no preferred name
 * recorded has nothing to send, and the only acceptable answer to that is a loud, identifiable
 * refusal: never an empty greeting, never a silent fall-back, never a quietly skipped contact.
 *
 * THE THIRD REFUSAL IS A TRANSPORT FACT, NOT A CLINICAL ONE, and it is the one decision here that
 * goes beyond what was asked for — recorded plainly so it can be overturned.
 *
 * WHAT IS DEMONSTRABLE. A name carrying a character outside GSM-7 (`Zoë`, `Aroha-Lī`) makes
 * `calculateGsm7` report `{ valid: false, segments: 0 }` for the WHOLE message. `validateGovernedMessage`
 * checks the segment ceiling only `if (gsm7.valid)`, and `MessageValidationIssue` has no
 * invalid-characters code at all — so such a message is reported VALID by this domain with the
 * ceiling never evaluated. **The failure is not corruption; it is that the two-segment ceiling
 * silently stops being enforced**, and length is the only thing being checked there.
 *
 * WHAT IS NOT KNOWN, AND AN EARLIER VERSION OF THIS NOTE CLAIMED IT WAS. It said such a message
 * would "reach a sender mangled". A real SMS gateway normally re-encodes a non-GSM-7 message to
 * UCS-2 and delivers it INTACT — at 70 characters per segment, 67 concatenated, which would turn
 * this 252-septet message into roughly four. Nothing in this domain models a UCS-2 path, so within
 * this system the message genuinely is unencodable; outside it, the likely outcome is an
 * over-length delivery rather than a damaged one. Refusing is still the conservative answer, and
 * the reason is the unenforced ceiling rather than a corruption nobody here has observed.
 *
 * The refusal names the offending characters and sends the clinician back to the person to ask how
 * they would like their name spelled — never to a spelling the clinician picks. It refuses a value
 * the TRANSPORT cannot carry, which is the same class as refusing one that is too long, and no part
 * of it decides anything about the patient.
 */
export function resolvePatientVisibleMessage(
  preferredName: string | null,
  options?: { syntheticFictionalContactsAcknowledged?: boolean },
): PatientVisibleMessageResolution {
  const name = (preferredName ?? "").trim();
  if (name === "") return { ok: false, issue: { code: "preferred-name-not-recorded" } };

  const nameEvidence = calculateGsm7(name);
  if (!nameEvidence.valid) {
    return {
      ok: false,
      issue: { code: "preferred-name-not-sendable", unsupportedCharacters: [...nameEvidence.invalidCharacters] },
    };
  }
  if (nameEvidence.septets > PREFERRED_NAME_MAX_SEPTETS) {
    return {
      ok: false,
      issue: {
        code: "preferred-name-too-long",
        septets: nameEvidence.septets,
        maxSeptets: PREFERRED_NAME_MAX_SEPTETS,
      },
    };
  }

  const text = personalisedPatientVisibleMessage(name);
  const validation = validateGovernedMessage({
    text,
    messageType: "standard",
    syntheticFictionalContactsAcknowledged: options?.syntheticFictionalContactsAcknowledged ?? false,
  });
  if (!validation.valid) {
    return { ok: false, issue: validation.issues[0] };
  }

  return { ok: true, text };
}

// PROVISIONAL — not clinically approved. Required by production-build spec §2.1: the automated response
// sent to anyone who replies. It must name where a person IS available, immediately after saying that
// nobody reads this channel, so that reaching out is answered rather than met with silence.
//
// Content is INTENDED to be discarded after this response is sent -- nothing stored, counted per
// patient, or shown to staff -- as a requirement on whatever sender is eventually built. This is a
// design contract, not a claim about current system behaviour: exactly as the next paragraph notes,
// there is no telephony provider yet to make it true or false, so do not read this line as evidence
// that anything is presently being discarded. Fixed round 1 (Minor 6, 2026-08-24): this line used to
// read as a settled operational fact, which is precisely the kind of unverifiable storage claim A2
// removed from the patient-visible text below -- reworded here so the module's own rationale does
// not silently reintroduce it.
//
// Corrected 2026-08-24 under the owner's approved copy decisions (items A2 + A3, see
// docs/caring-contacts/phase-2b-sdd-archive/task-c-brief.md). Two defects, fixed together because
// they are one sentence: A2 -- "has not been seen by anyone and has not been kept" was a firm claim
// about storage, made to a person in distress, about a system with no telephony provider yet, so
// nobody could currently know whether it was true. The replacement says only what this system can
// actually know: who is not reading. A3 -- a patient told "no one reads replies" who then receives
// this very message could reasonably conclude somebody read theirs first. "and this reply is
// automatic" closes that. EXACT_PATIENT_VISIBLE_MESSAGE did not receive THAT SENTENCE and still
// does not: it sits close enough to the 2-segment ceiling that adding it would leave almost nothing
// for the preferred-name slot, so the fact lives only here, where there is room. (Scope that claim
// to the A2/A3 sentence: the message above WAS changed later, by Ruling [144] below.)
//
// CORRECTED 2026-08-26: this used to read "with no room left", which a later reader (and the
// controller) took as meaning the message had no headroom at all. It never meant that. The
// remaining headroom is `PREFERRED_NAME_MAX_SEPTETS` above, and it is what the preferred-name slot
// is spent on -- see caring-contacts-message-copy.test.ts, which proves the bound rather than
// restating a number.
//
// RULING [144], owner-authorised 2026-08-27: the fictional crisis line was replaced here as well as
// in the message above, and deliberately so. This is what a person gets when they reply -- plausibly
// a moment of greater need than the scheduled message -- so it is the last place a crisis number
// that connects to nobody should survive. This string has no name slot, so its whole budget is its
// own: re-measured rather than inherited from Message A, and pinned in
// caring-contacts-message-copy.test.ts. The sentence is interpolated from
// `PROVISIONAL_MESSAGE_RULES.crisisSupportContact` for the same reason as above -- one copy of the
// owner's words in `src/`, so the two messages cannot come to carry different crisis numbers.
export const AUTOMATED_REPLY_RESPONSE = `No one at Example Aftercare Team reads this number, and this reply is automatic. To talk to someone, call ${FICTIONAL_CONTACTS_BY_ROLE.programmeStaffedLine}, 9 am-6 pm every day. In an emergency call 000. ${PROVISIONAL_MESSAGE_RULES.crisisSupportContact}`;

export const EXACT_MESSAGE_GSM7: Gsm7Evidence = calculateGsm7(EXACT_PATIENT_VISIBLE_MESSAGE);
export const AUTOMATED_REPLY_GSM7: Gsm7Evidence = calculateGsm7(AUTOMATED_REPLY_RESPONSE);

/**
 * The approval status of the patient-visible wording in this module, in words a CLINICIAN reads.
 *
 * NOT PATIENT-VISIBLE. Nothing in this sentence is ever sent to anybody; it is governance chrome,
 * and it lives here rather than in a screen for the reason Ruling [131] was written. Round 1 of
 * Task 16 shipped a screen sentence claiming the opposite -- that the one patient-visible message
 * "has been approved" -- rendered directly beneath the two approval seats, where a clinician would
 * read those seats as having signed off the words a discharged patient receives. They have not:
 * the two constants above open with `PROVISIONAL -- not clinically approved`, and the decision
 * belongs to the approval gate named there.
 *
 * A screen that retyped this status would put the eventual answer in two places, and the copy on
 * the screen would go on saying "provisional" after the gate had decided. So the status is read
 * from beside the words it is about: change it here when the gate decides, and every screen
 * showing the wording changes with it.
 *
 * WHAT IT SEPARATES, and the distinction the deleted sentence collapsed: a pathway version's dual
 * approval is an approval of the VERSION -- its cadence, its lifecycle, the governance record --
 * and nothing anywhere in this system has approved the wording.
 */
export const CLINICIAN_FACING_WORDING_APPROVAL_STATUS =
  "This wording is provisional and has not been clinically approved. Whether it may be sent to a patient is a clinical decision owned by the lived-experience and clinical-programme approval gate, and that gate has not made it. A pathway version's recorded approvals approve the version, not these words.";

/**
 * The slot a pathway version's stored wording carries where the patient's preferred name goes.
 *
 * WHY A SLOT IN THE STORED TEXT. A pathway version stores whole strings (`messageTextByType`), and
 * until 2026-09-26 the demo pathway stored the specimen above with the fictional name already in it
 * -- "Hi Rowan, Alex from ..." -- so every patient on that pathway would have been greeted as Rowan.
 * The stored wording now carries this token instead, and `renderGovernedMessage` below puts each
 * patient's OWN recorded preferred name into it at send time. The token is not patient-visible:
 * rendering refuses to return any text that still contains it.
 */
export const PREFERRED_NAME_PLACEHOLDER = "{preferredName}";

/**
 * The standard message as a pathway version stores it: the same provisional wording as
 * `EXACT_PATIENT_VISIBLE_MESSAGE`, with the preferred-name slot left as `PREFERRED_NAME_PLACEHOLDER`
 * rather than filled with the specimen name. No other character differs.
 */
export const PATIENT_VISIBLE_MESSAGE_TEMPLATE = personalisedPatientVisibleMessage(PREFERRED_NAME_PLACEHOLDER);

export type RenderGovernedMessageInput = {
  /** The pathway version's stored wording for this message type; blank or absent means none was written. */
  template: string | undefined;
  messageType: MessageType;
  /** What the clinician recorded as the name to use. Never derived from the full name. */
  preferredName: string | null;
  planState?: PlanState;
  contactState?: ContactState;
  patientMobileNumber?: string;
  /** Only a sender that cannot reach a real phone (the simulated transport) may pass true. */
  syntheticFictionalContactsAcknowledged?: boolean;
};

/**
 * The exact text one patient would receive for one contact, or a named refusal.
 *
 * The same discipline as `resolvePatientVisibleMessage` above, applied to a pathway version's own
 * stored wording rather than to this module's template: no wording means no message (never a
 * fallback), a missing or unsendable preferred name refuses rather than greeting nobody, and the
 * finished text must pass `validateGovernedMessage` -- the one chokepoint every sender goes through.
 */
export function renderGovernedMessage(input: RenderGovernedMessageInput): PatientVisibleMessageResolution {
  const template = input.template ?? "";
  const validate = (text: string | undefined): PatientVisibleMessageResolution => {
    const validation = validateGovernedMessage({
      text,
      messageType: input.messageType,
      planState: input.planState,
      contactState: input.contactState,
      patientMobileNumber: input.patientMobileNumber,
      syntheticFictionalContactsAcknowledged: input.syntheticFictionalContactsAcknowledged ?? false,
    });
    if (!validation.valid) return { ok: false, issue: validation.issues[0] };
    if (text === undefined) return { ok: false, issue: { code: "message-body-not-authored" } };
    return { ok: true, text };
  };

  if (template.trim() === "") return validate(undefined);

  const slots = template.split(PREFERRED_NAME_PLACEHOLDER).length - 1;
  if (slots === 0) return validate(template);

  const name = (input.preferredName ?? "").trim();
  if (name === "") return { ok: false, issue: { code: "preferred-name-not-recorded" } };
  const nameEvidence = calculateGsm7(name);
  if (!nameEvidence.valid) {
    return {
      ok: false,
      issue: { code: "preferred-name-not-sendable", unsupportedCharacters: [...nameEvidence.invalidCharacters] },
    };
  }
  const maxSeptets = Math.floor(preferredNameMaxSeptets(template.split(PREFERRED_NAME_PLACEHOLDER).join("")) / slots);
  if (nameEvidence.septets > maxSeptets) {
    return { ok: false, issue: { code: "preferred-name-too-long", septets: nameEvidence.septets, maxSeptets } };
  }
  return validate(template.split(PREFERRED_NAME_PLACEHOLDER).join(name));
}

// ---------------------------------------------------------------------------------------------
// Incoming text messages: the automatic reply (added 2026-09-26, owner request)
// ---------------------------------------------------------------------------------------------

/**
 * The fixed text sent back to ANYONE who texts this service's number -- a known patient, a number
 * this service has never held, or another automatic responder. Sent by the inbound webhook
 * (`./inbound-receiver.ts`) through the configured message transport, at most once per sending
 * number per `INBOUND_AUTO_REPLY_WINDOW_MS` (see `./inbound-replies.ts`).
 *
 * PROVISIONAL — NOT CLINICALLY APPROVED. NEEDS CLINICAL SIGN-OFF BEFORE ANY REAL-PATIENT USE. The
 * owner asked for "this number isn't monitored, call 000, Lifeline or the Mental Health Emergency
 * Response Line"; the sentence below is an implementer's draft of that request, listed for the
 * approval gate in docs/caring-contacts/message-review-pack.md ("Message C"). This is the ONE place
 * it lives: nothing else in `src/` retypes it, and a reword happens here or nowhere.
 *
 * WHY IT IS NOT `AUTOMATED_REPLY_RESPONSE` ABOVE. That specimen (review pack "Message B") is still
 * what the Templates screen and the prototypes show, and it could not be sent as it stands, for two
 * reasons that are facts rather than taste:
 *   * it names this prototype's reserved FICTIONAL staffed line, which connects to nobody -- the
 *     governed-message check refuses it for any transport that can reach a real phone;
 *   * it says "No one at Example Aftercare Team reads this number", and since this change a reply
 *     from a known patient IS shown to the team as a "reply to check" so a person can follow it up.
 *     That sentence is no longer true, and neither is `PATIENT_VISIBLE_NO_REPLY_NOTICE` ("No one reads
 *     replies to this number") inside the scheduled message. Both are governed wording this change
 *     does not reword; the review pack records the conflict for the approval gate to decide.
 * This text therefore claims only that the number is not MONITORED -- nobody is watching it, so a
 * reply may not be seen for some time -- which stays true whether or not a person later reads it.
 *
 * WHAT IS IN IT, AND WHY IT FITS ONE SMS. Exactly 160 GSM-7 characters, one segment (checked below
 * at load time, so a reword that spills into a second segment stops the build). Every number is a
 * real public service taken from the canonical record, docs/caring-contacts-crisis-lines.md: 000,
 * Lifeline 13 11 14 (the same number as the owner's own crisis-support sentence), and the Mental
 * Health Emergency Response Line for Perth metro (1300 555 788) and Peel (1800 676 822).
 * tests/caring-contacts-inbound-replies.test.ts fails if any of them stops matching that record.
 * 13YARN and Rurallink are NOT in it: there was no room inside one segment, and which services a
 * one-segment reply names is a question for the approval gate, recorded in the review pack.
 *
 * IT MAKES NO PROMISE THE SYSTEM MIGHT NOT KEEP. The same wording goes to a STOP request as to any
 * other text. It does not say "your messages are paused" (a pause can fail, and an unknown number
 * has no plan to pause) or "someone will call you" (a follow-up is a person's decision). It asks no
 * question, so it does not invite a reply on a channel nobody watches (hazard H-C11).
 */
export const INBOUND_AUTO_REPLY_MESSAGE =
  "This number isn't monitored. For help now call 000, Lifeline 13 11 14, or the Mental Health Emergency Response Line 1300 555 788 (Perth) or 1800 676 822 (Peel).";

export const INBOUND_AUTO_REPLY_GSM7: Gsm7Evidence = calculateGsm7(INBOUND_AUTO_REPLY_MESSAGE);

// Load-time, and thrown rather than asserted in a test, for the reason `model.ts` checks its state
// classifications at load: a build whose automatic reply would be refused, or would cost two SMS,
// must not start.
{
  const checked = validateGovernedMessage({
    text: INBOUND_AUTO_REPLY_MESSAGE,
    messageType: "standard",
    syntheticFictionalContactsAcknowledged: false,
  });
  if (!checked.valid || !INBOUND_AUTO_REPLY_GSM7.valid || INBOUND_AUTO_REPLY_GSM7.segments !== 1) {
    throw new Error("caring-contacts message copy: the inbound automatic reply is not a valid one-segment message");
  }
}
