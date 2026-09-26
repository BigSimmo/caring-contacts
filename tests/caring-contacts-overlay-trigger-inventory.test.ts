// tests/caring-contacts-overlay-trigger-inventory.test.ts
//
// Task 20's reconciliation, turned from a document into a gate.
//
// The frozen interaction matrix has twenty-four rows and the workspace screens raise some of them
// and not others. Which is which was, until this file, established by reading — and a reading
// decays the moment a screen is edited. `docs/caring-contacts/phase-2b-sdd-archive/task-20-report.md`
// carries the reasoning, the routes and the per-row `file:line`; this file carries the part a
// document cannot carry, which is that the reasoning is still true of the tree.
//
// WHAT IT ASSERTS, stated narrowly so it is not read as more.
//
//  1. Every frozen row has an entry here, and every entry names a frozen row. A row added to or
//     dropped from `definitions.ts` reddens this rather than passing unnoticed under a table nobody
//     re-read.
//  2. For a row raised by a LITERAL trigger, the set of screen modules writing `overlayId="<id>"`
//     is exactly the set recorded here. Adding a second trigger, moving one, or deleting one
//     reddens it and names the row.
//  3. For a row raised through a VARIABLE, the module that raises it declares the id in a named
//     constant and passes that constant. Two rows are wired this way and a literal scan cannot see
//     either, which is why they are recorded rather than inferred.
//  4. For a row NOTHING raises, the id appears in no screen module at all — so an entry recorded as
//     unwired cannot quietly become wired without this file being updated, and each carries the
//     reason in the same view as the claim.
//
// WHAT IT DOES NOT ASSERT, and neither claim belongs to a source scan:
//
//  * That a recorded trigger is REACHABLE. Every trigger here is inside a conditional, and one
//     condition can be met by a coordinator while another cannot be produced from the interface at
//     all. The report carries that column; proving it needs a rendered screen, not a file read.
//  * That an unwired row SHOULD stay unwired. The reason strings say why each is a recorded
//     exception today; they are the record, not the adjudication.
//
// THE SCAN IS TEXTUAL, AND THAT LIMIT IS REAL RATHER THAN THEORETICAL. It reads source as text and
// cannot tell a control from a comment: writing `overlayId="pause"` inside a comment in a screen
// would count as a trigger here, and quoting an unwired id in a comment would redden the unwired
// check. Both were confirmed by mutation rather than assumed. The trade is deliberate — parsing
// TSX to find a JSX attribute would be a second, heavier thing to keep working — but it means a
// GREEN here says the strings are in the files, not that a control renders. The rendered proof of
// each trigger lives in the screen's own DOM suite.
//
// A NOTE ON WHAT WAS REMOVED. A separate check asserted that a row wired through a variable carries
// no literal trigger. Mutating it showed it could not fail on its own: the literal check already
// records an empty expected set for such a row, so the same edit reddens that one first and for the
// same reason. It was deleted rather than kept as a check that cannot fail.
//
// WHY IT SCANS THE SCREENS AND NOT `overlays/`. A trigger is a control a SCREEN renders. The
// `overlays/` directory holds the machinery — the frozen table, the two trigger components, the
// host — and it names ids for its own reasons: `overlay-host.tsx` keys its refusal wording on
// `"permission-unavailable"`, which is a lookup key rather than a control. Scanning it would report
// that row as wired on the strength of a string in a map.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { WORKSPACE_OVERLAY_DEFINITIONS } from "@/components/caring-contacts/workspace/overlays/definitions";

/** The screen trees a coordinator's controls live in. `overlays/` is excluded — see the note above. */
const SCREEN_ROOTS = ["src/components/caring-contacts/workspace", "src/app/caring-contacts"] as const;
const EXCLUDED_DIRECTORY = "overlays";

