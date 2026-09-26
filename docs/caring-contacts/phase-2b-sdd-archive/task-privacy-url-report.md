# Task: a patient's name must never reach the caseload URL (Ruling [111])

Branch `claude/browser-test-gate-handoff-d5c1db`, worktree
`.claude/worktrees/browser-test-gate-handoff-d5c1db`. Nothing pushed, no PR, no subagents, no
network command.

## The defect, as it stood

`patientsDirectoryHref` in `src/components/caring-contacts/workspace/patients-directory.tsx` built
`?q=<search text>`, the caseload search box was a `method="get"` form posting to that parameter, and
`matchesFilter` in the same file matched the query against the patient's **name**. Typing a name
therefore produced `/caring-contacts/patients?q=Jordan%20Nguyen`, which reaches the browser history
of a possibly-shared ward computer and the access log of every proxy in between.

Ruling [111], quoted verbatim from `src/lib/caring-contacts-routes.ts`: _"a query string is logged
by every proxy between here and the browser. Nothing about a patient may travel here, including as a
draft key."_

## The ruling implemented

Confidentiality outranks payload size. Ruling 13 (client payload held to a rounding error) is a
performance preference; Ruling [111] is a patient-confidentiality contract. `origin/main` reached
the same split independently. Adopted.

## What changed

**`src/components/caring-contacts/workspace/patients-directory.tsx` — now the SERVER half.** It
reads, narrows each `PlanRecord` + name projection to a `PatientsDirectoryRow`, filters by the
non-identifying plan state, and hands the result over. It computes `awstCalendarDay`, the suppressed
and absorbed contact counts, and the name map — so the raw `PlanRecord` (pathway, team, contact
schedule, discharge instant) never crosses the boundary. `mayViewPlans === false` hands over **no
rows at all**: the capability is answered on the server side, so a role that may not see the caseload
does not receive it in a payload it merely declines to render.

**`src/components/caring-contacts/workspace/patients-directory-client.tsx` — ADOPTED, not deleted.**
The file the catch-up merge carried in was `origin/main`'s snapshot and was **stale relative to this
trunk** in two ways that adopting it verbatim would have regressed:

- it used `UnavailableDestination` for the row's detail control, which Task 6 had already replaced
  with `<Link href={patientRoute(row.patientId)}>` once that route existed (Rulings 52/89/97);
- it had no `mayViewPatientNames` prop and no `NamesNotShownNotice`, so the "your role may not see
  names, stated once above the list" behaviour would have disappeared.

So main's **approach** was adopted and this trunk's **behaviour** was preserved inside it. The island
holds the typed text in `useState`, matches it against name + patient id + plan id + referral id, and
serializes it into nothing at all.

It stays on the client-component allowlist in `tests/caring-contacts-explained-automation.dom.test.tsx`
because it is now a real, rendered client component and that check asserts exact set equality — the
"unadopted" comment is gone and replaced with the real justification, so the allowlist describes
reality. Deleting the file was the other permitted outcome and was rejected: adopting it is what the
defect required.

**`src/lib/caring-contacts/patients-directory-filter.ts`** — main's module is now the one in use. Its
comment already read _"Parse only non-identifying state from the URL; patient-name search stays in
browser memory."_ That is now true of the code that runs: the page imports this parser, and the
duplicate `parsePatientsDirectoryFilter`/`PatientsDirectoryFilter` that carried a `query` field is
gone. The comment was expanded to say that the absence of `q` is the contract rather than an
omission, and that a stale `?q=` on an old bookmark is **ignored rather than honoured**.

**`src/app/caring-contacts/patients/page.tsx`** — imports the parser from the sealed lib module. The
"FILTERING IS A URL" note is now "THE PLAN-STATE FILTER IS A URL; THE NAME SEARCH IS NOT".

### The identifier search — what I concluded

The brief allowed the identifier search to stay server-side. **It did not.** One control feeds both
halves, exactly as the approved design shows ("Name or synthetic ID"), and splitting it would have
put two search boxes on one caseload — giving a coordinator a way to type a name into the
server-backed one. A synthetic patient/plan/referral id is not a name and would have been safe to
leave on the server; the reason it moved is that keeping one box is the only way to guarantee a name
never reaches the server as a query parameter on its way to matching an identifier. That is the
brief's own warning, and splitting the controls is what would have triggered it.

### The cost, stated on screen rather than hidden

A reload now keeps the plan-state filter and clears the typed name, and the URL no longer reproduces
the filtered view. Nothing compensates for that — the name is not in a hash, a fragment, an encoded
parameter, or a hash **of** a name, because a hash of a name is still a name-derived identifier in a
log.

Spec 4.4 applies, so the screen says it, in place, wired to the input with `aria-describedby`:

> This search stays in this browser tab. Reloading the page, or opening its web address anywhere
> else, clears what you typed here and keeps the plan-state filter above, because the plan state is
> in the web address and what you type here never is: a patient's name is never put into a web
> address, browser history or server log.

