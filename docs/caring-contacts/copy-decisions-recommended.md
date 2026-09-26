# Caring Contacts — the copy decisions, with a recommendation for each

> ## OWNER APPROVED ALL THIRTEEN, 2026-08-24
>
> The owner read the thirteen items in chat and answered "go ahead with your recommendations."
> That is the decision of record for every item below. Two qualifications, because approval of a
> recommendation is not the same as the recommendation being executable today:
>
> - **A9 (adding Lifeline `13 11 14`) CANNOT be executed yet, by its own terms.** The recommendation
>   was to add Lifeline _and drop the `Fictional Support Line` line once a real crisis number is
>   chosen_ — because ~~the message is roughly nine characters from its two-segment maximum~~ **[the
>   figure is wrong — CORRECTED 2026-08-27: the message is 54 septets short of its 306-septet
>   two-segment ceiling, and every one of those 54 is already allocated to the preferred-name slot,
>   whose cap is 59 septets. The room for new FIXED wording is zero, not nine characters. The
>   conclusion below stands; its stated reason did not, and the owner approved it on the wrong
>   reason]**, so nothing can be added until something comes out. No real crisis number exists. **A9 is APPROVED IN
>   PRINCIPLE and BLOCKED ON a real crisis number.** Do not implement it by removing some other
>   sentence chosen by an implementer; the owner was explicitly asked to name what goes, and the
>   answer that arrived approves the shape, not a specific removal. Re-ask when a real number exists.
> - **A4 (the closing message) is approved as a DEFERRAL, not as text.** The approved recommendation
>   is that the wording be written in a later phase with a lived-experience representative, and that
>   the system refuse loudly in the meantime. The refusal half is buildable now; the wording is not,
>   and no implementer should draft it.
>
> Everything else is approved for implementation. Patient-visible strings are therefore NO LONGER
> FROZEN — but each change must cite the item number it implements, and the sealed domain's
> `message-copy` module remains the single place they live.

**Written 2026-08-24, approved the same day, and NOT YET IMPLEMENTED.** The freeze that used to sit
here is lifted — see the banner above. Approval and implementation are different things, and the
status table at the foot of this file is the one that says which items are built.

## Why this file exists

`copy-review.md` sets out every concern but deliberately offers no recommendations — it is a mark-up
document, and guessing at intent was explicitly ruled out when it was written. Recommendations were
given to the owner on 2026-08-23 **in conversation only, and were never written to a tracked file**,
so they did not survive the session that made them. This file closes that gap. It is the
recommendation half; `copy-review.md` stays the evidence half and wins on any question of what the
current wording actually says.

**Two counts, and the disagreement is worth stating rather than smoothing over.** `PROGRESS-LEDGER.md`
and the continuation prompt both say **seven** items need the owner's call. `copy-review.md` Part 7
lists **ten** concerns and Part 5 lists **three** more — thirteen in total. Reading all thirteen,
**nine are genuinely clinical or policy decisions only the owner can take** and four are engineering
work needing no clinical input. The "seven" does not reconcile against the document and appears to be
an undercount carried forward from an earlier draft, so this file uses the thirteen and marks which
is which.

**"Cost if wrong" means the cost of having followed my recommendation and been mistaken** — that is
the thing worth weighing, not the recommendation itself.

---

## A. The nine that need the owner's clinical or policy decision

### A1 — A patient is given a crisis number labelled "Fictional Support Line"

Current wording, in every message: `Fictional Support Line: +61 491 570 158`.

**Recommend:** keep the fictional label, and add a machine check that refuses to send any message
whose crisis-line text still contains the word "Fictional". Not a comment and not a note in a
runbook — a test that goes red, in the same place the two-segment length limit is already enforced.

**Why:** the label is correct today and is the honest thing for a prototype to say. The risk is not
the wording, it is that nothing forces it to be replaced. The programme already proves this pattern
works: the required-fragment checker rejects a message missing `In an emergency call 000`, so the
same mechanism can reject one that still says `Fictional`.

**Cost if wrong:** near zero. A check that fires on the day a real number arrives is a two-line edit
to remove.

### A2 — "Your message has not been seen by anyone and has not been kept" may not be true

**Recommend:** narrow it to what this system can actually promise, and say who is not reading rather
than what is not stored — something in the shape of _"No one at Example Aftercare Team reads this
number."_ Do not restore any claim about storage until a telephony provider is chosen and its
retention terms have been read.

**Why:** this is the highest-risk sentence in the programme. It is a firm factual claim about data
handling, made to a person in distress, about a system that has no telephony provider yet — so
nobody can currently know whether it is true. The same reasoning already forced one narrowing here
on 2026-08-19, when "Replies are not received, stored, analysed or monitored" became untrue the
moment the number was made able to receive. This is the identical mistake one step further down.