type TriggerRecord =
  /** Raised by `overlayId="<id>"` in each of these modules, and in no other. */
  | { readonly kind: "literal"; readonly modules: readonly string[] }
  /** Raised through a named constant in this module, which a literal scan cannot see. */
  | { readonly kind: "indirect"; readonly module: string; readonly constants: readonly string[] }
  /**
   * Raised by nothing. The reason is the record.
   *
   * `nonTriggerMentions` names any module that contains this id as a STRING for some purpose other
   * than raising the overlay -- declared here rather than filtered out of the scan, so the exception
   * is visible in the inventory and has to be justified per module. Both directions are checked
   * below: an undeclared mention fails, and a declared module that no longer mentions the id fails
   * too, so a stale exemption cannot quietly widen the hole it was granted for.
   */
  | {
      readonly kind: "unwired";
      readonly reason: string;
      readonly nonTriggerMentions?: readonly { readonly module: string; readonly reason: string }[];
    };

const PLAN_WIZARD = "src/components/caring-contacts/workspace/plan-wizard/plan-wizard.tsx";
const PLAN_ACTIONS = "src/components/caring-contacts/workspace/plan-actions.tsx";
const PATIENT_OVERVIEW = "src/components/caring-contacts/workspace/patient-overview.tsx";
const SCHEDULE_SCREEN = "src/components/caring-contacts/workspace/schedule-screen.tsx";
const TEMPLATE_DETAIL = "src/components/caring-contacts/workspace/template-detail.tsx";
const CONTACT_TIME_ADJUSTMENT = "src/components/caring-contacts/workspace/contact-time-adjustment.tsx";

/**
 * One entry per frozen row, in matrix order.
 *
 * The `unwired` reasons are deliberately the SHORT form. Each is argued in full, against the module
 * that would have to change for it to become wired, in Task 20's report; a paraphrase here that
 * drifted from that argument would be worse than a pointer to it.
 */
const TRIGGER_INVENTORY: Readonly<Record<string, TriggerRecord>> = Object.freeze({
  "verify-identity": { kind: "literal", modules: [PLAN_WIZARD] },
  "change-patient": { kind: "literal", modules: [PLAN_WIZARD] },
  "pathway-preview": { kind: "literal", modules: [PLAN_WIZARD] },
  "message-preview": { kind: "literal", modules: [PLAN_WIZARD, TEMPLATE_DETAIL] },
  "communication-preference": { kind: "literal", modules: [PLAN_WIZARD] },
  "adjust-date-time": {
    kind: "indirect",
    module: CONTACT_TIME_ADJUSTMENT,
    constants: ["ADJUST_DATE_TIME"],
  },
  "outside-window-warning": {
    kind: "indirect",
    module: CONTACT_TIME_ADJUSTMENT,
    constants: ["OUTSIDE_WINDOW_WARNING"],
  },
  "save-draft": { kind: "literal", modules: [PLAN_WIZARD] },
  "discard-changes": { kind: "literal", modules: [PLAN_WIZARD] },
  "final-activation": { kind: "literal", modules: [PLAN_WIZARD] },
  "activation-success": { kind: "literal", modules: [PATIENT_OVERVIEW] },
  pause: { kind: "literal", modules: [PLAN_ACTIONS] },
  withdrawal: { kind: "literal", modules: [PLAN_ACTIONS] },
  reassignment: { kind: "literal", modules: [PLAN_ACTIONS] },
  "delivery-detail": { kind: "literal", modules: [PATIENT_OVERVIEW] },
  "resolve-failed-delivery": { kind: "literal", modules: [SCHEDULE_SCREEN] },
  "contact-changed-block": {
    kind: "unwired",
    reason:
      "No screen reviews a contact destination. The hospital `mobileChanged` event that produces the state the row is about reaches the store but has no inbound route, so nothing in the interface can put a plan into it.",
  },
  "template-changed-retired": { kind: "literal", modules: [TEMPLATE_DETAIL] },
  "session-expiry": {
    kind: "unwired",
    reason:
      "This prototype has no credential and no session that can expire; the role switcher says of itself that it is deliberately not a login. Its decision, `Sign in again`, names an action the system cannot perform.",
  },
  "offline-banner": {
    kind: "unwired",
    reason:
      "A status banner is raised by a connectivity observer, not pressed. The workspace has none: connectivity is read at the moment of a write and answered as a named refusal on the row's own overlay.",
  },
  "recoverable-error": {
    kind: "unwired",
    reason:
      "Read recovery is performed by the route error boundary at `src/app/caring-contacts/error.tsx`, whose control re-fetches. A control that opened this drawer instead would offer a second, weaker recovery beside the working one.",
  },
  "permission-unavailable": {
    kind: "unwired",
    reason:
      "Role refusals are stated in place, on the control itself, with `aria-disabled` and the named reason. `OverlayHost` can render this row from a `blockReason`, and `WorkspaceOverlays` passes that prop `null` in every case — recorded as a residual in the report, not closed here.",
    nonTriggerMentions: [
      {
        module: "src/app/caring-contacts/error.tsx",
        reason:
          "A ROUTE ERROR BOUNDARY, not a trigger, and the collision is in the string rather than in the behaviour. It matches a thrown error's MESSAGE TEXT against a list of substrings — `403`, `forbidden`, `permission`, and this id among them — and on a match renders the full-page `PermissionUnavailable` component. It never opens an overlay, never imports the overlay machinery, and cannot reach this row: `WorkspaceOverlays` still passes `blockReason` as null in every case, so the overlay stays exactly as unwired as the reason above says. Declared here because a plain text search cannot tell a message substring apart from a trigger, and silently narrowing the search would hide a real wiring somewhere else.",
      },
    ],
  },
  "team-switcher": {
    kind: "unwired",
    reason:
      "There is one team. `DEMO_TEAM_ID` is the only team any demo actor belongs to, so there is nothing to switch to and no write that switches.",
  },
  "draft-version-conflict": {
    kind: "unwired",
    reason:
      "Nothing detects an approved version changing under an open draft. The wizard reads its options once, on the server, and no comparison is made afterwards.",
  },
});

