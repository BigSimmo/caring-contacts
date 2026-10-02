# Caring Contacts — message review pack

> **Standalone provenance correction — 2 October 2026.** Extraction source: PsychSift
> `f75eeb11e` (25 September 2026). The missing audit/clinical references below are
> historical source limitations, not available standalone evidence or completed review.
> Use the [pilot governance checklist](pilot-governance-checklist.md) and [standalone hazard log](hazard-log.md)
> for current review navigation. They do not replace missing evidence or approve a pilot.
> Historical verification dates and reconstruction warnings remain; no support numbers
> or clinical conclusions were reverified for this repair.

> **DRAFT — requires clinical sign-off by the owner before any real-patient use.**
>
> This pack is a starting point assembled from what this repository already contains. It is **not
> clinical authority**, and nothing in it constitutes approval of any wording or of a pilot. Every
> message text quoted below is marked `PROVISIONAL` in the source and **has not been clinically
> approved**. Publishing this document does not change that.

**Status:** first draft, 2026-09-04. Unreviewed.
**Purpose:** to give the lived-experience review named in hazard **H-04** one place that lists every
patient-visible string this system holds, what governs each, and where the evidence is that the
governing check actually runs.
**Companion:** [`hazard-log.md`](hazard-log.md) — read its scope and status notes first.

## Why this file was written from scratch

`src/lib/caring-contacts/message-copy.ts:11` and `:20`, and two archived task briefs, cite
`docs/caring-contacts/message-review-pack.md` as "the lived-experience and clinical-programme
approval gate that owns final wording". **The original file was not found in the former PsychSift history inspected for the September 2026 reconstruction** — see the
same note in [`hazard-log.md`](hazard-log.md) and finding M6 of
`docs/audit/full-repository-audit-2026-09-02.md` (former PsychSift source; unavailable in this standalone copy).
This is a reconstruction from the code, not a recovery of the original. The original's structure,
its facilitation questions and any prior review notes are lost.

## What the reviewer is being asked

Nothing in this pack asks anyone to approve code. The decisions are:

1. **May each patient-visible string below be sent to a discharged patient of a suicide-aftercare
   service?** Yes, no, or replaced-with.
2. **Two messages have never been written at all** — the `first` message and the `closing` message.
   The closing message is the harder one: it is the last thing a person hears from the service.
3. **One sentence is already the owner's own** — the crisis-support sentence. It is listed for the
   reviewer's information; it is not the reviewer's to reword (see §3 below).

## 1. The messages a patient can receive

There are exactly **two** patient-visible strings in this repository, plus two message types that
have never been authored.

Both messages are **single-line SMS strings**. The line breaks in the blocks below are this page
wrapping them, not part of the message. Both are quoted from the source with the interpolated
fragments resolved, so what appears here is what a phone would show.

### Message A — the scheduled caring contact

**Where:** `src/lib/caring-contacts/message-copy.ts:42` (the template),
`:57` (the specimen with the fictional name `Rowan` substituted).
**Status in code:** `PROVISIONAL — not clinically approved` (`message-copy.ts:5`).
**Type:** `standard`.

```
Hi {preferredName}, Alex from Example Aftercare Team is thinking of you. This is a one-way message.
No one reads replies to this number. For timing changes call +61 491 570 157, 9 am-6 pm.
In an emergency call 000. If you need to talk, Lifeline 13 11 14, any time. 13YARN 13 92 76. - Alex
```

Two fragments inside it are governed separately and are listed on their own below: the no-reply
notice (§2) and the crisis-support sentence (§3). `+61 491 570 157` is a **reserved fictional
number that connects to nobody** (`src/lib/caring-contacts/synthetic-contacts.ts:20`); a real
staffed line has to replace it before anything is sent.

`{preferredName}` is what the clinician was told to call the person, asked for as its own field. It
is never derived by splitting a stored name — the reasoning is at `message-copy.ts:34-40` and is
worth the reviewer reading, because it is a wording decision, not a technical one.

### Message B — the automated reply

**Where:** `src/lib/caring-contacts/message-copy.ts:215`.
**Status in code:** `PROVISIONAL — not clinically approved` (`message-copy.ts:176`).
**Sent to:** anyone who texts back. It is the only thing a person who reaches out on this channel
receives.

```
No one at Example Aftercare Team reads this number, and this reply is automatic. To talk to someone,
call +61 491 570 157, 9 am-6 pm every day. In an emergency call 000.
If you need to talk, Lifeline 13 11 14, any time. 13YARN 13 92 76.
```

