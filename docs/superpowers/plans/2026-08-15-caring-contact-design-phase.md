# Caring Contact Coordination Design Phase Implementation Plan

> **Execution note:** This plan is the design-only tranche of
> `2026-08-14-caring-contact-coordination-rollout.md`. It creates a complete synthetic mockup
> suite and developer handoff. It does not create production caring-contact routes, patient-data
> APIs, persistence, provider integrations, migrations, deployments, or real-patient capability.

**Goal:** Produce the repository-native, clinically bounded, responsive design specification and
complete synthetic visual suite required to approve the Caring Contact Coordination workspace for
later production implementation.

**Architecture:** Keep every rendered artefact under `/mockups/caring-contacts` and every fixture
under `src/components/caring-contacts/mockups/`. Use the repository root `.ckb-v2` layer, current UI
primitives, Lucide icon vocabulary, `Sheet`/`ConfirmDialog`, and mockup-only browser project. A small
client controller owns screen switching and overlay specimens; individual screens remain focused,
typed components. No mockup module may be imported by production code.

**Tech stack:** Next.js App Router, React 19, TypeScript, Tailwind utilities backed by existing CSS
tokens, Lucide React, Vitest/Testing Library, repository-wrapped Playwright.

**Execution constraints:**

- Use only obviously fictional people, identifiers, phone numbers, teams, messages and events.
- Do not call a provider, Supabase, OpenAI/RAG, a hospital system, or any production API.
- Do not commit, stage, push, deploy or publish; repository authority is required separately.
- Preserve the untracked approved master plan and all unrelated work.
- Use `apply_patch` for file edits and repository wrappers for verification.
- Treat the clinical boundary documents and approved decision lock as binding, not illustrative.
- At each task boundary, run a specification review and a code/visual-quality review before the next
  task begins.

---

### Task 1: Freeze the design, clinical and governance contracts

**Files:**

- Create: `docs/superpowers/specs/2026-08-15-caring-contact-coordination-design.md`
- Create: `docs/caring-contacts/repository-design-audit.md`
- Create: `docs/caring-contacts/clinical-boundaries.md`
- Create: `docs/caring-contacts/governance-decisions.md`
- Reference: `docs/superpowers/plans/2026-08-14-caring-contact-coordination-rollout.md`
- Reference: `docs/design-system/SPEC.md`
- Reference: `docs/design-system/TOKENS.md`
- Reference: `docs/design-system/COMPONENTS.md`
- Reference: `docs/design-system/GATES.md`

**Step 1: Write the binding design specification**

Record the chosen information architecture, action-first Today hierarchy, activation workflow,
patient/episode boundaries, schedule model, desktop/phone navigation, continuity-thread treatment,
screen inventory, overlay inventory, content hierarchy and responsive layout states. Explicitly mark
the suite as a design prototype using synthetic data.

**Step 2: Record the repository source-of-truth audit**

Map the new suite to current tokens, UI primitives, mockup routing, browser-project isolation and
rendered visual sources. Name deprecated or unsuitable directions: shared search composer, RAG
routes, browser-local patient storage, decorative clinical colours, risk-ranked queues and copied
Psychbase styling.

**Step 3: Record clinical-language boundaries**

Define the exact distinctions the UI must preserve: transport state is not patient safety; a caring
contact is not monitoring, crisis response or replacement clinical care; pending referrals retain
referring-team ownership; delivery cannot imply receipt or wellbeing; objective eligibility never
becomes inferred risk. Include approved sender, one-way, emergency and first-message wording rules.

**Step 4: Record governance decisions and explicit residual risks**

Capture the approved pilot team/service, handover acceptance, source-system mobile suitability,
AU-only hosting boundary, audit split, incident stop/restart authority, no numeric pilot cap, webhook
reconciliation choice, reporting suppression and non-production design limit.

**Step 5: Verify documentation**

Run:

```powershell
npm run docs:check-links
npm run docs:check-scripts
npx prettier --check docs/superpowers/specs/2026-08-15-caring-contact-coordination-design.md docs/caring-contacts/repository-design-audit.md docs/caring-contacts/clinical-boundaries.md docs/caring-contacts/governance-decisions.md
```

Expected: all commands exit 0; no placeholder tokens remain.

---

### Task 2: Build the mockup foundation, shell and continuity language

**Files:**