**Cost if wrong:** a patient is told slightly less than the eventual truth. That is the safe
direction of error. The other direction is a false promise about confidentiality to a suicidal
person, which no later correction reaches.

### A3 — "No one reads replies to this number" says what does not happen, not what does

**Recommend:** say both, in that order — nobody reads it, and something does come back
automatically — so the patient knows the auto-reply is not a person.

**Why:** a patient who reads "no one reads replies" and then receives a message may reasonably
conclude somebody did read it after all. That is worse than the original ambiguity, because it
teaches them the stated boundary is unreliable at exactly the moment the boundary matters.

**Cost if wrong:** characters. Message A is already at its two-segment ceiling of 252 — about nine
characters from rejection — so this may not fit in Message A and may have to live only in Message B.
Decide it as a pair with A9.

### A4 — The required closing message does not exist

The checker requires a final message to contain `This is the final message in this programme`. No
final message has been written, so a plan reaching its end today sends nothing.

**Recommend:** treat the wording as a Phase 2B deliverable and write it with a lived-experience
representative, not before. In the meantime make the gap loud rather than silent: a plan whose last
contact has no message body should refuse and raise, not pass quietly.

**Why:** the end of a caring-contacts series is a clinically loaded moment — it is the point the
patient loses the contact — and drafting that text is not a job for a coding session. But a silent
no-op is the worst available behaviour, because it looks like success.

**Cost if wrong:** the refusal fires during a demo and needs explaining. Cheap. A silently missing
final message means a patient's series stops with no closure and nothing recorded that it happened.

### A5 — A patient is never told when sending stops

During a service-wide stop, a pause, or a contact-changed block, clinicians are told in detail and
the patient is told nothing.

**Recommend:** keep it that way for a service-wide safety stop, and record it as a deliberate
decision rather than leave it an omission. Revisit only for a **withdrawal**, where the patient
asked.

**Why:** a service-wide stop is triggered by a serious incident affecting somebody else. A message
saying "your messages have stopped" to a person who did not ask, at a moment nobody can explain to
them, invites the reading that they did something wrong or that something has happened to their
clinician. Silence is the more conservative option and it is reversible — nothing prevents adding a
notice later.

**Cost if wrong:** a patient notices the messages stopped and does not know why. That is real, and it
is exactly why this needs the owner's decision rather than a controller ruling.

### A6 — "Contacts that fall inside the pause are skipped for good"

**Recommend:** confirm the behaviour is intended, and change the clinician-facing wording to state
the consequence as a number rather than a fact — for example _"3 contacts fall inside this pause and
will not be sent later."_

**Why:** in caring contacts the schedule is the intervention. Silently and permanently removing
contacts from it is a clinical act, and "skipped for good" is easy to read past when you are pausing
for an ordinary administrative reason.

**Cost if wrong:** none — showing the count is strictly more information. Whether pausing _should_
drop contacts is the owner's question, and this recommendation does not settle it.

### A7 — Withdrawal is immediate, irreversible, and needs nobody else's agreement

Restarting the service after a stop needs three approvals from three people. Withdrawing a patient
needs none and cannot be undone.

**Recommend:** keep the asymmetry and record why. Add a confirmation step that names what is lost.
Do not add an approver.

**Why:** the asymmetry is defensible and I think correct, because the two actions are not comparable.
A restart resumes sending to everybody after an incident, so the risk is in acting too readily. A
withdrawal is a patient exercising a choice about contact they receive, and putting a second
clinician in front of that turns a patient's decision into a request. Irreversibility is the part
worth softening, and a confirmation naming the consequence does that without an approval gate.

**Cost if wrong:** a withdrawal made in error cannot be reversed and the patient must be re-enrolled
from the start. The confirmation step is what makes that acceptable, so it should not be dropped
from this recommendation.

### A8 — "All three attempts in the original window are finished and there is no later retry"

A patient whose contact fails receives nothing that day and nothing later.

**Recommend:** confirm as clinical policy, and surface it where a clinician will actually meet it —
on the patient's plan, not only inside a button panel.

**Why:** no-later-retry is a reasonable design. A caring contact arriving days late is a different
intervention, and stacking retries turns a non-demanding contact into a demanding one. But it is a
clinical policy currently stated only in a place a clinician sees once something has already gone
wrong. If a patient is missing contacts, that belongs on their plan.

**Cost if wrong:** a clinician assumes a failed contact will be retried and does not follow up
manually. That is a real gap in a suicide-prevention programme, which is why the visibility half
matters more than the policy half.

### A9 — "000" is the only emergency direction given

No Lifeline, no 13YARN, no after-hours mental health line.

