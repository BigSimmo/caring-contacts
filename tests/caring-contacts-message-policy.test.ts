// tests/caring-contacts-message-policy.test.ts
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AUTOMATED_REPLY_RESPONSE, EXACT_PATIENT_VISIBLE_MESSAGE } from "@/lib/caring-contacts/message-copy";
import { PROVISIONAL_MESSAGE_RULES } from "@/lib/caring-contacts/message-rules";
import {
  calculateGsm7,
  resolveClosingContactMessageBody,
  validateGovernedMessage,
  type GovernedMessageInput,
} from "@/lib/caring-contacts/message-policy";
import {
  DESIGNATED_FICTIONAL_MOBILE_NUMBERS,
  FICTIONAL_CONTACTS_BY_ROLE,
} from "@/lib/caring-contacts/synthetic-contacts";

const rules = PROVISIONAL_MESSAGE_RULES;

const compliantFirstMessage = [
  rules.programmeLine,
  rules.operatingHours,
  rules.emergencyDirection,
  rules.crisisSupportContact,
].join(". ");

const compliantClosingMessage = [rules.closingStatement, rules.programmeLine, rules.crisisSupportContact].join(". ");

// ---------------------------------------------------------------------------
// Rule 1 — calculateGsm7 septet counting and segmentation
// ---------------------------------------------------------------------------

describe("rule 1: calculateGsm7 septet counting and segmentation", () => {
  it("counts a basic-set message of exactly 252 septets as 2 segments", () => {
    const evidence = calculateGsm7("A".repeat(252));
    expect(evidence).toEqual({ valid: true, septets: 252, segments: 2, invalidCharacters: [] });
  });

  it("counts a basic-set message of exactly 218 septets as 2 segments", () => {
    const evidence = calculateGsm7("A".repeat(218));
    expect(evidence).toEqual({ valid: true, septets: 218, segments: 2, invalidCharacters: [] });
  });

  it("counts a basic-set message of exactly 272 septets as 2 segments", () => {
    const evidence = calculateGsm7("A".repeat(272));
    expect(evidence).toEqual({ valid: true, septets: 272, segments: 2, invalidCharacters: [] });
  });

  it("treats exactly 160 septets as a single segment", () => {
    const evidence = calculateGsm7("A".repeat(160));
    expect(evidence).toEqual({ valid: true, septets: 160, segments: 1, invalidCharacters: [] });
  });

  it("treats 161 septets as 2 segments", () => {
    const evidence = calculateGsm7("A".repeat(161));
    expect(evidence).toEqual({ valid: true, septets: 161, segments: 2, invalidCharacters: [] });
  });

  it("scores an extension character at 2 septets", () => {
    // A = 1 septet, ^ = 2 septets (extension set), B = 1 septet => 4 septets, 1 segment.
    const evidence = calculateGsm7("A^B");
    expect(evidence).toEqual({ valid: true, septets: 4, segments: 1, invalidCharacters: [] });
  });

  it("flags a character outside both the basic and extension sets as invalid", () => {
    const evidence = calculateGsm7("Hello 🙂");
    expect(evidence.valid).toBe(false);
    expect(evidence.segments).toBe(0);
    expect(evidence.invalidCharacters).toEqual(["🙂"]);
  });
});

// ---------------------------------------------------------------------------
// Rule 2 — a fully substituted message over two segments fails validation
// ---------------------------------------------------------------------------

describe("rule 2: exceeds-two-segments", () => {
  it("passes a standard message of exactly 252 septets (2 segments)", () => {
    const input: GovernedMessageInput = { text: "A".repeat(252), messageType: "standard" };
    expect(validateGovernedMessage(input)).toEqual({ valid: true });
  });

  it("fails a standard message of 307 septets, reporting the exact septet and segment count", () => {
    const input: GovernedMessageInput = { text: "A".repeat(307), messageType: "standard" };
    const result = validateGovernedMessage(input);
    expect(result).toEqual({
      valid: false,
      issues: [{ code: "exceeds-two-segments", septets: 307, segments: 3 }],
    });
  });
});

// ---------------------------------------------------------------------------
// Rule 3 — prohibited terms
// ---------------------------------------------------------------------------