- Create: `src/app/mockups/caring-contacts/page.tsx`
- Modify: `src/app/mockups/mockups-layout-client.tsx`
- Create: `src/components/caring-contacts/mockups/index.ts`
- Create: `src/components/caring-contacts/mockups/types.ts`
- Create: `src/components/caring-contacts/mockups/fixtures.ts`
- Create: `src/components/caring-contacts/mockups/caring-contact-design-suite.tsx`
- Create: `src/components/caring-contacts/mockups/caring-contact-shell-frame.tsx`
- Create: `src/components/caring-contacts/mockups/foundation-board.tsx`
- Create: `src/components/caring-contacts/mockups/continuity-thread-specimen.tsx`
- Create: `src/components/caring-contacts/mockups/mockup-primitives.tsx`
- Test: `tests/caring-contact-mockups.dom.test.tsx`

**Step 1: Add failing foundation contract tests**

Assert an exact synthetic-data marker, five desktop destinations, four phone destinations, More-sheet
destinations, one continuity thread plus chronological alternative, approved schedule times, no
clinical-risk score, and no inbound/reply affordance.

**Step 2: Create typed fictional fixtures**

Define mock-only patients, referrals, episodes, pathways, contacts, templates, delivery events, team
members and audit events. Make fiction obvious in visible names and IDs. Export no production model.

**Step 3: Build a repository-native shell**

Desktop exposes Today, Patients, Schedule, Templates and More; phone exposes Today, Patients,
Schedule and More. The suite has one `<h1>`, a synthetic-data banner, real buttons for screen changes,
and a labelled More sheet. Suppress the global search composer/chrome only for this mockup family.

**Step 4: Build the foundation board and continuity specimen**

Show inherited surface/type/spacing/action/status roles, plain operational vocabulary, component
state examples and the approved widening cadence. The thread is neutral schedule geometry and never
changes for clinical risk, delivery result or patient behaviour. Pair it with an accessible ordered
list.

**Step 5: Run focused proof**

Run:

```powershell
npm test -- --run tests/caring-contact-mockups.dom.test.tsx
npm run typecheck
npx prettier --check src/app/mockups/caring-contacts/page.tsx src/app/mockups/mockups-layout-client.tsx src/components/caring-contacts/mockups tests/caring-contact-mockups.dom.test.tsx
```

Expected: focused DOM tests, typecheck and formatting pass.

---

### Task 3: Build the complete core visual suite

**Files:**

- Create: `src/components/caring-contacts/mockups/today-screen.tsx`
- Create: `src/components/caring-contacts/mockups/patient-agreement-screen.tsx`
- Create: `src/components/caring-contacts/mockups/pathway-selection-screen.tsx`
- Create: `src/components/caring-contacts/mockups/personalisation-screen.tsx`
- Create: `src/components/caring-contacts/mockups/review-activation-screen.tsx`
- Create: `src/components/caring-contacts/mockups/patient-overview-screen.tsx`
- Create: `src/components/caring-contacts/mockups/schedule-screen.tsx`
- Modify: `src/components/caring-contacts/mockups/caring-contact-design-suite.tsx`
- Modify: `tests/caring-contact-mockups.dom.test.tsx`
- Create: `tests/ui-caring-contact-mockup.spec.ts`
- Modify: `playwright.config.ts`
- Modify: `tests/playwright-project-isolation.test.ts`
- Modify: `package.json`

**Step 1: Extend failing contracts for the core inventory**

Assert all seven screens, `Referrals to review` dominance, distinct Needs action and sending-window
sections, pending ownership wording, identity repetition, imported agreement, patient-controlled
mobile provenance, owning team, coordinator, 10:00/14:00/17:00 AWST schedule, exact message preview,
two-segment limit and one-way boundary.

**Step 2: Implement Today as a guided command centre**

Place referrals first, then named action exceptions, today's three sending windows, recent activity
and quiet metrics. Order referrals by time to first eligible window, never risk. Use identity-forward
rows and visible ownership states.

**Step 3: Implement the four activation stages**

Use the approved split composition on wide screens: persistent patient identity, focused stage and
exact patient-visible preview. On compact screens the identity stays in flow and preview opens in a
labelled sheet. Activation stays blocked until agreement, patient-controlled mobile, owning team and
coordinator are present.

**Step 4: Implement patient overview and schedule**

Patient overview leads with identity, active-plan state, owner, agreement, continuity thread and
chronological record. Schedule leads with a day and seven-day strip; named exceptions remain separate
from routine 10:00, 14:00 and 17:00 AWST windows.

**Step 5: Register focused mockup-browser isolation**

Add the new spec to the mockup project matcher and top-level matcher, update the isolation contract,
and add a repository-wrapper script named `test:e2e:caring-contact-mockup`.

**Step 6: Verify the core suite**

Run:

```powershell
npm test -- --run tests/caring-contact-mockups.dom.test.tsx tests/playwright-project-isolation.test.ts
npm run typecheck
npm run test:e2e:caring-contact-mockup
```

Browser proof must cover 320, 390, 768 and 1440 CSS-pixel widths; no horizontal overflow; usable
keyboard focus; More and preview sheets; desktop/phone schedule; reduced motion; forced colours.

