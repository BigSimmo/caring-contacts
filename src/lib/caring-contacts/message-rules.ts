// PROVISIONAL — NOT CLINICALLY APPROVED.
// Seeded 2026-08-19 from the decision lock's prohibited concepts, the existing prototype message
// constants, and the two-segment GSM-7 limit. Replace this file wholesale when the clinical programme
// lead and lived-experience representative approve the real content style guide. Do not edit
// message-policy.ts to accommodate a rule change — the mechanism is stable, the rules are data.
//
// ONE VALUE IN HERE IS NOT PROVISIONAL: `CRISIS_SUPPORT_CONTACT` carries wording the owner
// authorised himself (Ruling [144], 2026-08-27) and names real crisis services. A wholesale
// replacement of this file is still the approval gate's to make, but nobody in this programme may
// reword that sentence on their own — see the comment above the constant.
import { DESIGNATED_FICTIONAL_MOBILE_NUMBERS } from "./synthetic-contacts";

/** Escapes `value` for literal use inside a `RegExp` source string. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type ProvisionalMessageRules = {
  /** Above this many GSM-7 segments, a message fails exceeds-two-segments. */
  maxSegments: number;
  /** Case-insensitive terms that must never appear in an outgoing message. */
  prohibitedTerms: readonly string[];
  /** Identifies the programme; required in first and closing messages. */
  programmeLine: string;
  /** The staffed line's operating hours; required in first messages. */
  operatingHours: string;
  /** Tells the recipient what to do in an emergency; required in first messages. */
  emergencyDirection: string;
  /**
   * The one crisis-support contact; required in first and closing messages.
   *
   * Since Ruling [144] (owner-authorised 2026-08-27) this is a REAL, LIVE crisis service rather
   * than a reserved fictional number, so it is the one value in this record that must never be
   * added to `synthetic-contacts.ts` and must never match `fictionalContactMarkerPattern`. It is
   * the whole sentence, final full stop included, because that is the form the owner authorised.
   */
  crisisSupportContact: string;
  /**
   * Identifies a reserved fictional contact detail inside a message. NOT in `prohibitedTerms` --
   * Ruling 79 (item A1, 2026-08-24): both approved patient-visible messages still name a reserved
   * fictional number, so a bare prohibition on this text would make every existing message
   * invalid. message-policy.ts instead reports `fictional-contact-detail-present` whenever a
   * message matches this pattern, unless the caller explicitly acknowledges the number is
   * synthetic. See task-c-brief.md, "A1".
   *
   * Ruling [144] (2026-08-27) changed WHICH number carries that marker, and the distinction is
   * load-bearing. This used to overlap `crisisSupportContact`, which was itself fictional; the
   * crisis contact is now a real service and no longer matches this pattern at all. What still
   * makes both patient-visible messages match is the fictional STAFFED line they both name. That
   * is the property keeping a specimen identifiable as non-sendable, so it is asserted rather
   * than assumed -- see caring-contacts-message-copy.test.ts, "Ruling [144]".
   *
   * Fix round 1 (promoted finding, 2026-08-24): the first version was `crisisSupportContact.
   * split(":")[0]` -- the LABEL "Fictional Support Line" only. A message carrying the reserved
   * NUMBER with no label raised nothing, which is precisely the shape that would reach a real
   * sender: the number is the dangerous artefact, not the label. This is now a pattern matching
   * "Fictional" (any case) OR any one of `synthetic-contacts.ts`'s reserved fictional numbers, so
   * relabelling ("Fictional Support Line (24h): …"), reordering ("… (Fictional Support Line)"),
   * or dropping the label entirely (just the bare number) are all still caught -- either half of
   * the pair alone is sufficient.
   */
  fictionalContactMarkerPattern: RegExp;
  /**
   * Per-term overrides for how a `prohibitedTerms` entry is matched, keyed by the exact term
   * string. A term with no entry here keeps the default plain-substring match. B2 (2026-08-24):
   * "lead" is the only entry -- `lowerText.includes("lead")` also matched the ordinary English
   * "the incident lead" / "the clinical programme lead" (job titles in the service-stop wording).
   * This is deliberately NOT extended to the rest of the list: several other terms are multi-word
   * phrases whose substring behaviour is intentional.
   *
   * Fix round 1: the first version of this override ALLOWLISTED nine commercial
   * modifiers/companions ("sales lead", "lead generation", ...). Commercial vocabulary for "lead"
   * is open-ended, so that allowlist was itself a defect -- "lead nurturing", "lead magnet",
   * "qualify this lead" and similar phrasing all passed silently. The current version inverts
   * this: it refuses "lead"/"leads" as a whole word BY DEFAULT, and exempts only the closed,
   * small set of job titles this domain's own wording ever uses.
   *
   * Ruling [143] (2026-08-27): the same rule is also defined for INTERFACE copy, in
   * `tests/helpers/caring-contacts-prohibited-language.ts`, and that definition was the stricter of
   * the two. A message a discharged patient reads was permitting seven phrases a clinician's screen
   * refused -- the plural was exempted outright, and with no commercial-phrase list any exempting
   * word immediately before "lead" licensed whatever followed it. The pattern below now mirrors the
   * interface definition's three "lead" alternatives, so the surface with the worse consequence is
   * no longer the looser one. Nothing in `src/lib/caring-contacts/**` may import a test helper, so
   * the two definitions stay separate by necessity; what holds them in step is the parity block in
   * `tests/caring-contacts-interface-vocabulary.test.ts`, which fails on any phrase the screen
   * refuses and a message would permit. Change one definition and run that. See task-c-brief.md, "B2", and
   * task-c-report.md's "fix round 1" section.
   */
  prohibitedTermPatternOverrides: Readonly<Partial<Record<string, RegExp>>>;
  /** States that the message is the last one the recipient will receive. */
  closingStatement: string;
};