describe("rule 3: prohibited-term", () => {
  it("fails and names the exact term when a seeded prohibited term is present", () => {
    const input: GovernedMessageInput = { text: "This is part of a campaign.", messageType: "standard" };
    const result = validateGovernedMessage(input);
    expect(result).toEqual({ valid: false, issues: [{ code: "prohibited-term", term: "campaign" }] });
  });

  it("reports every seeded prohibited term found in the message", () => {
    const input: GovernedMessageInput = {
      text: "Your engagement score improved after this campaign.",
      messageType: "standard",
    };
    const result = validateGovernedMessage(input);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("unreachable");
    expect(result.issues).toContainEqual({ code: "prohibited-term", term: "engagement score" });
    expect(result.issues).toContainEqual({ code: "prohibited-term", term: "campaign" });
  });

  it("passes a message that contains none of the seeded prohibited terms", () => {
    const input: GovernedMessageInput = { text: "Thinking of you today.", messageType: "standard" };
    expect(validateGovernedMessage(input)).toEqual({ valid: true });
  });

  it("seeds the prohibited term list from the Global Constraints vocabulary", () => {
    expect([...rules.prohibitedTerms].sort()).toEqual(
      [
        "high risk",
        "safe",
        "engagement score",
        "campaign",
        "lead",
        "conversion",
        "best match",
        "inbox",
        "conversation",
      ].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// Rule 3b — fictional-contact-detail-present (Ruling 79 / item A1, 2026-08-24)
//
// "Fictional" is deliberately NOT in prohibitedTerms: both approved patient-visible messages
// still name a reserved fictional number -- the STAFFED line -- so that would make every existing
// message invalid and the check would have to be disabled to ship, and a disabled check is worse
// than no check. Instead this issue is always reported unless the caller explicitly acknowledges
// the number is synthetic, so the day a real send path is built, someone must consciously pass a
// flag whose name says it is synthetic, or remove the fictional numbers. See
// docs/caring-contacts/phase-2b-sdd-archive/task-c-brief.md, "A1".
//
// UPDATED for Ruling [144] (2026-08-27). `rules.crisisSupportContact` used to BE the fictional
// crisis line, so these cases could use it as their fictional specimen. It is now the real
// Australian crisis services, which must NOT be marked as fictional -- so the specimen is taken
// straight from the reserved-number record, and the real crisis line gets its own negative case.
// ---------------------------------------------------------------------------

describe("rule 3b: fictional-contact-detail-present", () => {
  const fictionalCrisisLine = `Fictional Support Line: ${FICTIONAL_CONTACTS_BY_ROLE.crisisSupportContact}.`;

  it("fails with exactly that issue code when the fictional crisis contact is present and unacknowledged", () => {
    const input: GovernedMessageInput = { text: fictionalCrisisLine, messageType: "standard" };
    const result = validateGovernedMessage(input);
    expect(result).toEqual({ valid: false, issues: [{ code: "fictional-contact-detail-present" }] });
  });

  it("passes the same message when syntheticFictionalContactsAcknowledged is true", () => {
    const input: GovernedMessageInput = {
      text: fictionalCrisisLine,
      messageType: "standard",
      syntheticFictionalContactsAcknowledged: true,
    };
    expect(validateGovernedMessage(input)).toEqual({ valid: true });
  });

  it("does NOT mark the real crisis-support line as a fictional contact detail (Ruling [144])", () => {
    // The failure this guards is a live, real crisis number being filed among the numbers this
    // system marks as fake. The positive control is the case directly above: the same call, with
    // the fictional line, does raise the issue -- so this pass is the pattern discriminating
    // between the two rather than the check being inert.
    const input: GovernedMessageInput = { text: rules.crisisSupportContact, messageType: "standard" };
    expect(validateGovernedMessage(input)).toEqual({ valid: true });
    expect(rules.crisisSupportContact).toBe("If you need to talk, Lifeline 13 11 14, any time. 13YARN 13 92 76.");
  });

  it("does not raise the issue for a message with no fictional contact marker, acknowledged or not", () => {
    const plain: GovernedMessageInput = { text: "Thinking of you today.", messageType: "standard" };
    expect(validateGovernedMessage(plain)).toEqual({ valid: true });
    expect(validateGovernedMessage({ ...plain, syntheticFictionalContactsAcknowledged: true })).toEqual({
      valid: true,
    });
  });

  it("the two approved patient-visible messages pass once the fictional-contact acknowledgement is given", () => {
    // The prototype's real callers: both approved messages name the fictional numbers on purpose
    // (see message-copy.ts), so both must pass validateGovernedMessage only when the caller
    // explicitly acknowledges that -- never silently.
    for (const text of [EXACT_PATIENT_VISIBLE_MESSAGE, AUTOMATED_REPLY_RESPONSE]) {
      const unacknowledged = validateGovernedMessage({ text, messageType: "standard" });
      expect(unacknowledged.valid).toBe(false);
      if (unacknowledged.valid) throw new Error("unreachable");
      expect(unacknowledged.issues).toContainEqual({ code: "fictional-contact-detail-present" });

      expect(
        validateGovernedMessage({ text, messageType: "standard", syntheticFictionalContactsAcknowledged: true }).valid,
      ).toBe(true);
    }
  });

  // Fix round 1 (promoted finding): the original marker was `crisisSupportContact.split(":")[0]`,
  // i.e. the LABEL "Fictional Support Line" only. A message carrying the bare reserved NUMBER with
  // no label raised nothing -- exactly the shape that would reach a real sender. The marker is now
  // a pattern matching "Fictional" (any case) OR any reserved fictional number from
  // synthetic-contacts.ts, so either half alone is still caught.
  it("still refuses a relabelled crisis contact that keeps both 'Fictional' and the number", () => {
    const text = "Fictional Support Line (24h): +61 491 570 158";
    const result = validateGovernedMessage({ text, messageType: "standard" });
    expect(result).toEqual({ valid: false, issues: [{ code: "fictional-contact-detail-present" }] });
  });

  it("still refuses a reordered crisis contact with no colon after the label", () => {
    const text = "+61 491 570 158 (Fictional Support Line)";
    const result = validateGovernedMessage({ text, messageType: "standard" });
    expect(result).toEqual({ valid: false, issues: [{ code: "fictional-contact-detail-present" }] });
  });

  it("refuses the bare reserved number with the 'Fictional' label removed entirely -- the dangerous shape", () => {
    const text = "Call +61 491 570 158 for support.";
    const result = validateGovernedMessage({ text, messageType: "standard" });
    expect(result).toEqual({ valid: false, issues: [{ code: "fictional-contact-detail-present" }] });
  });

  it("refuses a message carrying any one of the four reserved fictional numbers, labelled or not", () => {
    for (const number of DESIGNATED_FICTIONAL_MOBILE_NUMBERS) {
      const result = validateGovernedMessage({ text: `Reach out on ${number}.`, messageType: "standard" });
      expect(result).toEqual({ valid: false, issues: [{ code: "fictional-contact-detail-present" }] });
    }
  });

  it("all of the above pass once acknowledged", () => {
    for (const text of [
      "Fictional Support Line (24h): +61 491 570 158",
      "+61 491 570 158 (Fictional Support Line)",
      "Call +61 491 570 158 for support.",
    ]) {
      expect(
        validateGovernedMessage({ text, messageType: "standard", syntheticFictionalContactsAcknowledged: true }),
      ).toEqual({ valid: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Rule 3c — B2 (2026-08-24, fix round 1): "lead" refuses by default, exempting only a closed
// set of job titles
//
// `lowerText.includes("lead")` also matches the ordinary English "the incident lead" and "the
// clinical programme lead" -- job titles that appear in the service-stop wording -- which would
// reject a message for using a word correctly.
//
// The FIRST version of this fix was itself defective: it allowlisted nine commercial
// modifiers/companions ("sales lead", "lead generation", ...), and commercial vocabulary is
// open-ended, so anything not on that list passed silently ("lead nurturing", "lead magnet",
// "qualify this lead", ...). Fix round 1 inverts it: "lead"/"leads" is refused by default (a
// whole-word match), and only the closed, small set of job titles this domain actually uses is
// exempted -- "incident lead", "programme lead", "clinical lead", "team lead", "service lead".
// That set is closed in a way commercial phrasing for "lead" never is.
//
// Only this one term is narrowed; every other prohibited term keeps its deliberate substring
// behaviour (several are multi-word phrases whose substring matching is intentional). See
// docs/caring-contacts/phase-2b-sdd-archive/task-c-brief.md, "B2", and task-c-report.md's
// "fix round 1" section.
// ---------------------------------------------------------------------------

describe('rule 3c: "lead" refuses by default, exempting only known job titles (B2)', () => {
  it("accepts every job title in the closed exemption set", () => {
    for (const text of [
      "Please contact the incident lead for an update.",
      "This was escalated to the programme lead.",
      "This was escalated to the clinical programme lead.",
      "Speak to the clinical lead about this.",
      "The team lead approved the change.",
      "Contact the service lead for details.",
    ]) {
      expect(validateGovernedMessage({ text, messageType: "standard" })).toEqual({ valid: true });
    }
  });

  it("rejects open-ended commercial/CRM phrasing that a fixed allowlist would have missed", () => {
    // Every one of these was newly PERMITTED by the fix-round-1 review's allowlist version of
    // this override -- none of them contain "sales", "marketing", "generation", "conversion", or
    // any of the other nine modifiers/companions that version enumerated.
    for (const text of [
      "We are focused on lead nurturing this quarter.",
      "Check out our new lead magnet.",
      "The lead source was social media.",
      "Update the leads database today.",
      "Our lead gen numbers are strong.",
      "Please qualify this lead.",
      "Please convert the lead.",
      "This lead is hot.",
      "Reach out to your lead.",
      // Still rejects the phrasings the original (allowlist) version DID catch, too.
      "Following up on your sales lead from last week.",
      "This campaign generated 50 new leads.",
      "Our lead generation numbers are up this quarter.",
      // "lead score" (no "g") -- the allowlist version's "scoring?" alternative matched
      // "scoring" but not "score", missing this exact phrase. Confirms the typo did not survive
      // the inversion: there is no companion-word list left to carry it.
      "This platform assigns a lead score to every contact.",
    ]) {
      const result = validateGovernedMessage({ text, messageType: "standard" });
      expect(result.valid).toBe(false);
      if (result.valid) throw new Error("unreachable");
      expect(result.issues).toContainEqual({ code: "prohibited-term", term: "lead" });
    }
  });

  it('pins the override map to exactly one entry -- "lead" -- so a future override for another term cannot land unnoticed', () => {
    expect(Object.keys(rules.prohibitedTermPatternOverrides)).toEqual(["lead"]);
  });

  it("leaves every OTHER prohibited term's substring behaviour exactly as it was", () => {
    // One case per term (excluding "lead", covered above), because narrowing one term is
    // precisely the change most likely to quietly widen what the rest of the list allows.
    const exampleTextByTerm: Record<string, string> = {
      "high risk": "This patient is at high risk today.",
      // "safe" as a substring of "unsafe" -- proves substring matching, not word-boundary matching.
      safe: "The unsafe practice was flagged.",
      "engagement score": "Your engagement score has changed.",
      campaign: "Part of a campaign this month.",
      // "conversion" as a substring of "reconversion" -- same proof.
      conversion: "The reconversion rate improved.",
      "best match": "This is the best match available.",
      inbox: "Check your inbox for updates.",
      conversation: "Let's have a conversation about this.",
    };
    for (const term of rules.prohibitedTerms) {
      if (term === "lead") continue; // deliberately narrowed above -- not part of this proof
      const text = exampleTextByTerm[term];
      if (text === undefined) {
        throw new Error(`no example text seeded for prohibited term ${JSON.stringify(term)} in this test`);
      }
      const result = validateGovernedMessage({ text, messageType: "standard" });
      expect(result.valid).toBe(false);
      if (result.valid) throw new Error("unreachable");
      expect(result.issues).toContainEqual({ code: "prohibited-term", term });
    }
  });
});

// ---------------------------------------------------------------------------
// Rule 4 — a first message must carry full support information
// ---------------------------------------------------------------------------

describe("rule 4: first-message-missing-support-information", () => {
  it("passes a first message that contains the programme line, hours, emergency direction, and a crisis contact", () => {
    const input: GovernedMessageInput = {
      text: compliantFirstMessage,
      messageType: "first",
      syntheticFictionalContactsAcknowledged: true,
    };
    expect(validateGovernedMessage(input)).toEqual({ valid: true });
  });

  it("fails when the programme line is missing", () => {
    const text = [rules.operatingHours, rules.emergencyDirection, rules.crisisSupportContact].join(". ");
    const result = validateGovernedMessage({
      text,
      messageType: "first",
      syntheticFictionalContactsAcknowledged: true,
    });
    expect(result).toEqual({ valid: false, issues: [{ code: "first-message-missing-support-information" }] });
  });

  it("fails when the hours are missing", () => {
    const text = [rules.programmeLine, rules.emergencyDirection, rules.crisisSupportContact].join(". ");
    const result = validateGovernedMessage({
      text,
      messageType: "first",
      syntheticFictionalContactsAcknowledged: true,
    });
    expect(result).toEqual({ valid: false, issues: [{ code: "first-message-missing-support-information" }] });
  });

  it("fails when the emergency direction is missing", () => {
    const text = [rules.programmeLine, rules.operatingHours, rules.crisisSupportContact].join(". ");
    const result = validateGovernedMessage({
      text,
      messageType: "first",
      syntheticFictionalContactsAcknowledged: true,
    });
    expect(result).toEqual({ valid: false, issues: [{ code: "first-message-missing-support-information" }] });
  });

  it("fails when the crisis-support contact is missing", () => {
    const text = [rules.programmeLine, rules.operatingHours, rules.emergencyDirection].join(". ");
    const result = validateGovernedMessage({ text, messageType: "first" });
    expect(result).toEqual({ valid: false, issues: [{ code: "first-message-missing-support-information" }] });
  });

  it("does not apply this rule to standard messages", () => {
    const input: GovernedMessageInput = { text: "Thinking of you today.", messageType: "standard" };
    expect(validateGovernedMessage(input)).toEqual({ valid: true });
  });
});

// ---------------------------------------------------------------------------
// Rule 5 — a closing message must state it is final and carry support information
// ---------------------------------------------------------------------------

describe("rule 5: closing-message-missing-ending-statement / closing-message-missing-support-information", () => {
  it("passes a closing message with the ending statement, programme line, and crisis contact", () => {
    const input: GovernedMessageInput = {
      text: compliantClosingMessage,
      messageType: "closing",
      syntheticFictionalContactsAcknowledged: true,
    };
    expect(validateGovernedMessage(input)).toEqual({ valid: true });
  });

  it("fails with closing-message-missing-ending-statement when the final-message statement is absent", () => {
    const text = [rules.programmeLine, rules.crisisSupportContact].join(". ");
    const result = validateGovernedMessage({
      text,
      messageType: "closing",
      syntheticFictionalContactsAcknowledged: true,
    });
    expect(result).toEqual({
      valid: false,
      issues: [{ code: "closing-message-missing-ending-statement" }],
    });
  });

  it("fails with closing-message-missing-support-information when the programme line is absent", () => {
    const text = [rules.closingStatement, rules.crisisSupportContact].join(". ");
    const result = validateGovernedMessage({
      text,
      messageType: "closing",
      syntheticFictionalContactsAcknowledged: true,
    });
    expect(result).toEqual({
      valid: false,
      issues: [{ code: "closing-message-missing-support-information" }],
    });
  });

  it("fails with closing-message-missing-support-information when the crisis contact is absent", () => {
    const text = [rules.closingStatement, rules.programmeLine].join(". ");
    const result = validateGovernedMessage({ text, messageType: "closing" });
    expect(result).toEqual({
      valid: false,
      issues: [{ code: "closing-message-missing-support-information" }],
    });
  });

  it("reports both codes when both the ending statement and the support information are absent", () => {
    const result = validateGovernedMessage({ text: "Nothing relevant here.", messageType: "closing" });
    expect(result).toEqual({
      valid: false,
      issues: [
        { code: "closing-message-missing-ending-statement" },
        { code: "closing-message-missing-support-information" },
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// Rule 5b — resolveClosingContactMessageBody (item A4, 2026-08-24)
//
// No closing message has ever been written -- that wording is a clinical decision deferred to a
// lived-experience representative, not an implementation gap. This is the refusal ONLY: no
// closing-message wording is drafted here or anywhere in this task. See
// docs/caring-contacts/phase-2b-sdd-archive/task-c-brief.md, "A4".
// ---------------------------------------------------------------------------

describe("rule 5b: resolveClosingContactMessageBody / closing-message-body-not-authored", () => {
  it("refuses with its own identifiable reason when no authored body exists", () => {
    expect(resolveClosingContactMessageBody(undefined)).toEqual({
      ok: false,
      issue: { code: "closing-message-body-not-authored" },
    });
  });

  it("refuses the same way for an empty or whitespace-only authored body -- never an empty string, never silent", () => {
    expect(resolveClosingContactMessageBody("")).toEqual({
      ok: false,
      issue: { code: "closing-message-body-not-authored" },
    });
    expect(resolveClosingContactMessageBody("   ")).toEqual({
      ok: false,
      issue: { code: "closing-message-body-not-authored" },
    });
  });

  it("does not refuse a closing contact that does have an authored body", () => {
    const result = resolveClosingContactMessageBody(compliantClosingMessage);
    expect(result).toEqual({ ok: true, body: compliantClosingMessage });
  });

  it("never falls back to the ordinary (non-closing) message text", () => {
    // A body-not-authored refusal must never resolve to some other message's text -- it has no
    // `body` field on the failure branch at all.
    const result = resolveClosingContactMessageBody(undefined);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result).not.toHaveProperty("body");
  });

  it("is a different failure from closing-message-missing-ending-statement (missing body vs. wrong body)", () => {
    // A body that EXISTS but is wrong (lacks the required ending statement) is caught later, by
    // validateGovernedMessage, with a different code -- proving the two failures are distinguishable.
    const noBody = resolveClosingContactMessageBody(undefined);
    expect(noBody).toEqual({ ok: false, issue: { code: "closing-message-body-not-authored" } });

    const wrongBody = "Some closing text with no ending statement.";
    const resolved = resolveClosingContactMessageBody(wrongBody);
    expect(resolved).toEqual({ ok: true, body: wrongBody });
    const validated = validateGovernedMessage({ text: wrongBody, messageType: "closing" });
    expect(validated).toEqual({
      valid: false,
      issues: [
        { code: "closing-message-missing-ending-statement" },
        { code: "closing-message-missing-support-information" },
      ],
    });
  });

  // -------------------------------------------------------------------------
  // #59JT7W — the refusal is the CHOKEPOINT's, not this function's alone.
  //
  // These are the assertions that make the guard unbypassable. Before them, the rule lived only
  // in `resolveClosingContactMessageBody`, so a sender that obtained a closing body some other
  // way met no refusal at all. Now `validateGovernedMessage` -- which every sender must pass --
  // holds it, and the function above delegates. Both halves are pinned, because either one
  // drifting silently restores the bypass.
  // -------------------------------------------------------------------------

  it("the chokepoint refuses an absent closing body with the body-not-authored code", () => {
    expect(validateGovernedMessage({ text: undefined, messageType: "closing" })).toEqual({
      valid: false,
      issues: [{ code: "closing-message-body-not-authored" }],
    });
  });

  it("the chokepoint refuses a blank or whitespace-only closing body the same way", () => {
    for (const text of ["", "   ", "\n\t "]) {
      expect(validateGovernedMessage({ text, messageType: "closing" })).toEqual({
        valid: false,
        issues: [{ code: "closing-message-body-not-authored" }],
      });
    }
  });

  it("reports body-not-authored ALONE, never alongside the wrong-body codes", () => {
    // The distinction is the whole point. `closing-message-missing-ending-statement` sends a
    // maintainer looking for wording to correct; there is none to correct. Accumulating both
    // would still refuse, but would refuse with a false diagnosis.
    const result = validateGovernedMessage({ text: "", messageType: "closing" });
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("unreachable");
    expect(result.issues).toHaveLength(1);
    expect(result.issues.map((issue) => issue.code)).not.toContain("closing-message-missing-ending-statement");
    expect(result.issues.map((issue) => issue.code)).not.toContain("closing-message-missing-support-information");
  });

  it("refuses an unauthored body for every message type, not only closing", () => {
    // Review finding. An earlier draft of this fix refused only `closing`, which left the
    // chokepoint answering `valid: true` -- an explicit "this may be sent" -- for a standard
    // message with no body at all. Widening `text` to `string | undefined` is what made that
    // reachable, so the fix whose purpose is CLOSING a bypass would have opened a smaller one.
    //
    // `standard` and `first` report their own code: the closing one carries the specific A4
    // meaning that no closing wording has ever been clinically authored, which says nothing about
    // an ordinary message whose body a caller failed to supply.
    for (const messageType of ["standard", "first"] as const) {
      for (const text of [undefined, "", "   "]) {
        expect(validateGovernedMessage({ text, messageType })).toEqual({
          valid: false,
          issues: [{ code: "message-body-not-authored" }],
        });
      }
    }
  });

  it("still reports the record-level refusals when there is no body to check", () => {
    // Review finding. The early return used to report the body issue ALONE, so a cancelled plan
    // with no closing body said only "write a body" -- inviting an operator to author a closing
    // message for a plan that can never send, and refusing them on the second attempt. The
    // recoverable condition must not mask the unrecoverable one. State checks read no text, so a
    // missing body makes none of them unanswerable.
    expect(
      validateGovernedMessage({
        text: undefined,
        messageType: "closing",
        contactState: "cancelled",
        planState: "withdrawn",
      }),
    ).toEqual({
      valid: false,
      issues: [
        { code: "closing-message-body-not-authored" },
        { code: "terminated-contact-dispatch-refused", state: "cancelled" },
        { code: "terminated-contact-dispatch-refused", state: "withdrawn" },
      ],
    });
  });

  it("the adapter and the chokepoint agree on every authored/unauthored input", () => {
    // One question, asked two ways, over both branches: an authored body (compliant or merely
    // present-but-wrong) and an unauthored one (absent, empty, whitespace). If these ever
    // disagree, the adapter has grown a second opinion and the bypass is back.
    for (const body of [undefined, "", "   ", compliantClosingMessage, "wrong but present"]) {
      const validated = validateGovernedMessage({ text: body, messageType: "closing" });
      const chokepointSaysUnauthored =
        !validated.valid && validated.issues.some((issue) => issue.code === "closing-message-body-not-authored");
      expect(resolveClosingContactMessageBody(body).ok).toBe(!chokepointSaysUnauthored);
    }
  });
});

// ---------------------------------------------------------------------------
// Rule 6 — a patient mobile number must never appear in the message
// ---------------------------------------------------------------------------

describe("rule 6: contains-patient-mobile", () => {
  it("fails when the message contains the patient's mobile number", () => {
    // +61 491 570 006 is deliberately one of synthetic-contacts.ts's four reserved fictional
    // numbers (miraPatientMobile) -- since fix round 1, that means it ALSO trips
    // fictional-contact-detail-present (A1), because the marker pattern covers "every reserved
    // number", not just the crisis/staffed-line ones. Both codes are correct here; this proves
    // the two rules coexist rather than one silently masking the other.
    const input: GovernedMessageInput = {
      text: "Call us back on +61 491 570 006 any time.",
      messageType: "standard",
      patientMobileNumber: "+61 491 570 006",
    };
    expect(validateGovernedMessage(input)).toEqual({
      valid: false,
      issues: [{ code: "fictional-contact-detail-present" }, { code: "contains-patient-mobile" }],
    });
  });

  it("passes when the patient's mobile number is known but absent from the text", () => {
    const input: GovernedMessageInput = {
      text: "Thinking of you today.",
      messageType: "standard",
      patientMobileNumber: "+61 491 570 006",
    };
    expect(validateGovernedMessage(input)).toEqual({ valid: true });
  });

  it("passes when no patient mobile number is supplied", () => {
    const input: GovernedMessageInput = { text: "Thinking of you today.", messageType: "standard" };
    expect(validateGovernedMessage(input)).toEqual({ valid: true });
  });
});

// ---------------------------------------------------------------------------
// Rule 7 — the service can never receive a reply, so it must never ask a question
// ---------------------------------------------------------------------------

describe("rule 7: solicits-reply", () => {
  it("fails a message containing a question mark", () => {
    const input: GovernedMessageInput = { text: "How are you doing?", messageType: "standard" };
    expect(validateGovernedMessage(input)).toEqual({ valid: false, issues: [{ code: "solicits-reply" }] });
  });

  it("passes an equivalent statement with no question mark", () => {
    const input: GovernedMessageInput = { text: "Thinking of how you are doing.", messageType: "standard" };
    expect(validateGovernedMessage(input)).toEqual({ valid: true });
  });
});

// ---------------------------------------------------------------------------
// Rule 8 — validateGovernedMessage never calls a network, model, or provider
// ---------------------------------------------------------------------------

describe("rule 8: validateGovernedMessage is a pure, provider-free function", () => {
  it("imports only from its own domain (model.ts, message-rules.ts) or the standard library", () => {
    const source = readFileSync(path.join(process.cwd(), "src", "lib", "caring-contacts", "message-policy.ts"), "utf8");
    const specifiers = [...source.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((match) => match[1]);
    for (const specifier of specifiers) {
      expect(specifier.startsWith("node:") || specifier === "./model" || specifier === "./message-rules").toBe(true);
    }
  });

  it("returns synchronously, not a Promise", () => {
    const result = validateGovernedMessage({ text: "Thinking of you today.", messageType: "standard" });
    expect(result).not.toBeInstanceOf(Promise);
  });

  it("is deterministic and does not mutate its input", () => {
    const input: GovernedMessageInput = { text: "Thinking of you today.", messageType: "standard" };
    const snapshotBefore = JSON.stringify(input);
    const first = validateGovernedMessage(input);
    const second = validateGovernedMessage(input);
    expect(second).toEqual(first);
    expect(JSON.stringify(input)).toBe(snapshotBefore);
  });
});

// ---------------------------------------------------------------------------
// Rule 9 — terminated contacts or closed plans trigger deterministic refusal
// ---------------------------------------------------------------------------

describe("rule 9: terminated-contact-dispatch-refused", () => {
  it("refuses message dispatch when evaluating a contact in terminal state", () => {
    const terminalStates = [
      "delivered",
      "suppressed",
      "cancelled",
      "notDelivered",
      "numberInvalid",
      "contactChanged",
      "statusUnavailable",
      "missed",
    ] as const;
    for (const contactState of terminalStates) {
      const input: GovernedMessageInput = {
        text: "Thinking of you today.",
        messageType: "standard",
        contactState,
      };
      const result = validateGovernedMessage(input);
      expect(result).toEqual({
        valid: false,
        issues: [{ code: "terminated-contact-dispatch-refused", state: contactState }],
      });
    }
  });

  it("refuses message dispatch when evaluating a plan in terminal state", () => {
    const terminalPlanStates = ["withdrawn", "cancelled", "completed"] as const;
    for (const planState of terminalPlanStates) {
      const input: GovernedMessageInput = {
        text: "Thinking of you today.",
        messageType: "standard",
        planState,
      };
      const result = validateGovernedMessage(input);
      expect(result).toEqual({
        valid: false,
        issues: [{ code: "terminated-contact-dispatch-refused", state: planState }],
      });
    }
  });

  it("permits message evaluation for active, non-terminal contact and plan states", () => {
    const input: GovernedMessageInput = {
      text: "Thinking of you today.",
      messageType: "standard",
      contactState: "scheduled",
      planState: "active",
    };
    expect(validateGovernedMessage(input)).toEqual({ valid: true });
  });

  // -------------------------------------------------------------------------
  // #PAMATF — a plan that has not STARTED, or is paused, is also not dispatchable.
  //
  // This check tested `TERMINAL_PLAN_STATES` only, which names the three ENDED states, so a draft
  // and a paused plan passed the chokepoint carrying a message. The two halves of "this plan is not
  // sending" were split between a list here and nothing at all.
  // -------------------------------------------------------------------------

  it("refuses a plan that has not been started, naming the hold rather than calling it terminated", () => {
    const result = validateGovernedMessage({
      text: "Thinking of you today.",
      messageType: "standard",
      contactState: "scheduled",
      planState: "draft",
    });
    // Its OWN code. A draft plan has not ended, and reporting it as terminated would be the right
    // refusal for the wrong reason -- the same distinction rule 5b draws for an unauthored body.
    expect(result).toEqual({
      valid: false,
      issues: [{ code: "plan-not-dispatchable", state: "draft", hold: "planNotStarted" }],
    });
  });

  it("refuses a paused plan, and keeps paused distinguishable from not-started", () => {
    const result = validateGovernedMessage({
      text: "Thinking of you today.",
      messageType: "standard",
      contactState: "scheduled",
      planState: "paused",
    });
    expect(result).toEqual({
      valid: false,
      issues: [{ code: "plan-not-dispatchable", state: "paused", hold: "planPaused" }],
    });
  });

  it("leaves the ended states reporting the code they always did", () => {
    // Nothing that reads `terminated-contact-dispatch-refused` changes meaning: the new code is
    // additive, covering states that previously reported nothing at all.
    for (const planState of ["withdrawn", "cancelled", "completed"] as const) {
      const result = validateGovernedMessage({ text: "Thinking of you today.", messageType: "standard", planState });
      expect(result).toEqual({
        valid: false,
        issues: [{ code: "terminated-contact-dispatch-refused", state: planState }],
      });
    }
  });

  it("refuses every plan state except active, so no hold can be left unhandled", () => {
    const permitted = (["draft", "active", "paused", "withdrawn", "cancelled", "completed"] as const).filter(
      (planState) =>
        validateGovernedMessage({ text: "Thinking of you today.", messageType: "standard", planState }).valid,
    );
    expect(permitted).toEqual(["active"]);
  });
});