---

### Task 4: Build the completion suite and full component/state specimens

**Files:**

- Create: `src/components/caring-contacts/mockups/patient-boundary-screens.tsx`
- Create: `src/components/caring-contacts/mockups/template-screens.tsx`
- Create: `src/components/caring-contacts/mockups/delivery-exception-screens.tsx`
- Create: `src/components/caring-contacts/mockups/team-guidance-reporting-screens.tsx`
- Create: `src/components/caring-contacts/mockups/overlay-specimens.tsx`
- Create: `src/components/caring-contacts/mockups/component-state-specimens.tsx`
- Modify: `src/components/caring-contacts/mockups/caring-contact-design-suite.tsx`
- Modify: `tests/caring-contact-mockups.dom.test.tsx`
- Modify: `tests/ui-caring-contact-mockup.spec.ts`

**Step 1: Add failing inventory and safety assertions**

Require search/empty/duplicate/readmission/deceased/wrong-recipient/contact-changed/pause/withdrawal/
cancel states; plan/contact detail; templates and approvals; delivery drawer/sheet; team; guidance;
suppressed reporting; dialogs/drawers/sheets; loading/empty/error/offline/auth/permission/conflict states;
and reusable component specimens.

**Step 2: Implement remaining full-page surfaces**

Keep identity-forward search restricted to pilot-team records. Separate permanent transport failure
from clinical action. Show source write-back, audit and owner visibility without raw patient details
in transient alerts. Render reporting suppression as `Suppressed`, never zero.

**Step 3: Implement overlay and responsive exception patterns**

Delivery exceptions use a contextual right drawer on desktop and a full-screen phone sheet. Identity,
withdrawal, activation and conflict decisions use named dialogs or full-screen stages with explicit
focus return. No toast contains patient name, ID, phone number or message.

**Step 4: Implement component state specimens**

Cover default, hover, active, focus-visible, disabled/unavailable, busy, invalid, empty, long-content,
compact, dark, forced-colour and reduced-motion states. Use adjacent wording/non-colour marks for
every status.

**Step 5: Verify completion**

Run the Task 3 focused DOM, type and browser commands again. Expected: the exact full inventory is
reachable from the suite, every overlay closes and restores focus, and no viewport overflows.

---

### Task 5: Complete clinical, accessibility, responsive and developer handoff review

**Files:**

- Create: `docs/caring-contacts/content-style-guide.md`
- Create: `docs/caring-contacts/clinical-language-review.md`
- Create: `docs/caring-contacts/accessibility-acceptance.md`
- Create: `docs/caring-contacts/design-handoff.md`
- Modify: `docs/superpowers/specs/2026-08-15-caring-contact-coordination-design.md`
- Modify only if generated contract requires: design-system adoption/generated documentation

**Step 1: Review every screen against the clinical boundary**

Search rendered and source copy for monitoring, safety, risk inference, response/reply, delivery
certainty, transferred ownership before acceptance, crisis-service implication, coercive agreement
and diagnostic eligibility. Record each reviewed phrase and outcome.

**Step 2: Review accessibility and responsive continuity**

Record 320px/400% reflow, 390/430/768/1024/1440 widths, keyboard sequence, focus restoration,
screen-reader names/roles/states, status redundancy, text sizing, safe-area behaviour, dark, forced
colours and reduced motion. Record physical iPhone Safari/installed-PWA work as unrun and required
later; Chromium cannot close it.

**Step 3: Produce the developer handoff**

Map every approved screen to its future route, domain components, states, fixture, production data
contract and safety invariant. Freeze the screen/state inventory and list explicit non-goals and
future authority gates.

**Step 4: Run final proportional gates**

Run:

```powershell
npm run format
npm test -- --run tests/caring-contact-mockups.dom.test.tsx tests/playwright-project-isolation.test.ts
npm run typecheck
npm run check:design-system-contract
npm run docs:check-links
npm run docs:check-scripts
npm run test:e2e:caring-contact-mockup
npm run verify:ui
npm run check:production-readiness
```

Expected: all applicable local commands pass. If an existing broad gate fails, compare with a clean
current-main baseline before classifying it. Do not run provider-backed or live clinical checks.

**Step 5: Capture final visual evidence**

Create desktop and phone screenshots for the foundation, Today, activation, patient overview,
schedule, delivery exception and component/state board. Keep screenshot fixtures synthetic and place
temporary evidence outside tracked product paths unless the repository contract explicitly requires
committed baselines.

**Exit gate:** The design specification, complete desktop/phone synthetic suite, clinical-language
review, accessibility record and developer handoff agree with the approved decision lock and current
repository design system. Production implementation remains a separately authorised phase.
