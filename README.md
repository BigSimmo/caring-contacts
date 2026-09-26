# Caring Contacts (standalone copy)

This folder holds Caring Contacts on its own. It was pulled out of the PsychSift repository
(`BigSimmo/Database`, `main` at commit `f75eeb11e`, 25 September 2026) and contains Caring
Contacts, everything it needs to run, and the related tests, documents and tooling. Nothing
else from PsychSift is included, and the original repository was not changed.

**It is a synthetic prototype.** Every patient, phone number and message in it is invented,
and nothing is ever sent to a real number. It is not approved for real patients.

## What is in here

| Folder                                                                        | What it is                                                                                                                                                                                           |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/caring-contacts/`                                                    | The working app pages: Today, Patients, Schedule, New plan, Templates, Team, Reports, Guidance, Intake                                                                                               |
| `src/app/api/caring-contacts/`                                                | The server side the pages talk to (plans, contacts, referrals, schedule, team, and so on)                                                                                                            |
| `src/lib/caring-contacts/`, `src/lib/caring-contacts-server/`                 | The rules and data handling: schedules, message wording rules, permissions, audit trail, retention, the in-memory demo store and the Postgres store                                                  |
| `src/components/caring-contacts/workspace/`                                   | The screens and parts of the working app                                                                                                                                                             |
| `src/app/mockups/caring-contacts/`, `src/components/caring-contacts/mockups/` | The clickable design prototypes                                                                                                                                                                      |
| `caring-contacts/supabase/migrations/`                                        | The database tables and security rules (12 files)                                                                                                                                                    |
| `tests/`                                                                      | 98 test files: 92 quick checks, 2 database checks and 4 browser journeys, plus helpers                                                                                                               |
| `docs/caring-contacts/`                                                       | Design notes, hazard log, governance checklist, copy review, build records, handovers, screenshot atlas, `architecture.md` (how it is built) and `issues-snapshot.md` (its open and resolved issues) |
| `docs/superpowers/`                                                           | The original design specifications and phase plans (8 files)                                                                                                                                         |
| `docs/` (other)                                                               | Crisis-line records, the sovereign-hosting specification, and the design-system entry for the workspace                                                                                              |
| `deploy/australia/`                                                           | The Australian-hosted deployment blueprint                                                                                                                                                           |
| `.github/workflows/ci.yml`                                                    | Automatic checks (type check, tests, build, and the database tests) if this folder is put in its own GitHub repository                                                                               |

### Shared pieces that came along, and why

Caring Contacts uses these, so they are included unchanged:

- **Screen parts:** buttons, chips, the slide-over panel, the confirm dialog, text headings,
  the overlay layer, the unsaved-changes guard and screen-reader announcements
  (`src/components/ui/`, `src/components/ui-primitives.tsx`, `src/components/primitive-recipes/`,
  `src/components/app-announcements.tsx`, `src/components/route-error-boundary.tsx`).
- **Small helpers:** request and error handling, input checking, logging, privacy helpers,
  copy-to-clipboard, and the search-engine (robots) settings (`src/lib/`).
- **Safety settings:** cross-site request blocking (`src/lib/api-csrf.ts`) and the browser
  security headers (`src/lib/security-headers.ts`).
- **Look and feel:** the stylesheets (`src/app/globals.css`, `src/app/ckb-v2-tokens.css`), the
  fonts (`src/fonts/`) and the light/dark theme switch (`src/lib/theme.ts`).
- **Test tools:** the test set-up files, the offline test environment
  (`scripts/test-environment.mjs`) and the database test runner.

## How to run it

You need Node 24 installed (the exact version is in `.nvmrc`). In a terminal, inside this folder:

```
npm install
npm run dev
```

Then open http://localhost:3000. It opens straight into Caring Contacts. The design
prototypes are at http://localhost:3000/mockups/caring-contacts.

It starts with a few invented example patients already in it, so every screen has
something to show.

In a production build (`npm run build` then `npm start`), the workspace and the prototypes
stay closed unless they have been deliberately switched on. That is a safety rule, not a fault.

## How to check it

```
npm run check      # type check, code style (lint), formatting and all quick tests in one go
npm run test:e2e   # the browser journeys
```

`npm run lint`, `npm run format:check` and `npm run format` (which fixes formatting) can also
be run on their own.

`npm run test:e2e` builds a private test copy of the app, starts it, and clicks through the
four browser journeys. It needs a Chromium browser. If one is not already installed, run
`npx playwright install chromium` once. To use a Chromium already on the computer instead,
set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its path.

The database checks need a throwaway local Postgres, never a live database. With one running:

```
CARING_CONTACTS_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npm run caring-contacts:db:test
```

## What was checked when this copy was made

- Type check: clean.
- `npm test`: 92 files, 1,753 tests passed, 2 skipped.
- Database checks on a fresh local Postgres 16: 222 passed, 1 skipped.
- `npm run build`: succeeds, and builds every Caring Contacts page and API route.
- Browser journeys: 201 passed, 1 skipped. The skipped one only refreshes the screenshot
  atlas on request.
- Opened in a browser: the Patients screen (with example patients) and the design prototype's
  Today screen both displayed correctly.
- Australian hosting container: built and smoke-tested on 26 September 2026 (see below).

The 3 skipped tests are explained under point 6 below.

## What had to change to stand alone

Everything is copied as-is except the following, each marked with a "Standalone extract"
comment in the file:

1. **New or trimmed wrapper files**, because the originals belong to the whole PsychSift site:
   - `src/app/layout.tsx`: the page frame, with fonts, theme and announcements.
   - `src/app/page.tsx`: opens Caring Contacts.
   - `src/proxy.ts`: runs on every request. It keeps PsychSift's cross-site request blocking and
     per-request content security policy, and closes the prototypes in production.
   - `src/instrumentation.ts`: the start-up safety checks. The server refuses to start if
     demo mode is switched on in a real production build, or if live mode is half set up.
   - `next.config.ts` (security headers), `vitest.config.mts`, `playwright.config.ts`,
     `package.json`, `.env.example`, `src/app/mockups/mockups.css`,
     `scripts/run-vitest.mjs` (keeps the rule that database tests only ever touch a
     database on this computer) and `scripts/run-browser-tests.mjs`.
2. **The design prototypes no longer sit behind PsychSift's admin sign-in screen.** They are
   open when running locally and closed in production unless
   `CARING_CONTACTS_MOCKUPS_ENABLED=true` is set. They contain invented data only.
3. **`src/components/ui-primitives.tsx`** no longer includes PsychSift's clinical-source badges.
   Caring Contacts never used them, and they would have pulled in most of the knowledge base.
4. **Tests adapted from PsychSift-wide files:** start-up checks, robots settings, security
   headers, the database-test safety rule and the screen-list check. Each file says at the top
   what was kept and what was dropped. Only parts about PsychSift features were dropped.
   `tests/proxy.test.ts` is new and tests the new `src/proxy.ts`.
5. **Trimmed reference files:** `docs/design-system/adoption-contract.json` holds only the Caring
   Contacts entry, `docs/caring-contacts/architecture.md` is the Caring Contacts section of
   PsychSift's code map, and `docs/caring-contacts/issues-snapshot.md` holds the Caring Contacts
   rows of PsychSift's issue list.
6. **Three tests are skipped.** They check that Caring Contacts' database files are kept out of
   PsychSift's own folder, and PsychSift's shared prototype layout, so there is nothing for them
   to check here.
7. **The Australian hosting blueprint** (`deploy/australia/`) was adapted to build this folder.
   The PsychSift-only install steps, Supabase and Sentry settings were removed, and its health
   check now points at the Caring Contacts readiness check.

## Known gaps carried over from PsychSift

- **Live mode now has staff sign-in, but is not approved for real patients.** Live mode is the
  real-patient setting. Staff sign in through the health service's own identity provider (OpenID
  Connect); set-up steps are under "Staff sign-in" in `deploy/australia/README.md`. It still needs
  the governance sign-off and the other items below. Sign-in was issue #96R2JZ in
  `docs/caring-contacts/issues-snapshot.md`.
- **Nothing clears a half-written plan in the browser when a different person signs in on the
  same computer.** In PsychSift, its own sign-in system triggered that clean-up.

## Left behind on purpose

The following were left out:

- PsychSift's knowledge base, search, medications, services, Ward Flow, Care Plan and every
  other feature.
- PsychSift's sign-in system and Sentry error reporting.
- The PsychSift-wide records: the full issue and review ledgers.

Some Caring Contacts documents link to PsychSift files that are not here, so those links will
not open in this copy.

## Review and fixes, 25 September 2026

This copy was reviewed for design, behaviour, logic and stand-alone use. Changes:

**Screens**

- "New plan" now lists every accepted referral still waiting for a plan, each with a "Start a
  plan" button, instead of a page with no way forward.
- The side menu, phone bottom bar and "More destinations" panel show which screen is open, and
  Referral intake is now reachable from "More destinations".
- Today's "Needs review" card counts every contact needing review, not only today's, so an old
  failed message can no longer show as "Clear".
- Today shows the real sending times, plain words instead of internal codes, and a readable
  "oldest waiting" time. Its tags, patient codes and tables no longer break on a phone or desktop.
- One name for each action everywhere ("New plan", "Referral intake").
- Referral intake form: no zoom-in on phones, finger-sized controls, number keypad for the mobile
  box, required fields announced to screen readers, and plain button labels.
- Browser tab titles no longer mention PsychSift.

**Logic (each with a new test)**

- A contact can only be moved while it is still waiting to be sent; a sent, sending or cancelled
  contact is refused.
- A moved contact must land on a real date and not on the same day as another contact in the plan.
- A plan can no longer be created on a missing, declined or unaccepted referral, a referral for a
  different patient, or a retired pathway.
- Bad input (a blank name, an ID that looks like a phone number, an end date before a start date)
  now gets a clear refusal instead of a server error.
- Discharge times must include a time zone, so the ten contact dates cannot shift by a day
  depending on where the server runs.
- Handing a plan to the person who already holds it is refused.
- Pathway approvals must come from someone who actually holds that approval role, in their own
  name.

**Stand-alone project**

- Added `.nvmrc`, `.editorconfig`, `.dockerignore`, ESLint and Prettier, with `lint`, `format`,
  `format:check` and `check` scripts.
- Automatic checks on GitHub now also run lint, formatting and the browser journeys.
- Removed PsychSift-only settings from the Australian hosting setup.

**Checked after the changes**

A separate check started from a fresh copy of this folder:

- Type check, lint and formatting: clean.
- `npm test`: 92 files, 1,771 tests passed, 2 skipped.
- Database checks on a fresh local Postgres 16: 226 passed, 1 skipped.
- `npm run build`: succeeds.
- Browser journeys: 199 passed, 1 skipped, 2 failed. Both failures were one test finding two
  "New plan" links on an empty Today screen. The test was then narrowed to the header's link
  and that test passes on its own; the full browser run was not repeated.
- Running locally opens the workspace; a production build keeps it closed.

**Still open at the time (all were resolved on 26 September; see "Third round" below)**

- A plan that was never started cannot be cancelled, and it blocks any future plan for that
  patient. This needs a decision on how a draft plan should end.
- Clearing a patient's kept data happens as soon as a plan ends, not after the 7-year retention
  period. Nothing calls it yet, but the rule should be decided.
- The service-restart approval roles (incident lead, privacy owner) are claimed, not checked.
- Moving a contact to a time earlier today that has already passed is allowed.
- Live mode now has staff sign-in (see "Known gaps" above); it is tested only against an offline stand-in provider.

## Second round of testing and fixes, 26 September 2026

Three independent checks were run on a fresh copy: every automatic test, a first build of the
Australian hosting container, and hands-on use of every screen on phone and desktop. Fixes:

**Australian hosting container**

- It now builds and runs, and passes its health check as a non-root user.
- The settings file (`env.australia`) was being silently overridden with blanks; it is now used.
- The image is about 0.5 GB smaller, and the secrets file is kept out of git.

**Server**

- Saving a referral no longer crashes when the hospital record number looks like a phone number.
- Referral intake refuses unknown cohorts or hospitals, over-long text, hidden control characters,
  and discharge dates more than 90 days ago or in the future.
- Creating a plan requires a valid Australian mobile and both assurances, and refuses a discharge
  more than 90 days ago or in the future.
- A message still waiting more than an hour after its send time is now flagged as needing review
  on Today, Team and Schedule, instead of showing as "due to send" forever.

**Screens**

- The referral form no longer opens with invented ward and safety alerts filled in.
- An ended plan no longer says it "continues with the messages that remain", and no longer offers
  Hold, Withdraw or Move.
- The Hold dialog now matches what holding actually does, with one name ("Hold") throughout.
- The plan sign-up refuses the same mobile numbers intake refuses, says truthfully whether details
  came from the referral, and limits the discharge day to the last 90 days.
- A "Skip to main content" link, a clearer keyboard focus ring on form fields, and an app icon.

**Checked after the fixes**

- Type check, lint and formatting: clean. `npm test`: 94 files, 1,812 passed, 2 skipped.
- `npm run build`: succeeds. Browser journeys: full run, no failures.
- Database checks (before the second-round fixes, which did not change the database files):
  226 passed, 1 skipped.

What is still needed, including everything to run it for real patients (sign-on, text-message
provider, hosting, backups, monitoring), is listed in `docs/NEXT-STEPS.md`.

## Third round: building the recommendations, 26 September 2026

The owner approved building every recommendation. Where a decision was needed, the recommended
option was taken; each is listed in `docs/NEXT-STEPS.md`, which also lists what only the owner can
do (accounts, credentials and sign-off).

**Built**

- **Staff sign-in for live mode** through the organisation's identity provider (OpenID Connect),
  with a Sign out button. Live mode now starts once sign-in is set up.
- **Text-message sending.** Simulated by default, so nothing is ever sent unless it is switched
  on. A Telstra Messaging API connection, checked against Telstra's published toolkits, a
  background sender that sends each message in its window and never twice, and a delivery-report
  address. The server refuses to start if real sending is half set up or switched on in demo mode.
- **Each patient's own name** in messages (the demo pathway's message no longer says "Hi Rowan"
  to everyone). A message type with no approved wording is never sent; it is marked for review.
- **Cancel a plan that never started**, so it no longer blocks a future plan.
- **Claim a plan**, from the plan screen or the Team screen's "Take on unclaimed work" list.
- **An optional reason when a plan is withdrawn** (new database file 0012).
- **Decisions taken:** patient details are kept for 7 years after a plan ends; restarting after a
  safety stop needs different named people who each hold the approving role; a message cannot be
  moved to a time that has already passed.
- **Quicker fixes:**
  - Duplicate referrals are refused.
  - The New plan list shows names, discharge dates and hospitals.
  - The dashboards agree with each other.
  - Each screen has its own tab title, and every destination is in the desktop menu.
  - The Schedule has previous and next week buttons.
  - Confirmation boxes show what is being confirmed.
  - A closed production workspace returns a proper "not found".

**Checked after building** (one run, from a fresh unzip and clean install)

- Type check, lint and formatting: clean.
- `npm test`: 100 files, 1,980 passed, 2 skipped.
- Database checks on a fresh local Postgres 16: 243 passed, 1 skipped.
- `npm run build`: succeeds, with no warnings.
- Browser journeys: 201 passed, 1 skipped (the screenshot-atlas refresh, which runs only on request).
- Not re-run this round: the Australian container build (it built and ran in the second round;
  this round added one small library, `jose`, for sign-in). Sign-in and Telstra sending are tested
  only against offline stand-ins, never a real provider.

## Staff alerts and the health check

Staff alerts are now actually sent, and the health check notices when the background sender stops.

- **What an alert says.** Only the kind of problem, how many items, a fixed reason and the team,
  for example "2 items affected by permanent delivery failure". Never a patient's name, number or
  message.
- **Where it goes.** Staff sign-in keeps no email address or phone number, so alerts go to one team
  channel (a Teams or Slack incoming webhook, or an email relay). Until that address is set, alerts
  are only kept in memory and written to the log. The settings are in `.env.example`.
- **Which alerts go.** Failed deliveries and messages that need checking go only when someone in
  the team has switched that alert on. Three safety alerts always go: a safety stop was raised, the
  background sender has stopped, or the text-message carrier is limiting how fast we can send.
- **No repeats.** The same alert is sent at most once an hour while the problem continues.
- **The health check** (`/api/caring-contacts/ready`) now says whether the sender is running. With
  real text messages or live mode on, it reports the service as not ready when no sender run has
  finished for 15 minutes, and sends the "sender stopped" alert. In the demo it only reports.
- **Carrier limits.** If the carrier says "too many requests", that run stops sending; the other
  due messages go on the next run, still inside their sending hours.

New database file 0020 holds the sender's last-run time and when each alert was last sent. Full
details for the people running it: `deploy/australia/README.md`, "Staff alerts and the sender
health check".
