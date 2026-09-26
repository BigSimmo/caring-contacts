# Task 5 brief — the Patients directory (absorbing Task 4)

**Plan:** `docs/superpowers/plans/2026-08-24-caring-contact-phase-2b-screens.md`, Group 1, Task 5.
**These are your requirements.** Read Rulings 85 and 89 in `docs/caring-contacts/phase-2b-build-record.md`
first — they are why this task is shaped the way it is.

Caring Contacts is a suicide-prevention prototype: patients discharged from hospital receive a fixed
schedule of brief, non-demanding messages. Every patient is fictional and **nothing is ever sent to any
number**. This is the **first real screen of Phase 2B** and the owner's first priority.

## What you are building

`src/app/caring-contacts/patients/page.tsx` — the team's caseload, listing the plans this actor's team
may see, plus the navigation and documentation that make it a real destination.

**Task 4 was merged into this one (Ruling 89).** The plan originally lit up the navigation link with an
empty placeholder page first. That page would have said _"No patients yet"_ whether or not patients
existed — a false statement on a clinical caseload screen, and precisely the defect the component you
are about to use was built to prevent. So the link and the real screen land together, and the screen is
never reachable in a state where it can lie.

## Do NOT build a data source — it exists (Ruling 85)

`GET /api/caring-contacts/plans` already lists the team's plans through `readHandler`. More directly,
**your page is a Server Component and should read the store the same way the Today page does**, not
over HTTP.

**Read `src/app/caring-contacts/page.tsx` before writing anything.** It is heavily commented and is the
established pattern: `isCaringContactsDemoEnabled()` then `notFound()`; `resolveDemoActor()`;
`caringContactsStore()`; the read wrapped in `auditedRead`; fail closed on every bad outcome; then
render `<CaringContactsShell title description serviceState>`.

Your page needs **two** audited reads — the service state (so the safety banner can render, which is a
required prop on every screen) and the plans list. Use the same access identity the API route already
records for each, so the access trail does not grow a second vocabulary for the same read:

- service state — `{ kind: "administrative", objectType: "serviceState", objectId: "service" }`
- plans — `{ kind: "search", objectType: "plan", objectId: "all" }` and `store.listPlans({ actor })`

**Do NOT call `getEpisode`.** It is the only read that releases `patientDetail` — name, mobile number,
identifiers, cultural identity — and a directory does not need them. If the approved design appears to
show a patient's name in the list, **stop and report it** rather than reaching for `getEpisode`; that
is a question for me, not a decision for the implementer. Every other read returns `PlanRecord`, which
excludes patient detail by construction.

## The empty-list contract test — the one thing that survived the cut of Task 2

`auditedRead` maps a `null` or `undefined` release to `denied`, which `readHandler` turns into
`not-found`. **An empty array is neither**, and an empty caseload must never present as a missing
resource.

Write a test pinning that **an empty list renders the empty state on a 200-shaped success path, never a
404 / `notFound()`**. This is not obvious from reading the code, which is exactly why it needs a test
rather than a comment. The factory's own note says the trail cannot distinguish "you may not see these"
from "there are none" for a list — so the HTTP and render shapes must be pinned deliberately.

## Use `ListEmptyState`, and use both of its kinds honestly

`src/components/caring-contacts/workspace/list-empty-state.tsx` (Task 1). It has two kinds and they are
not interchangeable:

- `"no-data"` — the team genuinely has no plans.
- `"filtered"` — plans exist but the current filter or search hides all of them. **Requires** a
  `because` and a `changedBy`.

A filtered-empty caseload that renders `"no-data"` tells a clinician their caseload is empty when it is
not. That is the defect this whole component exists to prevent — get it right here, because this is the
first screen to use it and every later screen will copy this one.

## Filtering

Provide at least one filter or search. Keep it **server-side** if you can do so without a client
boundary — Ruling 13 holds this workspace's client payload to a rounding error, and a URL-parameter
filter read by the Server Component costs none. If you conclude a client boundary is unavoidable,
**say so in your report with your reasoning** rather than adding one quietly.

## What makes it a real destination (the absorbed Task 4)

All four, or the route is an orphan and the build fails:

1. `href: CARING_CONTACTS_ROUTES.patients` added to `PRIMARY_DESTINATIONS` in
   `src/components/caring-contacts/workspace/shell.tsx`. The file's own comment says this is the whole
   of the change. Note `PHONE_DESTINATIONS` derives from it, so the phone dock follows automatically.
2. `npm run sitemap:update`.
3. An entry in `docs/codebase-index.md`.
4. A reachability assertion — see `tests/route-reachability.test.ts`.

Build hrefs from `src/lib/caring-contacts-routes.ts`, never from string literals. It already exports
`patientRoute(patientId)` and `planRoute(planId)` for the rows.

## Constraints

- **Internal navigation** uses `<Link>` / `router.push` / server `redirect()` — never a raw
  `<a href="/…">`.
- Every `<button>` does something. A control unavailable for a stated reason uses `aria-disabled="true"`
  - an inert handler + `title="… — coming soon"` + an `sr-only` note. **Never** native `disabled` and
    `aria-disabled` together.
- Design tokens only, no hardcoded hex. Tap targets `min-h-12` (48px) — **never `min-h-11`**, which
  reintroduces a known `ui-smoke` flake.
- The service-state incident `note` must never reach a Client Component.
- No import from `src/components/caring-contacts/mockups/**`. Read them as a specification only —
  `PatientsDirectoryPage` in `mockups/product-pages.tsx` is the approved design for this screen.
- **Explained automation (spec §4.4) is a contract:** wherever the system has acted on its own —
  paused, suppressed, blocked, escalated — the surface stating it must also state, in plain words and
  in place, **why** and **what would change it**. No bare status chip with an unreachable reason.
- **The closed transport vocabulary is frozen.** `Delivered` is a transport receipt and never a
  patient-state label. Prohibited in any interface string: high risk, safe, engagement score, campaign,
  lead, conversion, best match, inbox, conversation, clinical risk, risk score, wellbeing score, and
  any claim that replies are monitored. A static scan enforces this — it caught a lucide icon named
  `Inbox` in the previous task, on the identifier alone.
- **This is Next.js 16.** Read `node_modules/next/dist/docs/` before writing route or layout code;
  it has breaking changes against most training data, and reading beats reasoning.

## Verification

- Test-first. Then deliberately break the implementation and confirm the covering test goes red —
  **check FIRST that your mutation changes a value some assertion actually reads**, and prove the
  mutation is in the tree before believing any result. Two mutation reports on this programme have
  already turned out to describe something other than what was run.
- `npm run test:focused -- --files <paths>` while iterating; then the **full `npm run test`**; then
  `npm run typecheck` and `npm run lint`.
- **Never report a gate as passing from an exit code — paste the `N passed` line.**
- **Known environmental noise, not yours:** exactly 2 failures in `tests/gate-receipts.test.ts` ("gate
  receipts — file modes", failing in `chmodSync`) because this Windows drive cannot represent Unix file
  modes. Report any others.
- **A lock-acquisition failure is neither a pass nor a failure.** If a gate cannot take the heavy-run
  lease, retry a couple of times then report which gate did not run. No summary line means no run,
  whatever the exit code says.

## Report

**Commit early — before waiting on any gate.** This machine has destroyed four working directories
mid-session and a commit is the only thing that has survived.

Write your full report to `docs/caring-contacts/phase-2b-sdd-archive/task-5-report.md`, then return
ONLY: status, commit SHAs, a one-line test summary, and your concerns. Do not paste the report into
your reply. Do not dispatch subagents. **Do not push and do not open a pull request.**