The empty state's "Show every plan" remedy is now **one** control for **two** filters that live in
two different places: a `<Link>` to the bare patients route (drops the state from the address) with
an `onClick` that clears the typed search (drops the name from this tab). A `<Link>` alone would have
navigated and left the name still filtering the list it arrived at — a remedy that does not keep its
promise.

## Verification

`npm run test:cc-guards` only, plus `typecheck` and uncached lint. **No full `npm run test`, no
Playwright** — three implementers are live.

| Gate                                               | Decisive line                                                         |
| -------------------------------------------------- | --------------------------------------------------------------------- |
| `npm run typecheck` (`GATE_RECEIPTS=refresh`)      | `[gate-receipts] recorded a pass for "typecheck:internal"`, no errors |
| `npx eslint` on the 6 changed files, cache wiped   | `files linted: 6 / errors: 0 / warnings: 0`                           |
| `npm run test:cc-guards` (`GATE_RECEIPTS=refresh`) | `Test Files 18 passed (18)` / `Tests 401 passed (401)`                |

Lint was run with `node_modules/.cache/eslint` removed and via `npx eslint` (no cache), and the count
is printed explicitly because a silent ESLint pass is indistinguishable from a run that examined
nothing.

**Correction (round 2).** Round 1 of this report claimed "all three were re-run on the final tree".
That was accurate for `test:cc-guards` and not for `typecheck`: the reviewer recomputed the tree's
gate-receipt signature as `08f4bcf5…`, which the `test:cc-guards` receipt carries, while the
`typecheck` receipt carried `80c53421…` — one edit earlier. The only delta was this report's
markdown, which `typecheck` does not read, so the substance was fine and **the sentence was not**.
The claim is corrected here rather than the gate; round 2's own re-verify is recorded at the end of
this file. `typecheck` also refused once with `DATABASE_HEAVY_RUN_ADMISSION_BUSY` (owner worktree
`D:\Worktrees\Database\cc-plan-detail`) — a refusal, not a failure — and was retried until it ran.
No lease was broken at any point in this task.

### Mutation ledger

Every attempt itemised, greens included. Each row predicted its failure message before the run and
the prediction is compared. `git diff --quiet` was asserted clean before and after every mutation,
and every mutation was applied by exact-string replacement with an in-process presence check (never
through a shell — an argv containing `{`, `"` or `$` is not the string you sent on this machine).

| id     | mutation                                                                            | predicted                                                        | observed                                                                                                                            | verdict                                       |
| ------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **M1** | put the name back in a URL: state chip href gains `&q=${encodeURIComponent(query)}` | address loop reddens naming form `Jordan%20Nguyen`               | `AssertionError: an address on this screen carries "Jordan%20Nguyen": expected '/caring-contacts/patients?state=draft…'` — 1 failed | RED as predicted                              |
| **M2** | `matchesQuery` drops `row.patientName` from the haystack                            | the name search finds nothing; `getAllByRole("listitem")` throws | `TestingLibraryElementError: Unable to find an accessible element with the role "listitem"` — 3 failed                              | RED as predicted                              |
| **M3** | remove `aria-describedby` from the search input                                     | `expected null not to be null`                                   | `AssertionError: expected null not to be null` — 1 failed                                                                           | RED as predicted                              |
| **M4** | parser reads `q` back into the filter object                                        | state assertion passes, then `JSON.stringify` contains the name  | `expected '{"state":"active","query":"Jordan Ngu…' not to contain 'Jordan Nguyen'`, failing at line 191 after line 189 passed       | RED as predicted                              |
| **M5** | server wrapper stops filtering by plan state                                        | `expected … to have a length of 1 but got 2`                     | exactly that, plus 4 siblings across 2 files — 5 failed                                                                             | RED as predicted                              |
| **M6** | search `<div role="search">` becomes a `<form>` (fields keep no `name`)             | address collector catches the unnamed field's value              | `an address on this screen carries "Jordan Nguyen": expected '=Jordan Nguyen' not to contain…` — 2 failed                           | RED as predicted                              |
| **M7** | add a field-less `<form method="get" action={patients}>`                            | address loop passes; the `form` null-check reddens               | `AssertionError: expected <form …></form> to be null` — 2 failed                                                                    | RED as predicted                              |
| **M8** | `patientsDirectoryHref` drops `encodeURIComponent` around the plan state            | GREEN — no plan state contains a character needing encoding      | `Test Files 18 passed (18)` / `Tests 401 passed (401)`                                                                              | GREEN as predicted — over-sensitivity control |

**M7 exists because I suspected `expect(container.querySelector("form")).toBeNull()` was redundant.**
M6 showed it firing behind a sibling that reddens first, which proves nothing about it. M7 is the
case that separates them: a form with no fields carries no name into the collector, so the loop
passes and only the form check catches it. The hypothesis was wrong and the check stays.

