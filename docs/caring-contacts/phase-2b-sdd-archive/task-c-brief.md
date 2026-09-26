# Task C brief — the owner's six approved copy and message-policy changes

**Plan:** `docs/superpowers/plans/2026-08-24-caring-contact-phase-2b-screens.md`, "Task C".
**These are your requirements.** Exact values below are to be used verbatim.

This is a **suicide-prevention** caring-contacts prototype. Every patient and number is invented and
nothing is ever sent to any number. The wording you are changing is nevertheless the wording a
distressed person would read, so the standard is accuracy, not tidiness.

Six changes, two modules plus one new test file. Each change **cites its item number** and **carries
its own covering test**, named so the item is findable later.

---

## A2 + A3 — the automated reply's wording (do these together; they are one sentence)

`src/lib/caring-contacts/message-copy.ts`, constant `AUTOMATED_REPLY_RESPONSE`.

**Replace the first sentence only.** Today it reads:

> `This number is not read. Your message has not been seen by anyone and has not been kept.`

It becomes, verbatim:

> `No one at Example Aftercare Team reads this number, and this reply is automatic.`

So the whole constant becomes (keep the existing template interpolation for the two numbers — do not
inline them):

```
No one at Example Aftercare Team reads this number, and this reply is automatic. To talk to someone,
call ${FICTIONAL_CONTACTS_BY_ROLE.programmeStaffedLine}, 9 am-6 pm every day. In an emergency call
000. Fictional Support Line: ${FICTIONAL_CONTACTS_BY_ROLE.crisisSupportContact}.
```

(as a single line, no wrapping — the wrapping above is this document's.)

**Why, so you can tell if you have broken it.** Two separate defects are being fixed at once.
**A2:** "has not been seen by anyone and has not been kept" is a firm factual claim about storage,
made to a person in distress, about a system that has no telephony provider yet — so nobody can
currently know whether it is true. The replacement says only what this system can actually know: who
is not reading. **A3:** a patient told "no one reads replies" who then receives a message may
reasonably conclude somebody did read it. "and this reply is automatic" closes that.

**Do NOT change `PATIENT_VISIBLE_NO_REPLY_NOTICE` or `EXACT_PATIENT_VISIBLE_MESSAGE`.** Message A is
252 septets against a 2-segment ceiling of 306 — ~~roughly nine characters of headroom~~, **corrected
2026-08-27 to 54 septets, all of them allocated to the preferred-name slot, leaving zero for new fixed
wording** — so the "something automatic comes back" fact deliberately lives only in the reply message,
which has room. This was decided, not overlooked. The instruction was right; its stated reason was not.

**Verified for you, so you do not have to guess:** the replacement is **210 septets, 2 segments,
GSM-7 valid** (current is 218). Your test must assert the segment count rather than trust this line.

**Update the constant's comment.** The existing comment explains the 2026-08-19 narrowing. Add the
2026-08-24 one beneath it in the same voice, citing items A2 and A3 and the owner's approval date.

**Covering tests:** assert the exact new text; assert `segments === 2` and `valid === true` via
`calculateGsm7`; assert the text does NOT contain "has not been kept" (the removed claim) and DOES
contain "automatic". Existing tests asserting the old string must be **updated to the new approved
value** — that is not loosening an assertion, it is the assertion tracking an owner decision. If you
find yourself instead _deleting_ an assertion, stop and report.

---

## A1 — the fictional crisis number must not be able to reach a real send

`src/lib/caring-contacts/message-policy.ts`.

**Read this before implementing; the obvious version is wrong.** The owner approved "add a machine
check that refuses any message still containing the word Fictional". But **both approved messages
contain `Fictional Support Line` today**, so adding `"Fictional"` to `prohibitedTerms` makes every
existing message invalid, and the check would have to be disabled to ship. **A disabled check is
worse than no check.**

**Implement it as Ruling 79 instead:**

1. Add a new issue code `{ code: "fictional-contact-detail-present" }` to `MessageValidationIssue`.
2. `validateGovernedMessage` reports it whenever the text contains a fictional contact marker.
   Derive the marker from `FICTIONAL_CONTACTS_BY_ROLE` / the rules object where you can, rather than
   hard-coding the literal string twice.
3. Add an input field `syntheticFictionalContactsAcknowledged?: boolean` to `GovernedMessageInput`.
   When it is `true`, the issue is **not** raised. When it is absent or false, it **is**.
4. Update the prototype's existing callers to pass `syntheticFictionalContactsAcknowledged: true`,
   so the acknowledgement is explicit, greppable, and attached to each call site.

**Why this shape:** the real risk is that nobody replaces the fictional number before a real sender is
built. A bare prohibition cannot survive today's messages; an always-reported issue with an explicit
opt-in means the day someone builds a real send path they must either consciously pass a flag whose
name says it is synthetic, or remove the fictional numbers. The failure becomes deliberate rather than
silent.

**Covering tests:** a message containing the fictional crisis number without the flag is invalid with
exactly that issue code; the same message with the flag is valid; a message with no fictional marker
and no flag does not raise it. Then **deliberately break it** — make the check always return no issue
— and confirm the first test goes red.

---

## A4 — a required closing message with no body must refuse loudly, never pass quietly

`src/lib/caring-contacts/message-policy.ts` and wherever a contact's message body is resolved (start
from `message-rules.ts` and `schedule.ts`; find the seam rather than assuming one).