function screenModules(): string[] {
  const found: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === EXCLUDED_DIRECTORY) continue;
        walk(child);
        continue;
      }
      if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        found.push(child);
      }
    }
  };
  for (const root of SCREEN_ROOTS) walk(path.join(process.cwd(), root));
  return found.map((absolute) => path.relative(process.cwd(), absolute).split(path.sep).join("/")).sort();
}

const MODULES = screenModules();
const SOURCE_BY_MODULE = new Map(
  MODULES.map((module) => [module, readFileSync(path.join(process.cwd(), module), "utf8")]),
);

function sourceOf(module: string): string {
  const source = SOURCE_BY_MODULE.get(module);
  if (source === undefined) {
    throw new Error(
      `${module} is named in TRIGGER_INVENTORY but is not one of the screen modules this file scans. ` +
        `Either the module moved, or it now lives under a directory this scan excludes.`,
    );
  }
  return source;
}

/** The modules writing `overlayId="<id>"`, which is the whole of a literal trigger. */
function modulesWithLiteralTrigger(id: string): string[] {
  const literal = `overlayId="${id}"`;
  return MODULES.filter((module) => sourceOf(module).includes(literal));
}

/** Whether the id appears anywhere in a module as a double-quoted string. */
function modulesMentioning(id: string): string[] {
  const quoted = `"${id}"`;
  return MODULES.filter((module) => sourceOf(module).includes(quoted));
}

const FROZEN_IDS = WORKSPACE_OVERLAY_DEFINITIONS.map((definition) => definition.id);