The reviewer should know two things the source records about this string. It once claimed a reply
"has not been seen by anyone and has not been kept" — a firm claim about storage, made to a person
in distress, about a system with no telephony provider, so nobody could know whether it was true;
it was removed (`message-copy.ts:189-199`). And "and this reply is automatic" exists because a
person told "no one reads replies" who then receives a reply could reasonably conclude somebody
read theirs first.

### Message C — the automatic reply to an incoming text (added 2026-09-26)

**Where:** `INBOUND_AUTO_REPLY_MESSAGE` in `src/lib/caring-contacts/message-copy.ts` (end of file).
**Status in code:** `PROVISIONAL — not clinically approved`. Needs clinical and lived-experience
sign-off before any real patient receives it.
**Sent to:** every person who texts the service's number — a patient, a family member, or a number
the service has never seen — **at most once per number per 24 hours**, so two automatic systems
cannot text each other in a loop. It is the same for everyone, including someone who texted STOP.

```
This number isn't monitored. For help now call 000, Lifeline 13 11 14, or the Mental Health Emergency Response Line 1300 555 788 (Perth) or 1800 676 822 (Peel).
```

Exactly 160 characters: one standard text message. The owner asked for this wording's content
("this number isn't monitored, call 000, Lifeline or the Mental Health Emergency Response Line").

What the reviewer should decide, and why it was written this way:

- **It replaces Message B in practice.** Nothing in the code sends Message B; before 2026-09-26 an
  incoming text went nowhere at all. Message B names the prototype's invented staffed line
  (`+61 491 570 157`), and the message rules refuse to send an invented number to a real phone, so
  it could never have been sent for real. Message C names only real lines, taken from
  `docs/caring-contacts-crisis-lines.md`. 13YARN and Rurallink did not fit in one message and were
  left out; the reviewer should decide whether that is acceptable or whether a second segment is
  worth the cost.
- **"Isn't monitored" is the honest claim.** A reply from a known patient is now kept and shown to
  a clinician as a "reply to check" — but only when a person next opens the workspace, which could
  be hours or a weekend away. The message therefore promises no response and asks no question.
- **The same words for STOP.** A STOP-type reply pauses the patient's plan for a person to review,
  but the automatic reply does not say so: it goes to unknown numbers too, and saying "your messages
  are paused" would confirm to whoever holds the phone that this person is enrolled. Whether a
  patient who texts STOP should be told anything more is a decision for this review.
- **It conflicts with the no-reply notice (§2).** See the note added there.

### Message type `first` — NOT AUTHORED

**Where the absence is recorded:** `src/lib/caring-contacts-server/demo-seed.ts:128` (`first: ""`).
No first-message wording has ever been written. The policy that a first message must carry the
programme line, the operating hours, the emergency direction and the crisis-support contact exists
(`src/lib/caring-contacts/message-policy.ts:208`); the words that satisfy it do not.

### Message type `closing` — NOT AUTHORED, and deliberately so

**Where the absence is recorded:** `demo-seed.ts:129` (`closing: ""`), and the refusal that
enforces it at `src/lib/caring-contacts/message-policy.ts:317`.

No closing wording exists, and no implementer in this programme may write one. A plan reaching its
end today has nothing to send, and the system's answer is a named refusal rather than an empty
message, a silent skip, or some other message's text reused. The rule requires a closing message to
say it is the final message in the programme (`src/lib/caring-contacts/message-rules.ts:191`) —
which is exactly why copying Message A into the slot would be worse than leaving it blank: it would
tell someone the contact continues when it has ended.

**This is the single most important item in this pack.**

## 2. The no-reply notice

**Where:** `src/lib/caring-contacts/message-copy.ts:12` —
`"No one reads replies to this number"`. It appears inside Message A.

It previously read "Replies are not received, stored, analysed or monitored". That became untrue on
2026-08-19 when the production build spec replaced the non-receiving sender with a
receiving-capable number that auto-responds and discards: replies **are** received, then discarded
unread. The current wording claims only what remains true — who is not reading. An outstanding-issues
inbox record (`docs/outstanding-issues-inbox/0f9238c1-8add-450c-92d1-917376761248.json`) records that
replacing this wording is a clinical decision requiring dual approval, and names it as the first item
for this pack.

**The decision:** is "No one reads replies to this number" the right thing to tell a person in
suicide aftercare about a channel that receives but discards?