The rules require a final message to contain `This is the final message in this programme`. **No
closing message has ever been written**, so a plan reaching its end today would send nothing at all.

**You are building the refusal ONLY. Do not draft any closing-message wording** — that is a clinical
decision the owner has deferred to a lived-experience representative, and an implementer drafting it
would be the exact failure this task exists to prevent.

Required behaviour: resolving the message body for a contact of type `closing` when no authored body
exists must produce an explicit refusal that names the missing thing. It must not return an empty
string, must not fall back to the ordinary message, and must not silently skip the contact.

**Covering tests:** the refusal fires with its own identifiable reason; a closing contact WITH a body
does not refuse; and the refusal is distinguishable from `closing-message-missing-ending-statement`,
which is a different failure (a body that exists but is wrong).

---

## B2 — narrow the "lead" prohibition to its commercial sense

`src/lib/caring-contacts/message-policy.ts`, `PROVISIONAL_MESSAGE_RULES.prohibitedTerms`.

The prohibition currently matches by `lowerText.includes(term)`, so `"lead"` also matches the ordinary
English `the incident lead` and `the clinical programme lead` — which are people's job titles and
appear in the service-stop wording. If that sentence were ever put through this checker it would be
rejected for a word used correctly.

Narrow **only this one term** so it catches the commercial sense and not the job title. Word-boundary
matching plus a commercial-specific form is the expected shape.

**Do not weaken any other prohibited term, and do not convert the whole list to word-boundary matching
as a convenience** — several terms are multi-word phrases whose current substring behaviour is
deliberate. If you believe another term has the same defect, report it; do not fix it here.

**Covering tests:** `the incident lead` and `the clinical programme lead` are accepted; the commercial
sense is still rejected; every other prohibited term still behaves exactly as before — assert that
explicitly, one case per term, because this is the change most likely to quietly widen what is
allowed.

---

## B3 — extend the prohibited-word scan to interface strings

New static test file, e.g. `tests/caring-contacts-interface-vocabulary.test.ts`.

Today the prohibition runs against outgoing messages and the 24 frozen overlay rows. **Nothing checks
the words on a screen**, so the ban on interface wording is policy held by people rather than by
software.

Scan the string literals under `src/components/caring-contacts/workspace/**` and
`src/app/caring-contacts/**` for the prohibited vocabulary and fail on a match.

**Scope limits, deliberate:** do **not** scan `src/components/caring-contacts/mockups/**` — it is
frozen design scratch that 404s in production and it contains a known occurrence ("…never means the
message was read or the patient is safe") which the owner ruled B4 to leave alone. Excluding it is
correct; excluding anything else is not.

Expect false positives on ordinary English and handle them by narrowing the _match_, not by adding a
file to an ignore list. If you cannot avoid an exclusion, it needs a comment naming why.

**Covering test:** the scan finds a deliberately planted prohibited string in a fixture, and passes on
the real tree. A scan that cannot fail is worse than no scan — prove it fails.

---

## Constraints binding every change here

- **Domain isolation:** nothing under `src/lib/caring-contacts/` may import from `@/components`,
  `@/app`, any `@/lib` module outside itself, Supabase, or OpenAI.
- **Never delete or loosen an existing assertion** to make a change fit. Updating an assertion to an
  owner-approved new value is fine and expected; deleting one is not. If you are tempted, stop and
  report.
- **Test-first.** Write the failing test, run it, watch it fail for the stated reason, then implement.
- **After each item, deliberately break the implementation and confirm the covering test goes red** —
  and check FIRST that your mutation changes a value some assertion actually reads. On 2026-08-24 a
  mutation in this repo silently failed to apply and its gate reported `32 passed`, exit 0, which
  would have supported exactly the wrong conclusion. Prove the mutation is in the tree.
- **Never report a gate as passing from an exit code.** Paste the `N passed` line.
- Gates: `npm run test:focused -- --files <paths>` while iterating, then the FULL `npm run test`
  before you report — this directory is policed by static scans living in files your diff will not
  contain, and that is exactly how one real failure survived two tasks. Then `npm run typecheck` and
  `npm run lint`.
- **Do not push and do not open a pull request.** Commit locally only.

## What to report

Write your full report to
`docs/caring-contacts/phase-2b-sdd-archive/task-c-report.md`, then return ONLY: status
(DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED), the commit SHAs, a one-line test summary, and
your concerns. Do not paste the report into your reply. Do not dispatch subagents of your own.
