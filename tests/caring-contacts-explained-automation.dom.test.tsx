import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { stripSourceComments } from "./helpers/strip-source-comments";

import { AutomatedState } from "@/components/caring-contacts/workspace/automated-state";
import { ServiceStateBanner } from "@/components/caring-contacts/workspace/service-state-banner";
import { CaringContactsShell } from "@/components/caring-contacts/workspace/shell";
import { CARING_CONTACTS_ROUTES } from "@/lib/caring-contacts-routes";
import { fixedClock } from "@/lib/caring-contacts/clock";
import { actorId, teamId } from "@/lib/caring-contacts/ids";
import {
  applyServiceRestartApproval,
  applyServiceStop,
  REQUIRED_RESTART_APPROVAL_ROLES,
  runningService,
  type ServiceState,
} from "@/lib/caring-contacts/service-state";

/**
 * A string that appears in the fixture's incident note and NOWHERE else.
 *
 * The reason for a sentinel rather than only the plausible literals below: a
 * name-and-number check (`/Rowan|Mira|\+61/`) only catches the leak it happened
 * to imagine. The note is free text a responder types mid-incident, so the next
 * one could name a ward, a message id, or a street — none of which those
 * literals would catch. The sentinel catches ANY path from `note` to the DOM,
 * whatever the note happens to say.
 */
const NOTE_SENTINEL = "NOTE-LEAK-SENTINEL-9F3C";

const INCIDENT_CLOCK = fixedClock("2026-08-19T02:00:00.000Z");

/**
 * A stopped service whose note carries both the sentinel and the kind of patient
 * detail a real responder would write: a name, a second name, a mobile number.
 */
function stoppedServiceState(): ServiceState {
  const stopped = applyServiceStop(
    runningService(teamId("TEAM-A")),
    {
      reason: "wrong-recipient",
      actorId: actorId("ACTOR-RESPONDER"),
      note: `${NOTE_SENTINEL} Week 3 message for Rowan went to Mira on +61 400 000 000.`,
    },
    INCIDENT_CLOCK,
  );
  if (!stopped.ok) throw new Error(`fixture could not stop the service: ${stopped.reason}`);
  return stopped.value;
}

