# Caring Contacts: architecture excerpts

Copied from PsychSift `docs/codebase-index.md` at commit f75eeb11e for this standalone copy. File paths match this copy.

## Pages

| Route                                                                                                                                                                                                                                                                           | File                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `/caring-contacts` (standalone workspace; own nav, entered from Tools)                                                                                                                                                                                                          | `src/app/caring-contacts/`                               |
| `/caring-contacts/patients` (permission-scoped caseload: one row per plan plus an authorised names-only projection; URL state filter and local name/identifier search)                                                                                                          | `src/app/caring-contacts/patients/page.tsx`              |
| `/caring-contacts/patients/[patientId]` (one patient's episode: identity, the plan, and its twelve-month schedule; the ONE screen that may call `getEpisode`)                                                                                                                   | `src/app/caring-contacts/patients/[patientId]/page.tsx`  |
| `/caring-contacts/plans/new` (the activation wizard: agreement, pathway, personalisation, review; started for one accepted referral named by `?referral=`)                                                                                                                      | `src/app/caring-contacts/plans/new/page.tsx`             |
| `/caring-contacts/schedule` (the team's day: three approved sending windows, contacts at no approved send time, named exceptions; the day travels in `?day=`)                                                                                                                   | `src/app/caring-contacts/schedule/page.tsx`              |
| `/caring-contacts/templates` (the governed pathway versions this team holds: lifecycle, publication and retirement facts, and the approvals behind each one, qualified by the record's provenance)                                                                              | `src/app/caring-contacts/templates/page.tsx`             |
| `/caring-contacts/templates/[pathwayId]` (ONE governed version in full: its lifecycle, both approval seats with the record's provenance qualification, the wording that record holds together with that wording's approval status, and whether a new plan may be started on it) | `src/app/caring-contacts/templates/[pathwayId]/page.tsx` |
| `/caring-contacts/guidance` (programme boundaries, incident and downtime behaviour, and the language rules; fixed text, one service-state read, no record about anybody)                                                                                                        | `src/app/caring-contacts/guidance/page.tsx`              |
| `/caring-contacts/reports` (aggregate operational measures, and the §2.5 programme-reach section — which states that the field it would report on is not collected rather than showing an empty breakdown)                                                                      | `src/app/caring-contacts/reports/page.tsx`               |
| `/caring-contacts/team` (where the team's work is sitting: plans sending, plans their own state is holding, coverage, exception backlog and unclaimed work against the 60-minute escalation — operational only, and it ranks nobody)                                            | `src/app/caring-contacts/team/page.tsx`                  |
| `/caring-contacts/intake` (manual hospital referral intake fallback; coordinator data entry when automated EMR feeds are unavailable or delayed — Hazard H-44)                                                                                                                  | `src/app/caring-contacts/intake/page.tsx`                |

## API

| Area            | Routes                                                                                                      | Entry files        |
| --------------- | ----------------------------------------------------------------------------------------------------------- | ------------------ |
| Caring Contacts | `/api/caring-contacts/*` (synthetic demo session, team-scoped workspace, access trail and workflow actions) | `caring-contacts/` |

## How it is built

`src/lib/caring-contacts/` is an isolated, synthetic caring-contact domain. It uses only
relative imports within its directory, provides deny-by-default team-scoped permissions and
privacy-safe audit records, and is exercised against both in-memory and local Postgres
repositories. `src/lib/caring-contacts-server/` is the server-side seam for the demo session
and optional separate database connection. It must fail closed in production and must never
connect to the `Clinical KB Database` Supabase project. The standalone `src/app/caring-contacts/` workspace
is noindex, visibly marked synthetic, and has a single inbound entry from the Tools catalogue.

Inside the workspace, `src/components/caring-contacts/workspace/shell.tsx` owns the whole
destination set: a destination carries an `href` only once its page exists, and every other one
renders as an unavailable control that states what it will hold (Ruling 52). `/caring-contacts`
(Today), `/caring-contacts/patients` (the caseload), `/caring-contacts/patients/[patientId]`
(one patient's episode), `/caring-contacts/plans/new` (the activation wizard),
`/caring-contacts/schedule` (the team's day),
`/caring-contacts/templates` (the governed pathway versions),
`/caring-contacts/templates/[pathwayId]` (one of them in full), `/caring-contacts/guidance`,
`/caring-contacts/reports` and `/caring-contacts/team` are what is built so far. Every one of them is a page that reads the
store through `auditedRead` rather than over HTTP, using the same access identity the matching API
route records; filtering and, on the patient overview, the choice of which plan to open are carried
in the URL and read by the Server Component.

The More panel carries the destinations the rail does not, and its entries carry an `href` under the
same Ruling 89 rule. It ALSO carries the primary destinations the phone bar has no room for, in a
`md:hidden` row derived from the two arrays rather than listed — which is what makes
`/caring-contacts/templates` reachable below 768px, where there is no rail. It was not:
`tests/route-reachability.test.ts` reads `shell.tsx` as text and cannot see which array an `href`
sits in or what CSS governs it, so it passed on a shipped route no phone could reach. The assertion
that can fail on that walks the rendered ancestor chain, in
`tests/caring-contacts-workspace-shell.dom.test.tsx`, and clicks the link at 390px in
`tests/ui-caring-contacts-workspace.spec.ts`.

`/caring-contacts/reports` performs NO read of `caring_contacts.cultural_identity_reports`. Spec §2.5
promises reach reporting over Aboriginal and Torres Strait Islander status, and this system records
none — so the screen states what is and is not collected instead of rendering an empty breakdown,
which would read as a statement about patients rather than about collection. The two halves of §2.5
are in different states and the screen says so: the small-cell threshold IS set (the owner's decision
of 2026-08-26, held with its provenance in `src/lib/caring-contacts/reach-reporting-governance.ts`,
which is the file a governance change opens and the only place the number appears); a bounded
category set is not. The suppression rule itself lives in
`src/lib/caring-contacts/reach-reporting.ts`: it takes the threshold as a required argument, refuses
one too low to hide anything, and suppresses complementary cells so that no hidden figure is
recoverable by subtracting the published ones from a total.

`/caring-contacts/team` renders `buildTeamWorkload` and draws three FEWER columns than the approved
design does, each because nothing in this system holds the value (Task 17's findings 1–3, and none of
them is an oversight). There is no staff display NAME: the stores hold an `ActorId` and nothing else
about a person, and a staff directory is a system this build is not connected to — so the identifier
is rendered as an identifier and the screen states that a name is not held. There is no ROLE column:
nothing returns the roles an `ActorId` holds, `Actor` being assembled at the session seam for the one
person acting. And there is no per-member UNCLAIMED count, because unclaimed means there is no owner
to file the work under; the design's unclaimed row is rendered once, above both the desktop table and
the compact roster, as the spec §4.4 pair — the escalation as an `AutomatedState` carrying the
threshold that produced it and the one thing that clears it. Both ages it shows are upper bounds
measured from the earliest instant the work could have been waiting, and are named for that rather
than called a queue age. Its Reassign work control is a link to the caseload: a reassignment needs
one plan, this read deliberately carries no plan id, and the control that performs one already exists
on `plan-actions.tsx`.

`/caring-contacts/templates` is a governance record viewer, and the LIBRARY shows no message wording
at all. Ruling [127]: the one patient-visible message that exists is a specimen rather than a
template, and there is no per-version message content anywhere, so a library that printed wording
beside a version would claim a relationship the data does not have. The DETAIL route
`/caring-contacts/templates/[pathwayId]` does show the wording, because a record states what it
holds where a list cannot: it reads `snapshot.messageTextByType` back verbatim and never assembles
a string. Beside it, the route states the wording's approval status in `message-copy.ts`'s own
words — provisional, not clinically approved — read from the sealed domain rather than retyped
(Ruling [131]), because a version's dual approval approves the VERSION and nothing in this system
has approved the words. What both routes carry is `PathwayVersionSnapshot.provenance`, resolved
through `pathwayVersionProvenanceWording` so that an approval line can never stand unqualified over
a record nobody approved.

The Schedule screen is the one that must not let two different days read the same. `disposition`
alone cannot separate a quiet day from a stopped one, so the screen states each day from `counts`,
which partition a day with nothing due into already-sent, held-by-its-own-plan and never-will-be; a
plan somebody created and never started is surfaced as its own automated state, because a discharged
patient receiving nothing while the plan record looks complete is an operational failure rather than
a quiet day. It derives no schedule rule of its own -- the windows, the holds, the exceptions and the
counts all come from `src/lib/caring-contacts/schedule-view.ts` -- and it is the one workspace screen
that deliberately does NOT read `listPatientNames`, so that the trail row meaning "somebody read
patients' names" is not written every time a coordinator glances at a day.

`/caring-contacts/plans/new` is the one screen with a deliberate client boundary (Ruling [109]).
The page itself is still a Server Component -- it makes the audited reads, decides the actor's
capability, and fails closed -- and it hands a lazily-imported `PlanWizard` the referral and the
approved pathway versions, and nothing else. The service state, which carries an incident note,
stays on the server; `plan-wizard/stages.ts` is where Tasks 8 and 9 flip stages 3 and 4 from
unbuilt to built, and the wizard's in-progress draft lives in `sessionStorage` alone
(`plan-wizard/plan-draft.ts`, Ruling [110]).

The patient overview is the only screen permitted to call `getEpisode`, which is the one read that
releases a patient's name, mobile number, identifiers and cultural identity together. Every other
screen is built to avoid it: the caseload uses `listPatientNames`, the names-only projection
(Ruling 91). The overview calls it once, for one plan, and only after Ruling 97's rule has settled
which plan — the route is keyed by patient, the reads are keyed by plan, and one patient can
honestly hold two episodes, so the screen presents them and never picks. Ruling 94: do not restate

The Patients caseload carries the workspace's other deliberate client boundary, and it exists for a
confidentiality rule rather than a browser capability. Its search matches the patient's NAME, and
while the box was a `method="get"` form that name travelled as `?q=` — into the address bar of a
possibly-shared ward computer's history and the access log of every proxy in between. Ruling [111]
forbids exactly that, so the typed text is React state in `patients-directory-client.tsx` and reaches
no URL in any form. The page around it stays a Server Component and the payload it hands over is
SMALLER than the HTML it replaced: rows are reduced to the row projection and pre-filtered by plan
state on the server side.
that as a count of client components — this paragraph has carried two such counts and both were
wrong. What holds Ruling 13 is the module boundary, which does not decay as files are added:
nothing outside the `/caring-contacts` route segment imports the workspace (the tools catalogue
names it by href, never by import), so the dashboard references no chunk exclusive to it.