// Ruling [144], owner-authorised 2026-08-27. This replaced `"Fictional Support Line: +61 491 570
// 158"` -- a patient in a suicide-prevention programme was reading the literal words "Fictional
// Support Line" before a number that connects to nobody.
//
// THE WORDING IS THE OWNER'S OWN, NOT THIS PROGRAMME'S. The standing rule that nobody here may
// author patient-visible message wording is unchanged; this is a single named exception. He was
// shown this exact sentence and the resulting message in full, confirmed both numbers, and
// authorised it in writing twice. Do not reword, extend, retitle or "improve" it, and do not treat
// it as a precedent for any other string. If you believe it is wrong, stop and report.
//
// Three things about its shape are deliberate: "If you need to talk" separates it from the
// `In an emergency call 000.` sentence immediately before it, which is the right answer for an
// emergency in progress and the wrong one for someone distressed and not in immediate danger;
// "any time" contrasts with the staffed line's `9 am-6 pm` two sentences earlier; and 13YARN is
// offered universally rather than conditionally, so this system never has to hold or act on a
// patient's cultural identity in order to offer a culturally appropriate service.
//
// IT IS A REAL, LIVE SERVICE. It must never be added to `synthetic-contacts.ts`, never appear in
// `DESIGNATED_FICTIONAL_MOBILE_NUMBERS`, and never match `fictionalContactMarkerPattern` -- filing
// a working crisis number among the numbers this system marks as fake is the failure Ruling [144]
// exists to prevent. The trailing full stop is part of the authorised sentence and part of what
// `message-policy.ts` requires a first or closing message to contain.
const CRISIS_SUPPORT_CONTACT = "If you need to talk, Lifeline 13 11 14, any time. 13YARN 13 92 76.";

// A1, fix round 1: "Fictional" (label, any case) OR any reserved fictional number from
// synthetic-contacts.ts. Either half alone is sufficient, so relabelling the crisis contact,
// reordering it, or dropping the label and keeping only the bare number are all still caught.
const FICTIONAL_CONTACT_MARKER_PATTERN = new RegExp(
  ["Fictional", ...DESIGNATED_FICTIONAL_MOBILE_NUMBERS.map(escapeRegExp)].join("|"),
  "i",
);