describe("every row of the frozen interaction matrix is accounted for by a trigger or by a recorded reason", () => {
  it("scans every module the inventory names", () => {
    const named = [
      ...new Set(
        Object.values(TRIGGER_INVENTORY).flatMap((record) =>
          record.kind === "literal" ? [...record.modules] : record.kind === "indirect" ? [record.module] : [],
        ),
      ),
    ].sort();
    expect(MODULES).toEqual(expect.arrayContaining(named));
  });

  it("excludes the overlay machinery from the scan", () => {
    expect(MODULES.filter((module) => module.includes("/overlays/"))).toEqual([]);
  });

  it("holds one entry per frozen row, and names no row the frozen table does not carry", () => {
    expect(Object.keys(TRIGGER_INVENTORY).sort()).toEqual([...FROZEN_IDS].sort());
  });

  it("finds no trigger in a screen for an id the frozen table does not carry", () => {
    const frozen = new Set<string>(FROZEN_IDS);
    const strays: string[] = [];
    for (const screenModule of MODULES) {
      for (const match of sourceOf(screenModule).matchAll(/overlayId="([^"]+)"/g)) {
        if (!frozen.has(match[1])) strays.push(`${screenModule}: ${match[1]}`);
      }
    }
    expect(strays).toEqual([]);
  });

  it("finds a literal trigger where one is recorded, and nowhere else", () => {
    const mismatched: string[] = [];
    for (const [id, record] of Object.entries(TRIGGER_INVENTORY)) {
      const found = modulesWithLiteralTrigger(id);
      const expected = record.kind === "literal" ? [...record.modules].sort() : [];
      if (JSON.stringify(found.sort()) !== JSON.stringify(expected)) {
        mismatched.push(`${id}: recorded ${JSON.stringify(expected)}, found ${JSON.stringify(found)}`);
      }
    }
    expect(mismatched).toEqual([]);
  });

  it("finds every recorded literal trigger's module declaring the trigger component it uses", () => {
    const missing: string[] = [];
    for (const [id, record] of Object.entries(TRIGGER_INVENTORY)) {
      if (record.kind !== "literal") continue;
      for (const screenModule of record.modules) {
        const source = sourceOf(screenModule);
        if (!source.includes("OverlayTrigger")) missing.push(`${id}: ${screenModule} imports no overlay trigger`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("finds each id wired through a variable declared as a named constant and passed as one", () => {
    const problems: string[] = [];
    for (const [id, record] of Object.entries(TRIGGER_INVENTORY)) {
      if (record.kind !== "indirect") continue;
      const source = sourceOf(record.module);
      for (const constant of record.constants) {
        if (!source.includes(`const ${constant} = "${id}"`)) {
          problems.push(`${id}: ${record.module} no longer declares ${constant} as this id`);
        }
      }
      if (!source.includes("overlayId={")) {
        problems.push(`${id}: ${record.module} no longer passes an overlay id as a variable`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("finds no undeclared mention of an id recorded as unwired in any screen module", () => {
    const mentioned: string[] = [];
    for (const [id, record] of Object.entries(TRIGGER_INVENTORY)) {
      if (record.kind !== "unwired") continue;
      const declared = new Set((record.nonTriggerMentions ?? []).map((mention) => mention.module));
      const found = modulesMentioning(id).filter((module) => !declared.has(module));
      if (found.length > 0) mentioned.push(`${id}: ${JSON.stringify(found)}`);
    }
    expect(mentioned).toEqual([]);
  });

  it("finds every declared non-trigger mention still present, so no exemption outlives its subject", () => {
    // The other direction of the check above. A declared module that has stopped mentioning the id
    // is a stale exemption: it silently excuses that module from the scan forever, which is exactly
    // the hole the scan exists to close. Fail rather than carry it.
    const stale: string[] = [];
    for (const [id, record] of Object.entries(TRIGGER_INVENTORY)) {
      if (record.kind !== "unwired") continue;
      for (const mention of record.nonTriggerMentions ?? []) {
        if (!MODULES.includes(mention.module)) {
          stale.push(`${id}: ${mention.module} is not a scanned screen module`);
          continue;
        }
        if (!sourceOf(mention.module).includes(`"${id}"`)) {
          stale.push(`${id}: ${mention.module} no longer mentions this id — remove the exemption`);
        }
      }
    }
    expect(stale).toEqual([]);
  });

  it("states a reason for every declared non-trigger mention", () => {
    const silent: string[] = [];
    for (const [id, record] of Object.entries(TRIGGER_INVENTORY)) {
      if (record.kind !== "unwired") continue;
      for (const mention of record.nonTriggerMentions ?? []) {
        if (mention.reason.trim().length < 40) silent.push(`${id}: ${mention.module}`);
      }
    }
    expect(silent).toEqual([]);
  });

  it("states a reason for every row recorded as unwired", () => {
    const silent: string[] = [];
    for (const [id, record] of Object.entries(TRIGGER_INVENTORY)) {
      if (record.kind !== "unwired") continue;
      if (record.reason.trim().length === 0) silent.push(id);
    }
    expect(silent).toEqual([]);
  });
});