**Changed 2026-09-26 — this notice is now untrue for patients.** Incoming texts are no longer
discarded. A reply from a number held on a patient's plan is kept with the plan and shown to
clinicians on the Today screen and the patient's page, where someone reads it and marks it followed
up. "No one reads replies to this number" — and Message B's "No one at Example Aftercare Team reads
this number" — therefore now say something false to exactly the people they are sent to. Neither was
reworded here, because changing governed wording is this review's decision, not an implementer's.
The review must replace both before real sending, and should decide the replacement together with
Message C (for example: replies are read by the team during working hours, not straight away, and
here is who to call now).

## 3. The crisis-support sentence — the owner's own words

**Where:** `src/lib/caring-contacts/message-rules.ts:117` —
`"If you need to talk, Lifeline 13 11 14, any time. 13YARN 13 92 76."`

This is the one string in the message set the owner authorised himself, in writing, on 2026-08-27
(recorded as Ruling [144] at `message-rules.ts:95-116`). It is interpolated into both Message A and
Message B from this single constant, so the two cannot drift apart and carry different crisis
numbers.

Three things about its shape are deliberate, per the source: "If you need to talk" separates it from
the `In an emergency call 000.` sentence, which is right for an emergency in progress and wrong for
someone distressed and not in immediate danger; "any time" contrasts with the staffed line's
`9 am-6 pm`; and 13YARN is offered universally rather than conditionally, so the system never has to
hold or act on a patient's cultural identity in order to offer a culturally appropriate service.

**It is listed here for the reviewer's information, not for rewording.** If the review believes it
is wrong, the finding goes to the owner.

**Unverified:** the repository records no source and no verification date for the Lifeline or 13YARN
numbers themselves, and no check ages them. To verify — no network access in this session.

## 4. The policy that applies to each template, and the evidence it runs

Every rule below is enforced by one function, `validateGovernedMessage`
(`src/lib/caring-contacts/message-policy.ts:152`), against the content rules in
`src/lib/caring-contacts/message-rules.ts`.

| #   | Rule                                                                                                                  | Applies to               | Where the check is                                                                                                              | Evidence it runs                                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | No body, no send                                                                                                      | A, B, `first`, `closing` | `message-policy.ts:175`, with "authored" defined at `:280`                                                                      | `tests/caring-contacts-message-policy.test.ts:477` (`rule 5b`)                                                                                      |
| 2   | At most two GSM-7 SMS segments                                                                                        | A, B                     | `message-policy.ts:186`; the ceiling itself at `:42`                                                                            | `tests/caring-contacts-message-policy.test.ts:79` (`rule 2`); the bound over every accepted name at `tests/caring-contacts-message-copy.test.ts:23` |
| 3   | No prohibited or commercial vocabulary                                                                                | A, B, `first`, `closing` | `message-policy.ts:191` over the frozen list at `message-rules.ts:172`; the whole-word `lead` pattern at `message-rules.ts:167` | `tests/caring-contacts-message-policy.test.ts:99` (`rule 3`) and `:274` (`rule 3c`)                                                                 |
| 4   | No reserved fictional contact detail, unless explicitly acknowledged at the call site                                 | A, B                     | `message-policy.ts:204` against the marker pattern at `message-rules.ts:122`                                                    | `tests/caring-contacts-message-policy.test.ts:157` (`rule 3b`)                                                                                      |
| 5   | A first message must carry the programme line, the hours, the emergency direction and the crisis contact              | `first`                  | `message-policy.ts:208`                                                                                                         | `tests/caring-contacts-message-policy.test.ts:355` (`rule 4`)                                                                                       |
| 6   | A closing message must say it is the final message, and must carry the programme line and the crisis contact          | `closing`                | `message-policy.ts:219`                                                                                                         | `tests/caring-contacts-message-policy.test.ts:411` (`rule 5`)                                                                                       |
| 7   | The recipient's own mobile number must not appear in the text                                                         | A, B                     | `message-policy.ts:229`                                                                                                         | `tests/caring-contacts-message-policy.test.ts:626` (`rule 6`)                                                                                       |
| 8   | A one-way message must not invite a reply (no `?`)                                                                    | A, B, `first`, `closing` | `message-policy.ts:233`                                                                                                         | `tests/caring-contacts-message-policy.test.ts:663` (`rule 7`)                                                                                       |
| 9   | Nothing is evaluated for a contact or plan that has ended, has not started, or is paused                              | all                      | `message-policy.ts:251` and `:255`                                                                                              | `tests/caring-contacts-message-policy.test.ts:707` (`rule 9`)                                                                                       |
| 10  | A preferred name that is missing, too long, or not GSM-7 encodable refuses the whole message rather than falling back | A                        | `src/lib/caring-contacts/message-copy.ts:151`                                                                                   | `tests/caring-contacts-message-copy.test.ts:23`                                                                                                     |
| 11  | The crisis-support sentence is one constant, is real, and is never filed among the fictional numbers                  | A, B                     | `message-rules.ts:117`; the prohibition at `src/lib/caring-contacts/synthetic-contacts.ts:1`                                    | `tests/caring-contacts-message-copy.test.ts:323` (`Ruling [144]`)                                                                                   |
| 12  | A message may never permit a phrase the clinician's own screen refuses                                                | A, B                     | the parity block comparing the two `lead` definitions                                                                           | `tests/caring-contacts-interface-vocabulary.test.ts:867`                                                                                            |
| 13  | The automated reply's own segment budget is measured, not inherited from Message A                                    | B                        | `message-copy.ts:218`                                                                                                           | `tests/caring-contacts-message-copy.test.ts:265`                                                                                                    |