**Recommend:** decide this as a pair with A3, because they compete for the same nine spare
characters. If only one thing can be added: **add Lifeline `13 11 14`, and drop the
`Fictional Support Line` line once a real crisis number is chosen** — the fictional line is already
occupying the space a real one would need.

**Why:** 000 alone directs a person in distress to an emergency-services response. That is the right
answer for an emergency in progress and the wrong answer for someone distressed and not in immediate
danger, and Lifeline is the standard Australian answer to that second state. 13YARN matters for
Aboriginal and Torres Strait Islander patients, and the schema already carries cultural identity, so
it could be conditional rather than universal — but that is a Phase 2B capability, not a wording
change.

**CORRECTED 2026-08-27 — the "nine characters" figure is wrong, and it was wrong everywhere it was
relayed.** Computed directly from the module rather than from any comment: the two-segment ceiling is
**306 septets**; the message with its name slot EMPTY costs **247 septets**; the specimen name `Rowan`
brings it to **252 septets**, leaving **54 septets** unused. Nine is not the headroom under any reading
found. **But the conclusion survives for a different and sharper reason:** every one of those 54
remaining septets is already allocated to the preferred-name slot, whose cap is **59 septets** — 247
plus 59 is exactly 306. So the room available for new FIXED wording is **zero**, not nine characters,
and adding any still requires something to come out or the name budget to shrink. The distinction
matters because "nine characters" invites trimming nine characters, which would not be enough.

**Cost if wrong:** ~~the length ceiling is hard at about nine characters~~ — the ceiling is hard at
**zero** unallocated septets, so anything added means something removed, and removing the wrong thing
is worse than adding nothing. This is the one item where I would not act on my own recommendation
without the owner's explicit choice of what goes.

---

## B. The four that need no clinical input

None of these changes a patient-visible string. All can proceed as soon as the owner says go.

### B1 — Two panels describe content they do not show

"Preview the message the patient would see" shows no message; "Plan activation recorded" records
nothing. **Recommend:** change the words now to match what exists, and let Phase 2B change them back
when the content lands. A true statement about a smaller product beats a false one about a larger
one.

### B2 — "lead" appears in visible wording in its ordinary English sense

"the incident lead", "the clinical programme lead". **Recommend:** narrow the prohibited-vocabulary
ban to the commercial sense rather than exempting the sentence — an exemption would have to be
re-argued every time the sentence changes. These are people's job titles.

### B3 — The prohibited-vocabulary ban is not enforced on screen wording

It runs on outgoing messages and the 24 frozen overlay rows only. **Recommend:** extend it to a
static scan over interface strings. Captured in the issues inbox on 2026-08-24 as a P2 issue.

### B4 — One banned word is rendered, in the frozen design-scratch prototype

"Delivered is a transport receipt only and never means the message was read or the patient is safe."
**Recommend:** leave it. Those screens 404 in production and Phase 2B replaces them, and the sentence
uses "safe" in order to deny it, which is the defensible use. Decide it when the wording is carried
across, and let B3's scan flag it at that point.

---

## What happens next

1. The owner marks this file up, or answers item by item.
2. Only then does any patient-visible string change, and each change carries its decision reference.
3. A1's machine check, B1, B2 and B3 can start as soon as he says go; none touches patient wording.

---

## Implementation status, 2026-08-24

Approval is not implementation. Nothing below has been built yet.

| Item | Approved outcome                                                    | Where it gets built                       |
| ---- | ------------------------------------------------------------------- | ----------------------------------------- |
| A1   | Machine check refusing any message containing "Fictional"           | Small change now, beside the length check |
| A2   | Narrow the storage promise to who is not reading                    | Small change now, `message-copy`          |
| A3   | Say nobody reads it AND something automatic comes back              | Small change now, `message-copy`          |
| A4   | Refuse loudly when a final message is missing; wording deferred     | Refusal now; wording a later phase        |
| A5   | Patient not told during a service-wide stop — DELIBERATE            | Decision only; nothing to build           |
| A6   | Confirm intended; show the count of contacts a pause discards       | Phase 2B, Group 1                         |
| A7   | Keep the asymmetry; add a confirmation naming what is lost          | Phase 2B, Group 1                         |
| A8   | Confirm no-later-retry; surface it on the plan, not only in a panel | Phase 2B, Groups 1-2                      |
| A9   | Add Lifeline — **BLOCKED**, needs a real crisis number first        | Re-ask when one exists                    |
| B1   | Make the two panels describe what they actually show                | Phase 2B, Group 3                         |
| B2   | Narrow the "lead" ban to the commercial sense                       | Small change now                          |
| B3   | Extend the prohibited-word scan to interface strings                | Small change now (issues inbox P2)        |
| B4   | Leave the design-scratch sentence alone                             | No action                                 |