describe("explained automation", () => {
  it("never shows a bare automated state without a reason and a remedy", () => {
    render(
      <AutomatedState
        state="Suppressed"
        because="Week 1 falls on the first contact day."
        changedBy="Move the first contact date on the plan."
      />,
    );
    const region = screen.getByRole("group", { name: /Suppressed/ });
    expect(region).toHaveTextContent("Week 1 falls on the first contact day.");
    expect(region).toHaveTextContent("Move the first contact date on the plan.");
  });

  it("puts the reason and the remedy in the page, never in a tooltip alone", () => {
    // Spec 4.4: a reason reachable only by hovering is not reachable at all for a
    // keyboard or screen-reader user. Nothing here may hold the explanation in a
    // `title` attribute instead of in text.
    const { container } = render(
      <AutomatedState
        state="Suppressed"
        because="Week 1 falls on the first contact day."
        changedBy="Move the first contact date on the plan."
      />,
    );
    for (const node of container.querySelectorAll("[title]")) {
      expect(node.getAttribute("title")).not.toContain("Week 1 falls on the first contact day.");
      expect(node.getAttribute("title")).not.toContain("Move the first contact date on the plan.");
    }
    const region = screen.getByRole("group", { name: /Suppressed/ });
    expect(region.textContent).toContain("Week 1 falls on the first contact day.");
    expect(region.textContent).toContain("Move the first contact date on the plan.");
  });

  it("shows nothing while the service is running", () => {
    const { container } = render(<ServiceStateBanner state={runningService(teamId("TEAM-A"))} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("states the reason and the approval count while stopped, with no patient information", () => {
    render(<ServiceStateBanner state={stoppedServiceState()} />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(/0 of 3/);
    expect(banner).toHaveTextContent(/wrong recipient/i);
    expect(banner.textContent ?? "").not.toMatch(/Rowan|Mira|\+61/);
  });

  it("names what would restart the service, not only why it stopped", () => {
    // Spec 4.4 has two halves and the banner owes both. The reason half is
    // asserted above; without this, `describeServiceStop`'s third sentence could
    // be deleted outright and every test on this branch would stay green — the
    // one surface that renders on EVERY screen to EVERY team would then state a
    // stop with no way out of it. Proven by deleting that sentence and watching
    // this redden.
    render(<ServiceStateBanner state={stoppedServiceState()} />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(/still needed/i);
    // All three roles, because none is recorded yet on this fixture. The count
    // comes from the sealed list rather than a second copy of the number.
    expect(REQUIRED_RESTART_APPROVAL_ROLES).toHaveLength(3);
    expect(banner).toHaveTextContent("the incident lead");
    expect(banner).toHaveTextContent("the privacy and security owner");
    expect(banner).toHaveTextContent("the clinical programme lead");
    // The restart is a three-PERSON decision, not three tick-boxes one person can
    // supply; a banner that omits this misdescribes the remedy.
    expect(banner).toHaveTextContent(/each from a different person/i);
  });

  it("cannot put the responder's incident note on screen, whatever the note says", () => {
    // The whole rendered markup, not only its text: an attribute leak (a title, an
    // aria-label, a data-*) would be just as public as a paragraph.
    // The anti-vacuity guard has to inspect the fixture that was RENDERED. A
    // freshly constructed second copy is equivalent under the fixed clock today,
    // but the guard exists precisely for the day the fixture stops being stopped,
    // and then only the rendered object tells the truth.
    const rendered = stoppedServiceState();
    expect(rendered).toMatchObject({ stopped: true });
    const { container } = render(<ServiceStateBanner state={rendered} />);
    expect(container.innerHTML).not.toContain(NOTE_SENTINEL);
  });

  it("keeps the note out of the banner on every screen the shell renders", () => {
    const { container } = render(
      <CaringContactsShell title="Today" serviceState={stoppedServiceState()}>
        content
      </CaringContactsShell>,
    );
    expect(container.innerHTML).not.toContain(NOTE_SENTINEL);
    expect(container.innerHTML).not.toMatch(/Rowan|Mira|\+61/);
  });

  it("says the service is stopped in words, so the state does not depend on colour", () => {
    render(<ServiceStateBanner state={stoppedServiceState()} />);
    const banner = screen.getByRole("status");
    // Text content is what survives greyscale, forced colours and a screen reader.
    expect(banner.textContent ?? "").toContain("Sending stopped");
    expect(banner.textContent ?? "").toContain("stopped for the whole service");
    // The icon is decoration on top of that text, never the carrier of it.
    for (const icon of banner.querySelectorAll("svg")) {
      expect(icon.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("reaches the service-stop screen through a link from the banner", () => {
    render(<ServiceStateBanner state={stoppedServiceState()} />);
    const banner = screen.getByRole("status");
    // Ruling 52 held this as an unavailable control that stated its reason until the service stop
    // screen existed. It was built on 2026-09-26 (owner request: "The emergency safety stop has no
    // button"), so the control is now a real internal link, moved in the same change (Ruling 89) --
    // and there is no longer an inert button left beside it.
    const control = banner.querySelector("a");
    expect(control, "the banner offers no way to reach the service-stop screen").not.toBeNull();
    expect(control).toHaveAttribute("href", CARING_CONTACTS_ROUTES.serviceStop);
    expect(control).toHaveAttribute("data-internal-link", "true");
    expect(banner.querySelector("button")).toBeNull();
  });

  it("gives the banner's service-stop control a name of its own", () => {
    // The More panel and the rail already carry a destination named exactly "Service stop".
    // Two controls sharing an accessible name are indistinguishable in a screen reader's
    // control list, so the banner's — the one with incident context — takes the longer name.
    render(
      <CaringContactsShell title="Today" serviceState={stoppedServiceState()}>
        content
      </CaringContactsShell>,
    );
    const bannerControl = screen.getByRole("status").querySelector("a");
    expect(bannerControl, "the banner offers no service-stop control").not.toBeNull();
    expect(bannerControl!.textContent).not.toBe("Service stop");
    expect(bannerControl!.textContent ?? "").toContain("Service stop");
    // Every control named exactly "Service stop" is a navigation destination, never the banner's.
    for (const destination of screen.getAllByRole("link", { name: "Service stop" })) {
      expect(screen.getByRole("status").contains(destination)).toBe(false);
    }
  });

  it("cannot be rendered by a screen that never read the service state", () => {
    // Ruling 56. Spec 4.2 puts the banner on EVERY screen while a stop is active,
    // and "everywhere" cannot rest on each page author remembering an optional
    // prop: a screen whose author forgot would show no banner at all during a live
    // stop, and a clinician would keep working believing sending was fine.
    //
    // This assertion is a TYPE assertion, checked by `tsc --noEmit`, not by the
    // runtime below. `@ts-expect-error` fails compilation when the error it expects
    // stops occurring — so if anyone makes `serviceState` optional again, the
    // typecheck goes red here rather than the omission going unnoticed.
    const omitted = (
      // @ts-expect-error serviceState is required — a screen must read it, not omit it.
      <CaringContactsShell title="Today">content</CaringContactsShell>
    );
    expect(omitted).toBeTruthy();
  });

  it("keeps the banner on every screen the shell renders", () => {
    render(
      <CaringContactsShell title="Today" serviceState={stoppedServiceState()}>
        content
      </CaringContactsShell>,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows no banner on a shell whose service is running", () => {
    render(
      <CaringContactsShell title="Today" serviceState={runningService(teamId("TEAM-A"))}>
        content
      </CaringContactsShell>,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });
});

const WORKSPACE_DIR = path.join(process.cwd(), "src", "components", "caring-contacts", "workspace");

/**
 * The components in this tree allowed to be Client Components, as paths relative to
 * `WORKSPACE_DIR` with `/` separators. Read the block below before adding to this list
 * — it is not a formality, and each entry says why it is here.
 *
 * Every entry must satisfy the same three conditions (Ruling 59): it receives no
 * `serviceState`-derived prop under any name, the companion test below proves its source
 * never names that module or type, and it is added deliberately rather than to make a
 * failing test pass.
 */
const ALLOWED_CLIENT_COMPONENTS = [
  // A declared-but-unbuilt destination: `aria-disabled` plus an inert click handler, so
  // the stated reason keeps its tab stop. Takes only `id`/`label`/`reason`/`className`.
  "unavailable-destination.tsx",
  // The shell's navigation link. It reads the current path to mark the open destination
  // (`aria-current="page"`), and takes only `href`/`className`/children — no state object.
  "workspace-nav-link.tsx",
  // Task 18's one renderer for all 24 overlays. Inherently interactive — it reads the
  // viewport width to choose a modality, traps focus, and runs the fresh-authentication
  // checkpoint. Its `blockReason` prop is a NAMED refusal string, never a state object.
  "overlays/overlay-host.tsx",
  // The client boundary that owns `?overlay=<id>` and the two handlers, because function
  // props cannot cross a Server → Client boundary. It takes no props at all, which is
  // what keeps the service-state record on the server side of this seam.
  "overlays/workspace-overlays.tsx",
  // Task 3's control: the button a screen renders to raise one of the 24 overlays. A click
  // handler is by definition a client capability, so this cannot be a Server Component.
  // Added on the same three conditions as the entries above: its props are an overlay id, a
  // class name, children, and a `WorkspaceOverlayCommit` — an intent union of a callback and
  // a plain-words reason string, never a state object and nothing derived from the record;
  // the companion test below proves its source and everything it reaches never name that
  // module or type; and it is here deliberately rather than to clear a red test.
  "overlays/overlay-trigger.tsx",
  // The trigger for the overlays whose decision control is an EXIT rather than a confirmation,
  // `delivery-detail` among them. It is a client component for an ORDINARY interactive reason: it
  // renders a button and the opening happens on click.
  //
  // It used to be described here as structural instead — a Server Component cannot pass a function
  // across this boundary, `WorkspaceOverlayCommit`'s `record` member is a function position, so an
  // exit row's commit had to be CONSTRUCTED on the client side of the seam. That reasoning was
  // sound and it is no longer this module's: the two implementations of this component were
  // collapsed into one and the surviving behaviour stages NO commit at all, because a no-op record
  // commit is indistinguishable at the host from a screen that merely satisfied the compiler. What
  // survives of it is the part that still holds — a screen passes an overlay id and a label, both
  // plain data, so the screens above stay Server Components.
  //
  // Added on the same three conditions as the entries above: its props are an overlay id, a class
  // name and children — no state object, and nothing derived from the record; the companion test
  // below proves its source and everything it reaches never name that module or type; and it is
  // here deliberately, as the alternative to a silent no-op, rather than to clear a red test.
  "overlays/exit-only-overlay-trigger.tsx",
  // Decides WHEN the condensed stop bar is shown, and never what it says. A scroll position
  // and two element rectangles are browser facts, so this one cannot be answered on the
  // server — and the header is not the height of its token (87.5px at 320/390, 65px above,
  // against 64px), so a fixed offset was not an option either. Added on the same three
  // conditions as the entries above: it takes NO PROPS AT ALL, so nothing derived from the
  // record crosses this boundary; the companion test below proves its source never names
  // that module or type; and it toggles one attribute on an element the server rendered from
  // the note-free facts type, so the bar's wording never enters the client module graph.
  "service-stop-scroll-watcher.tsx",
  // Phase 2B Task 7's activation wizard, and the first client boundary in this workspace that
  // exists because of an OWNER DECISION rather than a browser capability (Ruling [109]). A
  // half-finished sign-up must survive a page refresh, which no Server Component and no URL
  // parameter can do — and a URL parameter is separately forbidden for this data, because the
  // patient's name and mobile number arrive at stage 3 and a query string is logged by every proxy
  // between here and the browser.
  //
  // Added on the same three conditions as every entry above. Its props are a referral id, a
  // synthetic patient id, a team id, the acting actor id and roles, the referral's pathway version
  // id, and the approved pathway versions — no state object, and nothing derived from the record.
  // The companion test below proves its whole module graph never names the service-state module or
  // type. And `tests/caring-contacts-new-plan-page.dom.test.tsx` goes further than either: it stops
  // the service with a distinctive incident note and asserts on the element tree the page returns,
  // so the note reaching this boundary under ANY prop name is a red test rather than a reading.
  "plan-wizard/plan-wizard.tsx",
  // The Patients caseload's search box, and the SECOND boundary in this workspace that exists
  // because of a confidentiality rule rather than a browser capability (the first is the wizard
  // above, Ruling [109]). The directory's search matches the patient's NAME, and while it was a
  // `method="get"` form that name arrived as `?q=Jordan%20Nguyen` -- in the address bar of a
  // possibly-shared ward computer's history, and in the access log of every proxy in between.
  // Ruling [111] forbids exactly that: "a query string is logged by every proxy between here and
  // the browser. Nothing about a patient may travel here." So the typed text is React state in
  // this module and reaches no URL in any form. Ruling 13's payload preference yields to the
  // confidentiality contract, and `origin/main` reached the same split independently.
  //
  // Added on the same three conditions as every entry above. Its props are the narrow
  // `PatientsDirectoryRow` projection, a plan count, a validated plan state and two booleans --
  // no state object, and nothing derived from the record. The companion test below proves this
  // file and its whole module graph never name the service-state module or type. And the payload
  // it carries is SMALLER than the Server Component it replaced rendered into HTML: the rows are
  // reduced to the row type and pre-filtered to the selected plan state on the server side.
  "patients-directory-client.tsx",
  // Phase 2B Task 11b's plan actions: the frozen matrix's `pause`, `withdrawal` and `reassignment`
  // rows, and the resume that pause owes. A client boundary for a STRUCTURAL reason rather than an
  // interactive one — and since the exit-only trigger above stopped constructing a commit, this is
  // the module where that reasoning still applies: `WorkspaceOverlayCommit`'s `record` member is a
  // function position, and a Server Component cannot pass a function across this boundary at all --
  // so a mutating row's commit has to be constructed on the client side of the seam. Its four
  // controls also perform writes, which is a client capability by definition.
  //
  // Added on the same three conditions as every entry above. Its props are one plain-data context --
  // a plan id, a plan state, a version number, role identifiers and role WORDING the sealed domain
  // resolved, and four booleans -- with no state object and nothing derived from the record. The
  // companion test below proves its whole module graph never names the service-state module or type.
  // And it is here deliberately, as the only way these three rows can be wired at all, rather than
  // to clear a red test.
  "plan-actions.tsx",
  // Phase 2B Task 14's contact-move control, and the second boundary in this workspace that exists
  // because of BROWSER FACTS rather than a preference: a coordinator types a time, the connection is
  // a property of the device at the instant a move is confirmed, and the confirm is a click. The
  // frozen matrix requires connectivity, permission and version state to be rechecked AT COMMIT
  // time, which is by definition after a click.
  //
  // Added on the same three conditions as every entry above. Its props are a plan id, a contact id,
  // a synthetic patient id, an AWST calendar day, one instant, a version number, an actor id and a
  // team id -- no state object, and nothing derived from the record. It deliberately does NOT name
  // `schedule-view.ts`, which would reach the repository and through it the service-state module;
  // the companion test below proves that for its whole module graph rather than for its own file.
  "contact-time-adjustment.tsx",
  // Offline and network-drop fallback view. Takes only an optional `retry` callback function;
  // passes zero patient or service-state props across the boundary.
  "connection-unavailable.tsx",
  // Permission and role denial fallback view. Takes only an optional `retry` callback function;
  // passes zero patient or service-state props across the boundary.
  "permission-unavailable.tsx",
  // Manual hospital referral intake fallback (Hazard H-44). Client for ordinary interactive
  // reasons: form state, prefill actions, and an audited POST. Takes NO props at all, so the
  // ServiceState note cannot reach it; the companion test proves its module graph never names
  // the service-state module or type. Added deliberately with persistence via the intake API.
  "manual-intake-form.tsx",
  // The Team screen's "Claim this plan" rows (owner decision 2026-09-26: unclaimed work must be
  // takeable from the screen that shows it). A client boundary because each row performs a write on
  // a click. Added on the same three conditions as every entry above: its props are a list of
  // {plan id, whole minutes, a boolean, a hold name} and the caller's own actor id -- no state
  // object, nothing derived from the record, and it declares its own entry shape rather than
  // importing the domain's, so its module graph never reaches the repository; the companion test
  // below proves that graph never names the service-state module or type.
  "team-claim-list.tsx",
  // The service stop screen's two writes (owner request 2026-09-26: "The emergency safety stop has
  // no button"): the "Stop all sending" form and the restart-approval controls. A client boundary
  // because both are clicks that post, and the form holds typed state. Added on the same three
  // conditions as every entry above, and on this one above all, because the record it acts on
  // carries the incident note: its props are an address, reason-category wording, one wording
  // string for the three seats, the seats this person may take as {seat name, wording}, and a
  // count -- no state object, and nothing derived from the record. The server screen reads and
  // narrows the record and renders the note itself; the address arrives as a prop precisely so this
  // module's graph never names the record's module. The companion test below proves that graph,
  // and `tests/caring-contacts-service-stop-page.dom.test.tsx` stops the service with a distinctive
  // note and asserts it never reaches this boundary's props.
  "service-stop-controls.tsx",
];

/**
 * The route segment that READS the record and hands it to the shell.
 *
 * The workspace scan above stopped at the component tree, one directory short of the
 * file that actually performs the read: `src/app/caring-contacts/page.tsx` awaits the
 * whole state and passes it down. If that file ever gained `"use client"` the note
 * would serialise into the payload and the workspace scan would stay green — the same
 * class of hole the recursive fix closed, one level up. So it is scanned too.
 */
const ROUTE_DIR = path.join(process.cwd(), "src", "app", "caring-contacts");

/**
 * Next.js REQUIRES an `error.tsx` boundary to be a Client Component, so this entry is
 * not a judgement call; it is the framework's contract. It takes only `error` and
 * `reset`, never the record, and the companion test below holds it to that.
 */
const ALLOWED_ROUTE_CLIENT_FILES = ["error.tsx"];

const USE_CLIENT_DIRECTIVE = /^\s*(?:"use client"|'use client')/m;

/**
 * Every source file under `root`, subdirectories included.
 *
 * Recursive on purpose: a flat `readdirSync` would have scanned only the top level, so a
 * client component added under `overlays/` — which is exactly where Task 18 put two —
 * would never have been seen by the check at all.
 */
/**
 * Every extension a `"use client"` module could ship under. `.ts`/`.tsx` alone left a
 * `.js`, `.jsx`, `.mjs` or `.cjs` client file invisible to both scans — the same
 * "the scan does not cover what it claims to" shape as the non-recursive read and the
 * missing route directory, in a third dimension.
 */
const CLIENT_CAPABLE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

function sourceFilesUnder(root: string): { name: string; source: string }[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && CLIENT_CAPABLE_EXTENSIONS.some((ext) => entry.name.endsWith(ext)))
    .map((entry) => {
      const absolute = path.join(entry.parentPath, entry.name);
      return {
        name: path.relative(root, absolute).split(path.sep).join("/"),
        source: readFileSync(absolute, "utf8"),
      };
    });
}

function workspaceSourceFiles() {
  return sourceFilesUnder(WORKSPACE_DIR);
}

/**
 * The half of the note guarantee the type system does NOT hold.
 *
 * `ServiceStopBannerFacts` omits `note` by construction, so the banner cannot
 * RENDER it — that half is a compile error and holds forever. But
 * `CaringContactsShellProps.serviceState` is a whole `ServiceState`, so the note
 * is in scope for every future edit of the shell, and the only reason it never
 * reaches a browser is that nothing on that path is a Client Component.
 *
 * Nothing enforced that. It was checked by hand once, which is a point-in-time
 * verification rather than a regression guard. Adding `"use client"` to
 * `shell.tsx` or `service-state-banner.tsx`, or handing `serviceState` to a new
 * client child, would serialise a responder's free-text note into the RSC
 * payload — readable in the page source, by every team, without ever appearing
 * on screen — and every DOM test above would stay green, because JSDOM has no RSC
 * payload to inspect.
 */
/**
 * Every module specifier a source file names: `from "x"`, a bare `import "x"`, and `import("x")`.
 */
const MODULE_SPECIFIER = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

/**
 * Resolves a specifier to a file this guard should follow, or `null`.
 *
 * Two kinds are followed. **Relative** specifiers, because a helper authored beside a client
 * component is the realistic way a client module acquires something it should not have. And
 * **aliased `@/…` specifiers that land inside a caring-contacts directory**, for the same reason
 * one directory further out. Everything else — `react`, `@/components/ui-primitives`, the shared
 * design-system graph — is deliberately NOT followed: that graph reaches most of `src/`, and a
 * guard that walks the whole application is a guard nobody can reason about. The residual gap is
 * stated in the test below rather than papered over.
 */
function resolveGuardedModule(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else if (specifier.startsWith("@/")) {
    base = path.join(process.cwd(), "src", specifier.slice(2));
    if (!base.split(path.sep).includes("caring-contacts")) return null;
  } else {
    return null;
  }

  const candidates = [
    base,
    ...CLIENT_CAPABLE_EXTENSIONS.map((extension) => base + extension),
    ...CLIENT_CAPABLE_EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
  ];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

/**
 * `entry` plus every module reachable from it through the specifiers above, transitively.
 *
 * Fix round 1, finding 2. The scan below used to read an allowlisted component's OWN source and
 * stop there. `service-stop-scroll-watcher.tsx` passes that check and then imports
 * `service-stop-bar-anchors.ts`, which nothing constrained at all — so the guard certified
 * exactly the one file it happened to open. That is the same shape as the top-level-only
 * directory read and the `.ts`/`.tsx`-only extension list this file has already had to widen
 * twice: a check whose claim is broader than the path it walks.
 */
function guardedModuleGraph(entry: string): string[] {
  const seen = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const [, specifier] of source.matchAll(MODULE_SPECIFIER)) {
      const resolved = resolveGuardedModule(file, specifier);
      if (resolved !== null) pending.push(resolved);
    }
  }
  return [...seen];
}

/*
 * The scan below reads CODE rather than prose.
 *
 * Narrowed in Phase 2B Task 7, and narrowing rather than weakening: a type only reaches a client
 * component through an import, an annotation or a prop — all of them code. A comment cannot carry
 * one. What comments CAN do is describe the rule, and this guard was rejecting exactly that:
 * `list-empty-state.tsx` explains its own design by comparing itself to `ServiceStateBanner`, and
 * `plan-wizard.tsx` opens by stating that the record never crosses its boundary. Both are the
 * documentation this file's own rules ask for, and both read as offences to a raw text match.
 *
 * The alternative was to delete those explanations to make a check green, which is the failure mode
 * `tests/route-reachability.test.ts` records in its own words: documenting a rule is not breaking
 * it, and a check that cannot tell the two apart is a check that gets silenced. The check still
 * fails on real usage, and `plan-wizard.tsx` still deliberately avoids naming the type at all.
 *
 * Round 1, finding M-4: the first version stripped block comments with a regex that knew nothing
 * about string literals, so a `"/*"` inside an ordinary string would have blanked real code up to
 * the next terminator — a silent false negative inside a safety guard. `stripSourceComments` scans
 * character by character and copies literals through untouched; its own proof is below.
 */

/** A line break, named so these fixtures can be written as arrays rather than as escaped strings. */
const NEWLINE = String.fromCharCode(10);

describe("the comment stripper the two source guards are built on", () => {
  // Round 1, finding M-4. A guard is only as good as the text it reads, and the regex this
  // replaced would have blanked real code the moment a scanned file contained a `/*` inside a
  // string. These are the cases that distinguish the two implementations.
  it("removes comments", () => {
    // A line comment on its own line, which is the only line-comment shape this strips — see the
    // trailing-comment case below, which is deliberately left alone.
    expect(stripSourceComments(["  // ServiceState", "const b = 2;"].join(NEWLINE))).not.toMatch(/ServiceState/);
    expect(stripSourceComments(["  // ServiceState", "const b = 2;"].join(NEWLINE))).toMatch(/const b = 2;/);
    expect(stripSourceComments("/* ServiceState */ const a = 1;")).not.toMatch(/ServiceState/);
    expect(stripSourceComments("/* ServiceState */ const a = 1;")).toMatch(/const a = 1;/);
  });

  it("keeps code that follows a comment-opening sequence inside a string literal", () => {
    // The defect, stated as a test: the regex matched from this `/*` to the NEXT `*/` anywhere in
    // the file, so everything between — imports included — vanished from the guard's view.
    const source = [
      'const opener = "/*";',
      'import type { ServiceState } from "@/lib/caring-contacts/service-state";',
      'const closer = "*/";',
    ].join(NEWLINE);

    const stripped = stripSourceComments(source);

    expect(stripped, "a real import was hidden by a string containing a comment opener").toMatch(/ServiceState/);
    expect(stripped).toMatch(/caring-contacts\/service-state/);
  });

  it("leaves a TRAILING line comment alone, which is deliberate conservatism rather than an oversight", () => {
    // A line comment is stripped only when the line BEGINS with `//`. That property was in the
    // regex this replaced and was kept on purpose: hardening the block-comment case is not a
    // licence to widen the line-comment one, and leaving text in makes a guard louder, never
    // quieter. So `import … // service-state` still fires — and it should, because a note that a
    // module is service-state-adjacent is worth a human reading.
    const stripped = stripSourceComments('import type { Thing } from "x"; // service-state lives next door');
    expect(stripped).toMatch(/service-state lives next door/);
  });

  it("pins the one place it errs UNSAFELY, so a green suite cannot be read as closing it", () => {
    // Round 2, item 4. A trailing `//` comment is deliberately NOT stripped as a comment — but the
    // `/*` inside it still opens the block branch, so the code after it is removed from what the
    // guard reads. A silent false negative: the same class of bug `stripSourceComments` was written
    // to fix, one layer down.
    //
    // THIS TEST PINS A LIMITATION, NOT A GUARANTEE. It exists so the limitation is visible in the
    // suite rather than only in a header comment, and so that tightening the behaviour is a
    // deliberate act that rewrites this case rather than a change nobody notices. Do not read it as
    // saying the behaviour is correct.
    const source = [
      "const a = 1; // an aside mentioning /* a block opener",
      'import type { ServiceState } from "@/lib/caring-contacts/service-state";',
      "const b = 2; /* a real block */",
    ].join(NEWLINE);

    const stripped = stripSourceComments(source);

    expect(stripped, "the known limitation has changed — see the header, and update it deliberately").not.toMatch(
      /ServiceState/,
    );
  });

  it("copies template literals and their interpolations through untouched", () => {
    const stripped = stripSourceComments("const a = `before ${ServiceState} // not a comment` ;");
    expect(stripped).toMatch(/ServiceState/);
    expect(stripped).toMatch(/not a comment/);
  });
});

describe("the service-state path stays on the server", () => {
  it("keeps every workspace component but the allowlisted client controls a Server Component", () => {
    const clientComponents = workspaceSourceFiles()
      .filter(({ source }) => USE_CLIENT_DIRECTIVE.test(source))
      .map(({ name }) => name)
      .sort();

    expect(
      clientComponents,
      "A new Client Component appeared under src/components/caring-contacts/workspace/. The shell " +
        "hands that tree a whole ServiceState, whose `note` is patient data, and a client boundary " +
        "serialises props into the RSC payload for every team to read in the page source. If this " +
        "component genuinely must run on the client, prove the note cannot reach it, then add it to " +
        "ALLOWED_CLIENT_COMPONENTS deliberately.",
    ).toEqual([...ALLOWED_CLIENT_COMPONENTS].sort());
  });

  it("keeps the service state out of every client component and everything it imports", () => {
    // The complement of the allowlist above, and deliberately the modest version.
    // Tracing which props a JSX element actually receives is not something source
    // text can answer reliably, so this does not attempt it. What it does answer
    // reliably: an allowed client component never names the service-state module
    // or its type at all, so it cannot be handed one without this going red too.
    //
    // Every entry is covered, not merely the first (Ruling 59): the allowlist is
    // the whole reason a client boundary is permitted here, so each addition must
    // carry the same proof the original one did.
    //
    // And every entry's own imports are covered too (fix round 1, finding 2). Checking a
    // client component's source alone certifies one file while the boundary is a graph:
    // a helper it imports is just as much inside the client bundle, and nothing was
    // holding those. Exposure today was nil; the hole was the guard's, not the code's.
    expect(ALLOWED_CLIENT_COMPONENTS.length).toBeGreaterThan(0);
    for (const name of ALLOWED_CLIENT_COMPONENTS) {
      const entry = path.join(WORKSPACE_DIR, name);
      const source = readFileSync(entry, "utf8");
      // A stale entry would silently widen the allowlist without covering anything.
      expect(source, `${name} is allowlisted but is not a Client Component`).toMatch(USE_CLIENT_DIRECTIVE);

      for (const file of guardedModuleGraph(entry)) {
        const label = path.relative(process.cwd(), file).split(path.sep).join("/");
        const moduleSource = stripSourceComments(readFileSync(file, "utf8"));
        expect(moduleSource, `${label} (reached from ${name}) references the service-state module`).not.toMatch(
          /service-state/,
        );
        expect(moduleSource, `${label} (reached from ${name}) names ServiceState`).not.toMatch(/ServiceState/);
      }
    }
  });

  it("actually follows a client component's imports rather than stopping at its own file", () => {
    // The anti-vacuity guard for the check above. If `guardedModuleGraph` ever stopped
    // resolving — a changed extension list, a moved file, a regex that no longer matches the
    // import syntax in use — the loop above would still run, still pass, and cover exactly
    // what it covered before the fix: one file. This names the concrete edge that fix was
    // written for, so the coverage cannot quietly evaporate.
    const watcher = path.join(WORKSPACE_DIR, "service-stop-scroll-watcher.tsx");
    const reached = guardedModuleGraph(watcher).map((file) =>
      path.relative(WORKSPACE_DIR, file).split(path.sep).join("/"),
    );
    expect(reached, "the module-graph walk does not reach the watcher's own anchors module").toContain(
      "service-stop-bar-anchors.ts",
    );
  });

  it("keeps the route segment that reads the record a Server Component", () => {
    // The workspace scan cannot see this directory, and this is the file that performs
    // the read. `error.tsx` is allowed because Next.js requires an error boundary to be
    // a Client Component; nothing else here may be one, and `page.tsx` least of all.
    const routeClientFiles = sourceFilesUnder(ROUTE_DIR)
      .filter(({ source }) => USE_CLIENT_DIRECTIVE.test(source))
      .map(({ name }) => name)
      .sort();

    expect(
      routeClientFiles,
      "A Client Component appeared under src/app/caring-contacts/. `page.tsx` awaits the whole " +
        "ServiceState and hands it to the shell, so a client boundary anywhere on that path " +
        "serialises a responder's free-text note into the payload every team can read in the page " +
        "source. Only Next's mandatory error boundary belongs on this list.",
    ).toEqual([...ALLOWED_ROUTE_CLIENT_FILES].sort());

    for (const name of ALLOWED_ROUTE_CLIENT_FILES) {
      const source = readFileSync(path.join(ROUTE_DIR, name), "utf8");
      expect(source, `${name} is allowlisted but is not a Client Component`).toMatch(USE_CLIENT_DIRECTIVE);
      expect(source, `${name} references the service-state module`).not.toMatch(/service-state/);
      expect(source, `${name} names ServiceState`).not.toMatch(/ServiceState/);
    }
  });
});

/* ------------------------------------------------------------------------- *
 * The condensed service-stop bar.
 *
 * The full banner sits in normal flow beneath a sticky header, so the browser
 * proof measured it scrolling completely out of view at 320, 390, 430 and 768px
 * (y from -285 to -602). Spec 4.2 requires the stop to be visible on every
 * screen while it is active, so a condensed one-line bar is pinned under the
 * header once the full banner has gone.
 *
 * These are the structural guarantees. Whether the bar is actually ON SCREEN
 * when scrolled is a geometry question no JSDOM test can answer, and is proved
 * in tests/ui-caring-contacts-workspace.spec.ts.
 * ------------------------------------------------------------------------- */

/** A stopped service with `recorded` restart approvals already on it. */
function stoppedServiceWithApprovals(recorded: number): ServiceState {
  let state = stoppedServiceState();
  for (const role of REQUIRED_RESTART_APPROVAL_ROLES.slice(0, recorded)) {
    // Each seat taken by the person governance configuration names for it (owner decision 2026-09-26).
    const approver = actorId(`ACTOR-${role}`);
    const seats = { incidentLead: [approver], privacySecurityOwner: [approver], clinicalProgrammeLead: [approver] };
    const approved = applyServiceRestartApproval(state, { role, actorId: approver }, INCIDENT_CLOCK, seats);
    if (!approved.ok) throw new Error(`fixture could not record ${role}: ${approved.reason}`);
    state = approved.value;
  }
  return state;
}

const CONDENSED_BAR_TEST_ID = "caring-contacts-condensed-service-stop";

describe("the condensed service-stop bar", () => {
  it("renders nothing at all while the service is running", () => {
    render(
      <CaringContactsShell title="Today" serviceState={runningService(teamId("TEAM-A"))}>
        content
      </CaringContactsShell>,
    );
    expect(screen.queryByTestId(CONDENSED_BAR_TEST_ID)).toBeNull();
  });

  it("states that sending is stopped for the whole service, in words", () => {
    render(
      <CaringContactsShell title="Today" serviceState={stoppedServiceState()}>
        content
      </CaringContactsShell>,
    );
    const bar = screen.getByTestId(CONDENSED_BAR_TEST_ID);
    // Text, not colour. This is what survives greyscale and forced colours.
    expect(bar.textContent ?? "").toContain("Sending stopped");
    // Abbreviated, but never vaguer: "sending stopped" alone could be read as one
    // patient's plan. The service-wide scope is the load-bearing half of the claim.
    expect(bar.textContent ?? "").toContain("the whole service");
    // The icon decorates the text; it never carries the state on its own.
    //
    // Fix round 1, finding 3: the count is asserted BEFORE the loop. A `for` over an empty
    // NodeList passes, so the round-1 form of this went green whether the icon was there,
    // marked correctly, or missing altogether — it could only ever fail on a *wrongly marked*
    // icon and never on a *missing* one, which is the more likely edit.
    const icons = bar.querySelectorAll("svg");
    expect(icons, "the condensed bar has no icon").toHaveLength(1);
    for (const icon of icons) {
      expect(icon.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("carries the same restart-approval count the full banner carries", () => {
    // Not a fixed "0 of 3": an abbreviated bar that froze the count would state a
    // weaker, staler claim than the banner directly above it.
    for (const recorded of [0, 1, 2]) {
      const { unmount } = render(
        <CaringContactsShell title="Today" serviceState={stoppedServiceWithApprovals(recorded)}>
          content
        </CaringContactsShell>,
      );
      const bar = screen.getByTestId(CONDENSED_BAR_TEST_ID);
      expect(bar.textContent ?? "").toContain(`${recorded} of ${REQUIRED_RESTART_APPROVAL_ROLES.length}`);
      expect(screen.getByRole("status").textContent ?? "").toContain(
        `${recorded} of ${REQUIRED_RESTART_APPROVAL_ROLES.length}`,
      );
      unmount();
    }
  });

  it("cannot put the responder's incident note in the condensed bar either", () => {
    // The same guarantee as the full banner's, and held the same way: the bar is
    // rendered from `ServiceStopBannerFacts`, which omits `note` by construction,
    // so interpolating it is a type error rather than a judgement call.
    const { container } = render(
      <CaringContactsShell title="Today" serviceState={stoppedServiceState()}>
        content
      </CaringContactsShell>,
    );
    expect(screen.getByTestId(CONDENSED_BAR_TEST_ID)).toBeInTheDocument();
    expect(container.innerHTML).not.toContain(NOTE_SENTINEL);
    expect(container.innerHTML).not.toMatch(/Rowan|Mira|\+61/);
  });

  it("adds no second announced statement of the same stop", () => {
    // Two live regions saying the same thing is the failure mode this bar has to
    // avoid in the aural channel as well as the visual one. The full banner is
    // still in the document and still announces; the pinned duplicate is scenery.
    render(
      <CaringContactsShell title="Today" serviceState={stoppedServiceState()}>
        content
      </CaringContactsShell>,
    );
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByTestId(CONDENSED_BAR_TEST_ID)).toHaveAttribute("aria-hidden", "true");
  });

  it("adds no second control competing with the banner's service-stop control", () => {
    render(
      <CaringContactsShell title="Today" serviceState={stoppedServiceState()}>
        content
      </CaringContactsShell>,
    );
    expect(screen.getByTestId(CONDENSED_BAR_TEST_ID).querySelector("button, a")).toBeNull();
  });
});