// B2, fix round 1: refuses "lead"/"leads" as a whole word BY DEFAULT (a negative lookbehind, not
// an allowlist of commercial phrasing), exempting only this domain's closed set of job titles --
// "incident lead", "programme lead", "clinical lead", "team lead", "service lead". A job title is
// exempted only when the qualifying word sits IMMEDIATELY before "lead" (so "clinical programme
// lead" is still exempt: "programme lead" is the qualifying pair actually adjacent to the word),
// never merely because one of those words appears anywhere earlier in the message.
//
// RULING [143], 2026-08-27: three alternatives now, because the interface definition in
// `tests/helpers/caring-contacts-prohibited-language.ts` was the stricter of the two and this is the
// surface a discharged patient reads. The two were term for term identical from that date until
// 2026-09-02; they are not any more, and alternative (1) is where they part.
//
// DO NOT "TIDY" THIS PATTERN BACK INTO STEP WITH THE INTERFACE ONE. On 2026-09-02, after #AGRAKQ,
// the owner extended the job-title exemption to the plural ON THE SCREEN ONLY, so a clinician may
// write "the clinical leads met on Tuesday" and a message to a discharged patient still may not.
// The message side is now deliberately the stricter of the two, which is the safe direction and the
// whole reason the change was taken on one surface rather than both. Copying the interface
// definition's plural branches down here would loosen the wording a patient receives, which nothing
// asked for; the parity block in `tests/caring-contacts-interface-vocabulary.test.ts` asserts this
// side still refuses each plural job title and will go red if you do it. The parity INVARIANT is
// unaffected and still holds: it forbids a message permitting what the screen refuses, and a screen
// permitting what a message refuses is the direction it deliberately allows.
//
//   1. `leads` (plural) is refused OUTRIGHT here, with no job-title exemption. The single pattern
//      this replaced put `leads?` behind the lookbehind, so "team leads", "clinical leads",
//      "programme leads", "service leads" and "incident leads" all read as job titles and were
//      permitted in a patient's message while the screen refused them. The reasoning recorded in
//      2026-08-27 was "nobody's title is plural" -- true of one person's title, false of a group of
//      them, which is what #AGRAKQ established and what the screen-side change above answers. It is
//      still the right rule HERE: no approved patient-visible message names a role at all, so the
//      exemption buys this surface nothing and costs it the whole plural commercial family
//      ("capture clinical leads", "unconverted service leads") that a preceding-verb construction
//      puts beyond the reach of the companion list in (2).
//   2. "lead" followed by a commercial companion word is refused even when an exempting word sits
//      immediately before it, which is what "clinical lead capture" and "team lead nurturing
//      numbers" exploited: the exemption licensed whatever followed the word it exempted.
//   3. Otherwise "lead" as a whole word, exempt only after one of the five job-title qualifiers.
//
// The companion list in (2) is NOT an allowlist returning by the back door -- refusal is still the
// default from (1) and (3), and (2) only removes an exemption that (3) would otherwise grant.
const COMMERCIAL_LEAD_PATTERN =
  /\bleads\b|\blead\s+(?:generation|capture|gen\b|nurturing|magnet|source|score|scoring|pipeline|qualification|conversion|database|numbers)\b|(?<!\b(?:incident|programme|clinical|service|team) )\blead\b/i;

export const PROVISIONAL_MESSAGE_RULES: ProvisionalMessageRules = Object.freeze({
  maxSegments: 2,
  prohibitedTerms: Object.freeze([
    "high risk",
    "safe",
    "engagement score",
    "campaign",
    "lead",
    "conversion",
    "best match",
    "inbox",
    "conversation",
  ]),
  programmeLine: "Example Aftercare Team is thinking of you",
  operatingHours: "9 am-6 pm",
  emergencyDirection: "In an emergency call 000",
  crisisSupportContact: CRISIS_SUPPORT_CONTACT,
  fictionalContactMarkerPattern: FICTIONAL_CONTACT_MARKER_PATTERN,
  prohibitedTermPatternOverrides: Object.freeze({
    lead: COMMERCIAL_LEAD_PATTERN,
  }),
  closingStatement: "This is the final message in this programme",
});