**Lock refusals encountered and retried, never forced:** the first attempts at M2, M4 and M5 came
back with an exit code and **no summary line**. The raw output shows
`Error: Database focused-test capacity is full (current owner PID 67148, worktree
D:\Worktrees\Database\cc-schedule)`. That is neither a pass nor a failure; each was retried until it
ran. No lease was broken. This is also why the driver keeps raw output: an exit code alone would have
read as "1 failed".

**One honest gap in the driver:** M3's replacement text is the empty string, so its in-process
presence check was vacuously true. The red proves presence by itself (a mutation that never reached
disk cannot make its own target assertion fail), so this cost nothing here — but the driver would not
have caught a delete-mutation that silently failed to apply and then went green.

## What `tests/ui-caring-contacts-workspace.spec.ts` needs — you run this gate

I did not run any Playwright gate and did not change that file. What it needs:

1. **Should still pass unchanged.** Its patients-directory tests exercise the empty caseload ("No
   patients yet") and its colours. That path renders the same `ListEmptyState` from the same
   wording, and the route still serves 200. The one new thing on the page is a hydrated search box
   and a paragraph of text above the empty state; no assertion in that file reads either.
2. **Worth adding — the browser-level counterpart of the load-bearing proof.** Type a patient's name
   into the caseload search box and assert `page.url()` is unchanged, then reload and assert the box
   is empty while the `state` chip's `aria-current` survives. That is the §4.4 claim proven where a
   coordinator actually experiences it, and it is the assertion that would catch a future
   re-introduction of a GET form in a real browser rather than in jsdom.
3. **Caveat on the positive control for (2).** As seeded, that spec's caseload is empty, so a typed
   name would match nothing and the URL assertion would have no positive control — it would prove
   "the URL did not change" over a screen with no rows. To make it load-bearing the spec needs a
   seeded plan with a name, so the typed name can be shown to filter the list before the URL is
   asserted clean. Without that seed, add it as (2) but read it as a weaker check than the jsdom one.

## Not verified

- **No browser was opened.** Forced-colors and 320px were reasoned about, not observed: the new note
  is a token-coloured `<p>` with no border or background of its own, the search row is `flex-col`
  below `sm` with `min-w-0`, and every control kept `min-h-tap` (`--spacing-tap: 3rem` = 48px, never
  `min-h-11`). That is a reading of the classes, not a screenshot.
- **No full `npm run test`**, so cross-file breakage outside the 18 cc-guard files is unproven. The
  page test (`caring-contacts-patients-page.dom.test.tsx`) is inside the gate and passed.
- **No production build.** Two Server/Client defects in this repo have passed typecheck and the unit
  suite before a build caught them; this change adds a Server → Client boundary, which is exactly
  that class. Every prop crossing it is a string, number, boolean or an array of plain objects of
  those, and no function or `Date` crosses — but that is inspection, not a build.

## Concerns

1. **The Server/Client boundary is unproven by a build.** See above. Worth a `npm run build` before
   merge, at the merge point where the heavy lease is free.
2. **`main`'s island was stale and adopting it verbatim would have been a silent regression** — the
   row's `<Link>` and the `mayViewPatientNames` notice. If any other file the catch-up merge carried
   in is being treated as "main's newer version", it deserves the same check rather than the
   assumption.
3. **The `?q=` a coordinator has bookmarked is now silently ignored.** That is the conservative
   direction and I believe it is right, but it is a behaviour change nothing tells the user about: an
   old bookmark opens an unfiltered caseload rather than an error. If that matters, it is a wording
   decision for the owner, not something I should draft.
4. **The whole-tree `npm run format` was not run**, per the gate restriction. The pre-commit hook ran
   documentation synchronisation and reported the tree synchronized; formatting of the changed files
   has not been checked against the repository-wide Prettier pass.

---

# Round 2 — the coordinator's five items

## 1. A bookmarked name was not merely ignored; it was being MULTIPLIED

The coordinator's reviewer found what round 1 missed. `overlayUrl()`
(`workspace-overlays.tsx:79`) copies **every** existing query parameter into each history entry it
pushes. So declining to honour a bookmarked `?q=<name>` did not remove the name from the address bar
— and every time the coordinator opened an overlay, that name was written into a **fresh history
entry**. Not reading a value is not removing it, and on this page not reading it actively made it
worse.

**The address is now rewritten, not merely unread.** `readPatientsDirectoryAddress()` in the sealed
filter module reports whether the address carried anything unrecognised and rebuilds the canonical
query; the page `redirect()`s to it.

Each of the three constraints, and the mechanism that satisfies it:

- **Any unrecognised parameter, not only `q`.** `PATIENTS_DIRECTORY_RECOGNISED_PARAMS` is an
  **allowlist** (`state`, `searchNotApplied`, `overlay`), so `?name=`, `?search=`, `?patient=` and
  anything else trigger the rewrite. A `q`-shaped denylist would have under-reported every one of
  them; M12 is that denylist, and it goes red.
- **The value never reaches the client.** The function returns a **boolean**, and the boolean is
  what the page passes down — not the value, not the parameter's name, not a count, not a length.
  The notice component is therefore structurally incapable of echoing the term: it is not given it.
- **The value never reaches an audit event or an error message.** The `redirect()` is the **first**
  thing the page does after the demo check — before `resolveDemoActor`, before the store opens,
  before every `auditedRead`. That placement is the guarantee; M13 moves it after the reads and the
  access-record assertion goes red.

`canonicalQuery` is built by **naming what may be kept** rather than by deleting what may not, so a
dropped value has no path into the redirect target even by accident. M11 rebuilds it by copying
`searchParams` instead — the realistic mistake — and the name reappears in the target.

Two further properties I had to add rather than inherit:

- **The rewrite target must be clean under the same predicate, or the redirect loops forever.** That
  is why `searchNotApplied` is itself recognised. A test feeds the target back through the reader
  and asserts it asks for no further rewrite; M11 reddens it (`expected true to be false`).
- **A deep-linked overlay must survive the rewrite.** `overlay` is on the allowlist, which forced a
  bare-string duplicate of `WORKSPACE_OVERLAY_PARAM` into the sealed module (it may import nothing
  outside `src/lib/caring-contacts/`). A duplicated string is only acceptable if divergence is loud,
  so a test asserts the two are equal. Without it, renaming the overlay parameter would make this
  route silently strip every deep link out of its own address.

Next 16's `redirect()` in a Server Component is a **307 that replaces** the history entry
(`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md`), so the bookmarked
address is not left behind as an entry of its own — and because it is server-side it works with
JavaScript disabled, which a client-side `history.replaceState` would not have.

**The screen says what happened**: a `role="note"` reading "A saved search was not applied", with a
why and a remedy, which never echoes the term because it was never given it.

### Residual, disclosed rather than discharged

**`overlayUrl()` itself is unchanged, and the multiplier is generic to the workspace.** I fixed the
route the brief scoped me to. Every other workspace route shares the same shell and the same
`overlayUrl` — `/caring-contacts`, `/caring-contacts/plans/new`,
`/caring-contacts/patients/[patientId]` — so a bookmarked `?q=<name>` opened on any of THOSE is
still copied into a fresh history entry on every overlay open. The general fix belongs in
`overlayUrl` (carry only recognised parameters) or in a shell-level canonicalisation, not in one
route's page. **This is a live defect on those routes and I have not touched it**; it needs the
owner to scope it.

## 2. Prettier

Fixed. `npx prettier --write` on the changed files, then
`npx prettier --check $(git diff --name-only HEAD)` → `All matched files use Prettier code style!`
The four files named were `patients-directory.tsx`, `patients-directory-client.tsx`, the directory
test, and this report.

## 3. The re-verify claim was accurate for two gates of three

Corrected in place above rather than by re-running the gate: the reviewer recomputed the tree
signature as `08f4bcf5…`, which the `test:cc-guards` receipt carried and the `typecheck` receipt did
not. The substance was fine — the delta was markdown — and the sentence was not.

## 4. The unmutated assertion

`expect(window.location.search).toBe("")` was the only guard against a **script-driven** address
write, and nothing in round 1 targeted it. M9 writes the query with `history.replaceState`: the DOM
sweep (`addressesIn`) stays green and only that assertion reddens, which is exactly the second line
of defence it was there to be.

A `location.hash` write would have slipped past both. **I added the assertion, not the machinery** —
`expect(window.location.hash).toBe("")` beside it — and M10 proves it can redden. There is no
hash-detection mechanism, and nothing in the island writes a hash today.

## 5. Generated and archived documents that had become false

- `scripts/generate-site-map.ts:92` said the caseload is _"filtered by plan state or synthetic
  identifier through the URL"_. It now says only the plan state travels in the URL and that the
  search runs in the browser. `npm run sitemap:update` regenerated `docs/site-map.md`.
- `main-catchup-inventory.md` finding 3 and finding C are corrected in place with dated **RESOLVED**
  notes; the record of what the merge found is preserved and its present-tense claims about the tree
  are now past-tense.

## Round 2 gates

| Gate                                               | Decisive line                                              |
| -------------------------------------------------- | ---------------------------------------------------------- |
| `npm run typecheck` (`GATE_RECEIPTS=refresh`)      | `[gate-receipts] recorded a pass for "typecheck:internal"` |
| `npx prettier --check` on every changed file       | `All matched files use Prettier code style!`               |
| `npm run test:cc-guards` (`GATE_RECEIPTS=refresh`) | `Test Files 18 passed (18)` / `Tests 412 passed (412)`     |

11 cases were added since round 1 (401 → 412). Contention was severe throughout: `typecheck` needed
four attempts and `test:cc-guards` eight, every refusal a `DATABASE_HEAVY_RUN_ADMISSION_BUSY` or
`focused-test capacity is full` from another worktree (`cc-schedule`, `cc-plan-detail`,
`care-plan-impl`). No lease was broken.

## Round 2 mutation ledger

The driver's presence check was rewritten first, per the sharpened rule: it now computes the expected
post-image in process, writes it, re-reads from disk and asserts **byte equality**. The round-1 form
(`new_first_line in after`) is structurally wrong for an additive mutation — an insertion whose
anchor survives passes it even when the insertion never landed — and was **vacuously true for M3**,
whose replacement was the empty string. It also now refuses a mutation that computes to a no-op.

| id      | mutation                                                 | predicted                                               | observed                                                                                                    | verdict                                       |
| ------- | -------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **M16** | stop stripping; go back to ignoring (`if (false && …)`)  | the four page redirect cases stop rejecting             | `AssertionError: promise resolved "{ … }" instead of rejecting` ×4 — 4 failed                               | RED as predicted                              |
| **M9**  | `history.replaceState` writes the query into the address | DOM sweep unaffected; only `location.search` reddens    | `expected '?q=Jordan%20Nguyen' to be ''` — **1** failed, sweep green                                        | RED as predicted                              |
| **M10** | `location.hash = query`                                  | only the new hash assertion reddens                     | `expected '#Jordan%20Nguyen' to be ''` — 1 failed                                                           | RED as predicted                              |
| **M11** | build `canonicalQuery` by copying `searchParams`         | the term survives into the target, and the target loops | `the redirect target carries "Jordan+Nguyen"` plus `expected true to be false` on the loop guard — 5 failed | RED as predicted                              |
| **M12** | detect only `q` (the denylist the allowlist replaced)    | `?name=` no longer triggers                             | `AssertionError: name: expected false to be true` — 2 failed                                                | RED as predicted                              |
| **M13** | move the `redirect()` after the audited reads            | access records exist where none should                  | `expected [ {…}, {…}, {…} ] to have a length of +0 but got 3` — 1 failed                                    | RED as predicted                              |
| **M15** | reorder the kept parameters (`overlay` before `state`)   | GREEN — every assertion is order-independent by design  | `Test Files 18 passed (18)` / `Tests 412 passed (412)`                                                      | GREEN as predicted — over-sensitivity control |

**Not mutated, because it is structurally impossible rather than merely untested:** the notice
echoing the dropped term. The prop that reaches it is a `boolean`; a mutation that made it echo the
value would have to change the prop's type first, which is a compile error rather than a red test.
Recorded here so nobody reads its absence from the table as an oversight.

## Round 2 final re-verify

Run against commit `c51c651ad`, which contains **every source, test and generated-document change in
this task**. All three green, first attempt each:

- `typecheck` -- `[gate-receipts] recorded a pass for "typecheck:internal" (5502 input files)`
- `test:cc-guards` -- `Test Files  18 passed (18)` / `Tests  412 passed (412)`
- `prettier --check` over every file this task touched -- `All matched files use Prettier code style!`

The only content added to the tree after that run is this paragraph, which is markdown none of the
three gates reads. Stated this way deliberately: round 1's version of this sentence claimed the gates
covered the tree that contained the sentence, which cannot be true of the last edit in any round --
ordering is not the mechanism, and the honest form is to name the commit the verdict covers and the
delta that follows it.

---

# Round 3 — the same defect, where it actually lives

This is a **different defect from the one this report is about**, even though it is the same
mechanism. Rounds 1–2 fixed the Patients caseload. This fixes the other three workspace routes.

## What was wrong

`overlayUrl()` built every history entry it wrote from `new URLSearchParams(window.location.search)`
— **every parameter already on the address**. The shell mounts the overlay module on every workspace
route, so a bookmarked `?q=<name>` opened on `/caring-contacts`, `/caring-contacts/plans/new` or
`/caring-contacts/patients/[patientId]` was written into a **fresh history entry on every overlay
open**. One name in an address bar became one name per overlay open, in the history of a
possibly-shared ward computer. Round 2 removed the multiplier on one route by rewriting the address
before the page rendered; the multiplier itself was untouched.

## Where I fixed it, and why there

**In `overlayUrl()`** — the one function both `pushState` and `replaceState` go through — not in each
route's page. The reasoning is in the code: the defect was never route-specific, it was **the copy**.
A per-route fix would be four copies of one answer and would miss the fifth route somebody adds.

The three properties from round 2 are reused rather than re-derived, and are now in one sealed module
(`src/lib/caring-contacts/workspace-address.ts`):

- **Name what may be kept.** `canonicalCaringContactsQuery` iterates the allowlist and copies nothing:
  `incoming` is never spread, filtered or passed to the `URLSearchParams` constructor. M17 makes it a
  copy — the realistic mistake — and the name reappears on all three routes.
- **`overlay` survives**, so deep links keep working. It is on the allowlist, and the option that sets
  it distinguishes `undefined` (leave), a string (set) and `null` (remove) — the three things opening,
  re-rendering and closing need. M21 breaks the `null` case and the close test reddens.
- **The output is a fixed point of itself**, so nothing loops or drifts. `overlayUrl()` runs on
  addresses it may already have written, and the Patients page redirects to its own canonical form.
  Asserted directly rather than assumed.

**One allowlist, not two shapes of one.** The shell allowlist is the **union** across routes
(`overlay`, `state`, `searchNotApplied`, `plan`, `referral`) because the overlay writer runs on every
screen — a per-route set there would strip another route's own parameter and break it. The Patients
page keeps its own narrower set, so a stray `?referral=` there is still dropped.

### The pin the coordinator told me to reuse — I removed it instead, and this is why

Round 2 duplicated `WORKSPACE_OVERLAY_PARAM` into the sealed module as a bare string and pinned the
copies with an equality test. Building the shell allowlist meant `plan` and `referral` would have
been duplicated the same way, and the instruction was to reuse the pin rather than add more.

Reusing it turned out to be the wrong shape once I looked at the constraint properly. The sealed rule
constrains `src/lib/caring-contacts/`'s **outgoing** imports only — a component or a route builder may
import inward freely. So the names can be **declared once** at the sealed end and re-exported outward,
which is what they now are: `WORKSPACE_OVERLAY_PARAM`, `CARING_CONTACTS_PLAN_QUERY_PARAM` and
`CARING_CONTACTS_REFERRAL_QUERY_PARAM` are aliases of the constants in `workspace-address.ts`.

With one declaration, the equality assertion compares an alias to itself. **It cannot fail**, and an
assertion that cannot fail is worse than no assertion — so it was deleted rather than kept as
decoration. Two guards replace it, both of which can still redden:

- a deep-linked overlay must survive the caseload's own address rewrite (in the directory suite);
- **every `*_QUERY_PARAM` the route module exports must be in the workspace allowlist** (in the shell
  suite), with a floor of two so an empty scan cannot satisfy it vacuously. It reads the module's
  exports rather than its source text, deliberately: those constants are now aliases, so a regex for
  string literals in `caring-contacts-routes.ts` would match nothing and pass while proving nothing.

That second guard is what makes the allowlist's failure direction survivable. Dropping an
unregistered parameter is conservative for privacy and a silent breakage for a feature; this makes a
parameter added later **loud** rather than mysterious.

## The decision you asked me to make deliberately — and it is a finding

**The two mechanisms do not have the same guarantee, and the difference is not a detail.**

|                            | Patients caseload              | The other three routes               |
| -------------------------- | ------------------------------ | ------------------------------------ |
| Where it runs              | Server, in `page.tsx`          | Browser, in `overlayUrl()`           |
| When                       | Before any read, on arrival    | Only when an overlay opens or closes |
| Arrival address            | Replaced by a 307              | **Still carries the name**           |
| That request's server log  | Never sees it                  | **Still records it**                 |
| Access record              | Structurally cannot contain it | N/A — no read is keyed off it        |
| Subsequent history entries | Clean                          | Clean                                |

So this fix stops the **multiplication** and the leak into every later entry. It does **not** give the
other three routes the caseload's property, because `overlayUrl()` cannot: a parameter is already in
the address before any overlay opens, and a client-side function cannot un-log a request the server
has already served.

**Does the shell need its own server-side canonicalisation to match? Yes — and there is exactly one
place for it.** `src/proxy.ts` (Next 16's renamed middleware) already runs on every request and
already performs static route redirects with the query string intact. A `/caring-contacts/**` clause
there, reusing `canonicalCaringContactsQuery`, would give all four routes the caseload's property in
one place and would make the caseload's own `redirect()` a backstop rather than the mechanism.

**I did not do it. The refusal was right; the REASONING I gave for it was wrong, and the correction
matters more than the refusal does.**

Round 3 said "nothing in `test:cc-guards` — the only gate I am authorised to run — covers it". That
sentence is literally true and materially incomplete, and read on its own it tells the next person
that proxy work means writing coverage from scratch. It does not. **Three dedicated offline proxy
suites already exist**, and they cover exactly the two blast-radius concerns I named:

- `tests/proxy.test.ts` — the per-request CSP nonce and the `strict-dynamic` policy shape, among
  others; both terms verified present in the file rather than taken on trust.
- `tests/proxy-auth.test.ts` — the proxy auth header path.
- `tests/proxy-session-refresh.test.ts` — SSR cookie refresh on API routes and page navigations, the
  no-`sb-`-cookie case, the public-PWA path allowlist, and the clinical-API-is-not-public case.

Verified by reading the files: all three exist, and **none of the three is named in any `package.json`
script**, so none runs in `cc-guards` or in any other selection this task could have made. The cost of
the proxy work is therefore **one extra narrow suite selection**, not a coverage-writing project. I did
not look for these before writing a sentence whose only load-bearing word was "nothing", and I should
have.

**Case counts are deliberately not given, and one in the brief I was handed was wrong.** The brief said
`proxy-session-refresh.test.ts` holds 4 cases; it holds 5 `it` blocks, one of which is an `it.each`
over 6 paths, so the suite reports 10 tests at runtime. No single number is right for that file, which
is exactly why the set is named here instead of counted — a count that has to be re-derived to be
believed is not evidence. The point that survives is structural and stable: the coverage already
exists, and it covers the two concerns I named.

**The residual is also smaller than I stated, and this correction cuts the other way.** Every producer
of a query parameter on the other three routes was traced: only `plan` and `referral` are ever
written, both synthetic ids from named builders. The only mechanism that has ever put a NAME into a
Caring Contacts address was the caseload's `method="get"` form, and it posted to
`/caring-contacts/patients` alone — while `overlayUrl()` preserves the pathname, so the copy could
never have carried a `q` across to another route. **The arrival-address gap therefore has no known
producer**: reaching it takes a hand-typed or externally supplied URL.

So the honest classification is **hardening with no known trigger, cheap to verify** — not an open
leak. What survives from the refusal is only the part that was a scoping judgement rather than a
coverage claim: `src/proxy.ts` owns the CSP nonce and the Supabase session refresh for every route in
the application, and pointing it at one workspace's parameter policy is the owner's call.

Two residuals, stated rather than left to be discovered:

- **The hash is carried through unchanged**, as it always was. Nothing in this workspace writes one
  and a hash is never sent to a server, so this is a browser-history exposure only and narrower than
  the query string — but a bookmarked `#<name>` survives `overlayUrl()`. Stripping it would break any
  in-page anchor, so it is a decision rather than an oversight. **The same correction applies here as
  to the proxy gap above**: with no in-app producer of a hash either, this is if anything under-stated
  — hardening against a hand-typed address, not a live exposure.
- **The arrival entry on the other three routes keeps the name until the first overlay interaction**
  rewrites it. That is the proxy-shaped gap above, restated where it bites — and, per the correction,
  reachable only by an address no part of this application produces.

## Round 3 verification

Baseline before mutating, and the final tree after: see the gate table at the end.

**Per-mutation selection.** From M19 onward each mutation ran only the suites it could move, per your
instruction:
`node scripts/run-vitest.mjs run --reporter=dot <suites>` — the same runner and the same shared lease,
79 tests instead of 418. **Every round-3 mutation edits the shared `workspace-address`/`overlayUrl`
mechanism**, so each narrowed run used **all three** affected suites (shell, patients directory,
patients page) — never one route as a proxy, which is the specific trap you flagged for this task.
M18 and M17 had already run against the full set before the instruction arrived and were not redone.

**Positive control on every route case.** The name is written into the address and **proved present**
(`expect(window.location.search).toContain("Jordan")`) before the overlay opens; the pushed entry is
**proved to exist** (`toContain("overlay=…")`) so the absence is over a rewritten entry rather than a
no-op; and each route's own parameter is proved to have **survived**, so the rewrite is shown to
narrow rather than erase.

Each of the three routes gets its own case rather than one standing in for the others — but the claim
is worth stating precisely, because "all three routes are exercised independently" was generous. The
cases call `openWorkspaceOverlay` with three different pathname strings; that is **one function with
three inputs, not three mounted routes**. The mount is real and is verified elsewhere (the shell is
imported by exactly the four `/caring-contacts` pages), so the composed claim holds — the test alone
does not establish it.

| id      | mutation                                                          | selection             | predicted                                                                | observed                                                                                                                | verdict                                       |
| ------- | ----------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **M18** | stop stripping — `overlayUrl` back to copying with set/delete     | full `test:cc-guards` | all three route cases plus the close case redden                         | `the pushed entry carries "Jordan+Nguyen"` on home, wizard and overview, plus `the replaced entry carries …` — 4 failed | RED as predicted                              |
| **M17** | rebuild by copying — `new URLSearchParams(incoming)`              | full `test:cc-guards` | the same three, plus the fixed-point case                                | those four plus `expected 'q=Jordan+Nguyen&state=active&overlay=…' not to contain 'Jordan+Nguyen'` — 5 failed           | RED as predicted                              |
| **M19** | allowlist omits `plan`                                            | 3 suites (79 tests)   | the coverage guard, and the overview route loses its own parameter       | `CARING_CONTACTS_PLAN_QUERY_PARAM ("plan") is not recognised` and `expected null to be 'plan-1'` — 2 failed             | RED as predicted                              |
| **M21** | `overlay: null` keeps the existing overlay instead of removing it | 3 suites (79 tests)   | only the close case reddens                                              | `expected '?overlay=consent-and-withdrawal' not to contain 'overlay'` — 1 failed                                        | RED as predicted                              |
| **M20** | reorder the allowlist (`overlay` last)                            | 3 suites (79 tests)   | GREEN — every assertion reads by name or by substring, never by position | `Test Files 3 passed (3)` / `Tests 79 passed (79)`                                                                      | GREEN as predicted — over-sensitivity control |

M17 reddening the fixed-point case and M18 not is the difference between the two: copying is still
idempotent when the copy happens inside the canonicaliser, and is not when it happens in the caller.

**Two coverage gaps this round did NOT close, and my round-3 text implied it had.**

- `tests/caring-contacts-overlay-host.dom.test.tsx` and
  `tests/caring-contacts-overlay-trigger.dom.test.tsx` are the existing behavioural suites for
  `openWorkspaceOverlay` and `closeWorkspaceOverlay` — the two functions this round changed — and
  **neither is in `cc-guards`**. So they ran in neither the narrowed mutation runs nor the "full"
  gate. Putting the new assertions in the shell suite closed the hole for the NEW tests and did
  nothing for the old ones, which is not what my write-up said. The reviewer read overlay-host's seeds
  and judges breakage very unlikely — every address it stages carries only `overlay` — but that is a
  mitigation, not coverage. Both suites are being added to `cc-guards` at the merge. This is the
  second time in this task that a suite missing from that gate has mattered.
- **Assertions in this round that nothing mutated**, itemised because round 2 itemised its one and
  round 3 did not:
  - `expect(window.location.pathname).toBe(route.path)` — no mutation changed the pathname;
    `overlayUrl` preserves it in the fixed and the copying forms alike.
  - `expect(once).not.toBe("")` — a non-emptiness precondition on the fixed-point case.
  - the idempotence equality itself, `expect(twice).toBe(once)` — **M17 leaves it green by
    construction**, because a copy performed inside the canonicaliser is still idempotent. What M17
    reddens on that case is the name assertion beside it, not this one.
  - `expect(declared.length).toBeGreaterThanOrEqual(2)` — the allowlist-coverage floor. It reddens on
    a rename of either exported constant, which no mutation performed.

  All four are low-value and none is load-bearing for the privacy property. Listing them is the point:
  an unmutated assertion is unproven, whatever its author believes about it.

**A note against the narrowed runs, since it is the honest limit:** a per-mutation narrowed run cannot
see collateral damage outside its three suites, and does not claim to. The full `test:cc-guards` on the
final tree is what covers that, and it is in the table below.

**Refusals.** 25 during the round-3 baseline (typecheck ran on attempt 24), 3 across M18/M17, and 13
across the narrowed set — every one recorded as UNRUN and retried, none forced. One background run was
cancelled mid-mutation by me; it left M18 applied, which `git status` caught immediately and an
explicit `git checkout -- <path>` restored before anything else ran.

## Round 3 gates, on the final tree

Run against commit `5a0a68370`, which contains every source, test and generated-document change in
this round.

| Gate                                                         | Decisive line                                                                 |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `npx prettier --check` over every file this round touched    | `All matched files use Prettier code style!`                                  |
| `npx eslint` uncached (cache directory removed first)        | `files linted: 10 errors: 0 warnings: 0`                                      |
| `npm run typecheck` (`GATE_RECEIPTS=refresh`)                | `[gate-receipts] recorded a pass for "typecheck:internal" (5503 input files)` |
| `npm run test:cc-guards` (`GATE_RECEIPTS=refresh`), **full** | `Test Files  18 passed (18)` / `Tests  418 passed (418)`                      |

The only content added after that run is this section, which none of the four gates reads. Named this
way rather than as "re-run on the final tree", for the reason round 2 recorded: the last edit of any
round cannot be covered by a gate run before it, so the honest form is to name the commit the verdict
covers and the delta that follows.

### Two things the uncached lint and the refusal detector caught, both mine

**The uncached lint found a real defect my own edit introduced.** Deleting the tautological equality
pin left its import behind: `'PATIENTS_DIRECTORY_OVERLAY_PARAM' is defined but never used`. A cached
ESLint run would not have re-examined that file, and nothing else in the pyramid looks at unused
imports — this is precisely the case the "clear the cache or use `npx eslint`" rule exists for. Fixed
in `5a0a68370`, and the gates above are the run that followed it.

**My own refusal detector mislabelled a refusal as a run**, which is worth recording because it is the
shape this programme keeps meeting. There are TWO refusal messages, not one: `run-heavy.mjs` prints
`DATABASE_HEAVY_RUN_ADMISSION_BUSY`, while `run-vitest.mjs` and the lock module _throw_, so the output
ends `Error: Database focused-test capacity is full …` / `Node.js v24.19.0` with no marker at all. My
retry loop grepped for the marker only, so a thrown refusal fell through the `else` branch and was
reported as "ran on attempt 7" with a Node stack trace as its evidence. Nothing downstream would have
noticed: a refusal reported as a run is a gate that never happened wearing the label of one that did.
The detector now matches both shapes, and the table above is from the corrected run.

### Refusals across round 3

Recorded as UNRUN, retried, never forced. Baseline: 25 (typecheck ran on attempt 24). M18 and M17: 3.
The narrowed set: 13. Final re-verify: 4 after the detector fix, plus one mislabelled refusal before
it. A fifth worktree joined partway through — `C:\Users\joshs\.codex\worktrees\remove-followup-suggestions`
holding an exclusive Playwright lease — alongside `cc-schedule`, `cc-plan-detail` and `care-plan-impl`.