### The limitation the reviewer must be told about

`validateGovernedMessage` is called by `message-copy.ts`, by its own module, and by the three test
files above. **It is called by no production code path in this repository**
(`grep -rn "validateGovernedMessage" src worker scripts`). That is not a defect — there is no
telephony provider and no sender here, and **no message has ever been sent to any number, real or
test**. But it means the evidence column above proves _that a function refuses_, not _that a
delivered message was checked_. When a sender is built, every sending path calling this chokepoint
becomes its own hazard needing its own control.

## 5. Not in scope for this review — clinician-facing strings

Listed so the reviewer knows what has deliberately been left out. None of these is ever sent to a
patient.

| String                                     | Where                                             | What it is                                                                          |
| ------------------------------------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `CLINICIAN_FACING_WORDING_APPROVAL_STATUS` | `src/lib/caring-contacts/message-copy.ts:240`     | The sentence a screen shows to say this wording is provisional and unapproved       |
| `STOP_REASON_WORDING`                      | `src/lib/caring-contacts/service-state.ts:155`    | Incident-banner wording; describes the event, never the patient                     |
| `PLAN_ASSURANCE_WORDING`                   | `src/lib/caring-contacts/assurances.ts:122`       | Reads an attestation back as an act a clinician performed, never as patient consent |
| `PATHWAY_APPROVAL_ROLE_WORDING`            | `src/lib/caring-contacts/pathway-versions.ts:154` | Names the two approval seats                                                        |
| `CARING_CONTACT_ROLE_WORDING`              | `src/lib/caring-contacts/permissions.ts:122`      | Names the clinician roles                                                           |

## 6. Suggested running order for the session

Drafted, not prescribed. The facilitator should change it.

1. Read Message A aloud, in full, as a person would receive it on a phone.
2. Read Message B, then Message C — Message C is what a person who texts back actually receives.
3. Discuss the no-reply notice (§2): it is now untrue for patients' replies, which are read.
4. Discuss the two unwritten messages (`first`, `closing`), longest on `closing`.
5. Note the fictional staffed line: a real number and real hours have to exist before any of this
   is sendable.
6. Record what the review decided, who was present, and the date, and take it to the owner.

**Recording the outcome:** when the gate decides, the status changes in one place —
`CLINICIAN_FACING_WORDING_APPROVAL_STATUS` at `src/lib/caring-contacts/message-copy.ts:240` — and
every screen showing the wording changes with it. Do not retype the outcome onto a screen.

## Claims in this document that could not be verified from the repository

1. **The original review pack's content, structure and any prior review notes.** Never present in
   this repository; this document is a reconstruction from the code.
2. **The Lifeline `13 11 14` and 13YARN `13 92 76` numbers**, and the Mental Health Emergency
   Response Line numbers `1300 555 788` (Perth) and `1800 676 822` (Peel) in Message C. No source and
   no verification date is recorded anywhere in the repository, and no check ages them. To verify —
   no network access in this session.
3. **That the two patient-visible strings above are the complete set.** They are the complete set
   reachable from `src/lib/caring-contacts/message-copy.ts` and the demo seed's
   `messageTextByType`. A pathway version stored in a database carries its own message text
   (`src/lib/caring-contacts/pathway-versions.ts:61`), and this repository cannot enumerate rows
   that do not exist in it.
4. **That the owner authorised the crisis-support sentence in writing, twice.** The only evidence
   is the source comment at `src/lib/caring-contacts/message-rules.ts:99-103`. The correspondence
   is not in the repository.
5. **That the review named in H-04 has any agreed membership, terms of reference, or date.** None
   is recorded anywhere.
