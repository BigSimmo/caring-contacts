import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Component, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WORKSPACE_OVERLAY_DEFINITIONS,
  type NonMutatingOverlayId,
  type WorkspaceOverlayId,
} from "@/components/caring-contacts/workspace/overlays/definitions";
import { ExitOnlyOverlayTrigger } from "@/components/caring-contacts/workspace/overlays/exit-only-overlay-trigger";
import {
  clearStagedWorkspaceOverlayCommit,
  commitForHistoryEntry,
  commitRefusalFor,
  nextWorkspaceOverlayCommitToken,
  NO_STAGED_COMMIT_REASON,
  readStagedWorkspaceOverlayCommit,
  stageWorkspaceOverlayCommit,
} from "@/components/caring-contacts/workspace/overlays/overlay-commits";
import { WorkspaceOverlayTrigger } from "@/components/caring-contacts/workspace/overlays/overlay-trigger";
import {
  openWorkspaceOverlay,
  WorkspaceOverlays,
} from "@/components/caring-contacts/workspace/overlays/workspace-overlays";

import { CARING_CONTACTS_PROHIBITED_LANGUAGE } from "./helpers/caring-contacts-prohibited-language";

/**
 * Task 3: the control that raises an overlay, and the commit contract that had to
 * ship with it.
 *
 * Ruling 87 is the whole reason this file is not simply "a button opens a panel".
 * The 24 overlays are decision surfaces, every one of them renders a decision
 * control, and until this trigger existed none of them was reachable from any
 * control — which is the only reason a confirm that recorded nothing was
 * tolerable.
 *
 * Ruling 90 is the reason the assertions come in three groups rather than two.
 * Ruling 87's domain is the sixteen rows that RECORD something; the other eight
 * carry exits, and a refusal reading "nothing can be recorded here" is false about
 * a control whose whole action is to leave. So: the trigger opens what it names;
 * a recording row never offers a decision control the system will not honour; and
 * a non-recording row keeps its exit.
 */

/** jsdom reports a fixed 1024px viewport; the host needs a width to choose a modality at all. */
function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  window.dispatchEvent(new Event("resize"));
}

const WORKSPACE_PATH = "/caring-contacts";
/** A distinguishable prior entry, so what Back lands on is unambiguous. */
const PRIOR_PATH = "/caring-contacts/somewhere-before";

function seedHistory() {
  window.history.pushState(null, "", `${PRIOR_PATH}?marker=before`);
  window.history.pushState(null, "", WORKSPACE_PATH);
}

/**
 * The staged commit lives in a module-scoped slot, so it outlives a render the way
 * the browser tab does. Emptying it between tests is what stops one test's staged
 * intent silently satisfying the next test's assertion.
 */
beforeEach(() => {
  clearStagedWorkspaceOverlayCommit();
  setViewportWidth(1440);
  seedHistory();
});

afterEach(() => {
  cleanup();
  clearStagedWorkspaceOverlayCommit();
});

function contentFor(overlayId: string) {
  return document.querySelector(`[data-testid="workspace-overlay-content"][data-overlay-id="${overlayId}"]`);
}

describe("the overlay trigger", () => {
  it("opens the overlay it names, and Back closes it", async () => {
    render(
      <>
        <WorkspaceOverlayTrigger overlayId="pause" commit={{ kind: "record", record: () => {} }}>
          Pause this plan
        </WorkspaceOverlayTrigger>
        <WorkspaceOverlays />
      </>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Pause this plan" }));
    expect(contentFor("pause")).not.toBeNull();
    expect(window.location.search).toContain("overlay=pause");

    act(() => window.history.back());
    await waitFor(() => expect(contentFor("pause")).toBeNull());
    expect(window.location.search).not.toContain("overlay=");
  });

  it("refuses an id the frozen table does not carry at COMPILE time", () => {
    // Ruling [130]. `overlayId` is a union derived from the twenty-four rows, so this
    // is checked by `tsc --noEmit` rather than at runtime, and `@ts-expect-error` fails
    // the typecheck if the error ever stops being raised. Before the narrowing, the
    // annotation on `WORKSPACE_OVERLAY_DEFINITIONS` erased every literal and this line
    // compiled: the throw below was the only thing standing between a typo and a
    // control that opens nothing.
    const mistyped = (
      // @ts-expect-error "pause-plan" names no row in the frozen 24-overlay table.
      <WorkspaceOverlayTrigger overlayId="pause-plan" commit={{ kind: "record", record: () => {} }}>
        Pause this plan
      </WorkspaceOverlayTrigger>
    );
    expect(mistyped).toBeTruthy();
  });

  it("still fails loudly at render for an id that reaches it past the type", () => {
    // The belt-and-braces half, and the cast is the POINT rather than a convenience:
    // the type is defeated deliberately, because a cast, an `any`, or a value that
    // entered the program untyped is exactly what the throw is left in place for. A
    // control that opens an empty overlay is the silent version of the defect the
    // commit contract exists to prevent.
    expect(() =>
      render(
        <WorkspaceOverlayTrigger
          overlayId={"pause-plan" as unknown as WorkspaceOverlayId}
          commit={{ kind: "record", record: () => {} }}
        >
          Pause this plan
        </WorkspaceOverlayTrigger>,
      ),
    ).toThrow(/No overlay is defined for the id "pause-plan"/);
  });

  it("cannot be constructed without a commit", () => {
    // A type-level guarantee checked by `tsc --noEmit`, not at runtime: `commit`
    // is required, so a screen that opens an overlay it has not wired fails to
    // compile. `@ts-expect-error` fails the typecheck if the error ever stops
    // being raised — which is what makes this a proof rather than a comment.
    const withoutCommit = (
      // @ts-expect-error `commit` is required — an overlay cannot be opened unwired.
      <WorkspaceOverlayTrigger overlayId="pause">Pause this plan</WorkspaceOverlayTrigger>
    );
    expect(withoutCommit).toBeTruthy();
  });

  it("carries the workspace's 48px tap floor and a surface of its own", () => {
    render(
      <WorkspaceOverlayTrigger overlayId="pause" commit={{ kind: "unavailable", reason: "Not built yet." }}>
        Pause this plan
      </WorkspaceOverlayTrigger>,
    );
    const trigger = screen.getByRole("button", { name: "Pause this plan" });

    // `min-h-tap` is `--spacing-tap` (3rem). Never `min-h-11`: 44px reintroduces a
    // known `ui-smoke` sub-pixel flake.
    expect(trigger.className).toContain("min-h-tap");

    // Fix round 1, M-3: with no `className` — the shape every usage takes before a
    // screen styles it — the control must still have a surface rather than being
    // effectively invisible. Tokens only, no hex.
    expect(trigger.className, "the default rendering has no background").toMatch(/bg-\[color:var\(--[a-z-]+\)\]/);
    expect(trigger.className, "the default rendering has no text colour").toMatch(/text-\[color:var\(--[a-z-]+\)\]/);
    expect(trigger.className, "the default rendering has no border colour").toMatch(
      /border-\[color:var\(--[a-z-]+\)\]/,
    );
  });
});

describe("the commit contract", () => {
  it("records the screen's decision through the host mounted by the shell", async () => {
    const record = vi.fn();
    render(
      <>
        <WorkspaceOverlayTrigger overlayId="pause" commit={{ kind: "record", record }}>
          Pause this plan
        </WorkspaceOverlayTrigger>
        <WorkspaceOverlays />
      </>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Pause this plan" }));
    const action = screen.getByTestId("workspace-overlay-action");
    expect(action).not.toHaveAttribute("aria-disabled");

    await userEvent.click(action);
    // The overlay the trigger named, not whatever happened to be open.
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith("pause");

    await waitFor(() => expect(contentFor("pause")).toBeNull());
    // The entry the commit belonged to has been unwound, so the slot no longer
    // names the current entry and the host has emptied it.
    await waitFor(() => expect(readStagedWorkspaceOverlayCommit()).toBeNull());
  });

  it("never shows the refusal in the frame the decision was confirmed in", async () => {
    // Fix round 1, Important 2. Clearing the slot inside the confirm handler
    // emptied it while the URL still named the overlay — `history.back()` fires
    // `popstate` asynchronously — so React re-rendered the still-open overlay with
    // nothing staged and flashed "nothing can be recorded here" at someone who had
    // just confirmed a withdrawal.
    //
    // `fireEvent`, not `userEvent`, and no `waitFor`: `fireEvent` flushes React
    // inside the click while the `popstate` is still a queued task, so this reads
    // the exact frame the flash would appear in. Every assertion in the test above
    // waits for the settled state and steps straight over it.
    const record = vi.fn();
    render(
      <>
        <WorkspaceOverlayTrigger overlayId="withdrawal" commit={{ kind: "record", record }}>
          Withdraw this patient
        </WorkspaceOverlayTrigger>
        <WorkspaceOverlays />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Withdraw this patient" }));
    fireEvent.click(screen.getByTestId("workspace-overlay-action"));
    // `withdrawal` requires fresh authentication, so the checkpoint is raised first
    // and the second activation is the one that records.
    fireEvent.click(screen.getByTestId("workspace-overlay-action"));
    expect(record).toHaveBeenCalledTimes(1);

    const action = screen.getByTestId("workspace-overlay-action");
    expect(action, "the confirmed frame showed the action refused").not.toHaveAttribute("aria-disabled");
    expect(
      screen.queryByText(NO_STAGED_COMMIT_REASON),
      "the confirmed frame showed the unstaged refusal",
    ).not.toBeInTheDocument();
  });

  it("still runs the fresh-authentication checkpoint before recording", async () => {
    const record = vi.fn();
    render(
      <>
        <WorkspaceOverlayTrigger overlayId="withdrawal" commit={{ kind: "record", record }}>
          Withdraw this patient
        </WorkspaceOverlayTrigger>
        <WorkspaceOverlays />
      </>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Withdraw this patient" }));
    await userEvent.click(screen.getByTestId("workspace-overlay-action"));
    expect(record, "the first activation raised the checkpoint; it must record nothing").not.toHaveBeenCalled();
    expect(screen.getByText(/fresh authentication checkpoint/i)).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("workspace-overlay-action"));
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("refuses the decision in the aria-disabled shape when the caller states it is unavailable", async () => {
    const reason = "Pausing a plan is not built yet, so nothing can be changed from here.";
    render(
      <>
        <WorkspaceOverlayTrigger overlayId="pause" commit={{ kind: "unavailable", reason }}>
          Pause this plan
        </WorkspaceOverlayTrigger>
        <WorkspaceOverlays />
      </>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Pause this plan" }));
    const action = screen.getByTestId("workspace-overlay-action");

    expect(action).toHaveAttribute("aria-disabled", "true");
    // Never both: native `disabled` removes the tab stop, so the stated reason
    // could never be reached by keyboard, and lint fails on the pair.
    expect(action).not.toHaveAttribute("disabled");

    // Reachable, and NOT in a `title`: a title is reached by hover and may never
    // be announced at all.
    expect(action).not.toHaveAttribute("title");
    const describedBy = action.getAttribute("aria-describedby");
    expect(describedBy, "the refused control points at no reason").not.toBeNull();
    expect(document.getElementById(describedBy!)?.textContent).toBe(reason);

    await userEvent.click(action);
    expect(contentFor("pause"), "an inert action must not close the overlay either").not.toBeNull();
  });

  it("carries a caller-stated refusal onto a read-only row as well", async () => {
    // Scope `every-row`: a screen that says the decision is unbuilt has said so
    // about THIS row, whatever the row does — an exit nobody has built is still an
    // exit that would go nowhere. This is the half of the refusal Ruling 90 leaves
    // reaching every row.
    const readOnly = WORKSPACE_OVERLAY_DEFINITIONS.find((definition) => !definition.mutatesState);
    expect(readOnly, "the frozen table carries at least one read-only row").toBeDefined();
    const reason = "This preview is not wired to a screen yet.";
    render(
      <>
        <WorkspaceOverlayTrigger overlayId={readOnly!.id} commit={{ kind: "unavailable", reason }}>
          Open the preview
        </WorkspaceOverlayTrigger>
        <WorkspaceOverlays />
      </>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Open the preview" }));
    expect(screen.getByTestId("workspace-overlay-action")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(reason)).toBeInTheDocument();
  });

  it("refuses a recording overlay reached by address rather than from a control", async () => {
    render(<WorkspaceOverlays />);
    act(() => openWorkspaceOverlay("pause"));
    await screen.findByTestId("workspace-overlay-content");

    const action = screen.getByTestId("workspace-overlay-action");
    expect(action).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(NO_STAGED_COMMIT_REASON)).toBeInTheDocument();
  });
});

/**
 * Ruling 90. The eight `mutatesState: false` rows carry EXITS, not confirmations,
 * so "nothing can be recorded here" is not a statement that can be made about
 * them — and on the two `recovery-only` rows, refusing the single control leaves a
 * person inside an overlay they cannot dismiss with nothing to do at all.
 */
describe("a row that records nothing keeps its way out", () => {
  const NON_RECORDING = WORKSPACE_OVERLAY_DEFINITIONS.filter((definition) => !definition.mutatesState);

  it("covers every non-recording row in the frozen table", () => {
    // Guards the loop below against silently shrinking to nothing if the flag ever
    // moves in the table.
    expect(NON_RECORDING.length).toBe(8);
  });

  for (const definition of NON_RECORDING) {
    it(`leaves "${definition.id}" usable when it is deep-linked with nothing staged`, async () => {
      render(<WorkspaceOverlays />);
      act(() => openWorkspaceOverlay(definition.id));
      await screen.findByTestId("workspace-overlay-content");

      const action = screen.getByTestId("workspace-overlay-action");
      expect(action, `${definition.id}: its exit was refused`).not.toHaveAttribute("aria-disabled");
      expect(
        screen.queryByText(NO_STAGED_COMMIT_REASON),
        `${definition.id}: it renders a refusal that is false about an exit`,
      ).not.toBeInTheDocument();
    });
  }

  it("leaves the recovery-only session gate with something to do", async () => {
    // The sharpest case, and the one that made the first version harmful:
    // `session-expiry` ignores Escape and the backdrop by design, so its single
    // control is the only way out of it.
    const gate = WORKSPACE_OVERLAY_DEFINITIONS.find((definition) => definition.id === "session-expiry");
    expect(gate?.dismissal, "session-expiry is the recovery-only row this test is about").toBe("recovery-only");

    render(<WorkspaceOverlays />);
    act(() => openWorkspaceOverlay("session-expiry"));
    await screen.findByTestId("workspace-overlay-content");

    const action = screen.getByTestId("workspace-overlay-action");
    expect(action).not.toHaveAttribute("aria-disabled");
    expect(action).not.toHaveAttribute("disabled");
  });
});

/**
 * Fix round 1, Important 3. The slot is bound to the history ENTRY that staged it,
 * not to the overlay id — the id match narrowed these failures without closing
 * them.
 */
describe("a staged commit belongs to the entry that opened it", () => {
  it("never answers an entry it was not staged for", () => {
    const commit = { kind: "record", record: () => {} } as const;
    const token = nextWorkspaceOverlayCommitToken();
    stageWorkspaceOverlayCommit(token, commit);
    const slot = readStagedWorkspaceOverlayCommit();

    expect(commitForHistoryEntry(slot, token)).toBe(commit);
    // A later opening mints a new token, so an older slot cannot answer it — this
    // is the ten-`Pause`-rows case, where one row's commit must never answer an
    // overlay raised from another.
    expect(commitForHistoryEntry(slot, nextWorkspaceOverlayCommitToken())).toBeNull();
    // A deep link, and the entry `history.back()` unwinds to, carry no token.
    expect(commitForHistoryEntry(slot, null)).toBeNull();
    expect(commitForHistoryEntry(null, token)).toBeNull();
  });

  it("mints a distinct token per opening", () => {
    const tokens = new Set([
      nextWorkspaceOverlayCommitToken(),
      nextWorkspaceOverlayCommitToken(),
      nextWorkspaceOverlayCommitToken(),
    ]);
    expect(tokens.size).toBe(3);
  });

  it("is emptied when the browser goes Back, which never calls the Sheet's close", async () => {
    // The workspace's PRIMARY dismissal route, and the one the first version
    // missed entirely: Back closes through `popstate`, so `onClose` never runs.
    const record = vi.fn();
    render(
      <>
        <WorkspaceOverlayTrigger overlayId="pause" commit={{ kind: "record", record }}>
          Pause this plan
        </WorkspaceOverlayTrigger>
        <WorkspaceOverlays />
      </>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Pause this plan" }));
    expect(readStagedWorkspaceOverlayCommit()).not.toBeNull();

    act(() => window.history.back());
    await waitFor(() => expect(contentFor("pause")).toBeNull());
    await waitFor(() =>
      expect(readStagedWorkspaceOverlayCommit(), "the commit outlived the Back that dismissed it").toBeNull(),
    );
    expect(record).not.toHaveBeenCalled();
  });
});

/** Fix round 1, Important 4: a rejected recording must not disappear into the promise. */
class CommitFailureBoundary extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : String(error) };
  }
  render() {
    return this.state.message === null ? this.props.children : <p>Nothing was sent: {this.state.message}</p>;
  }
}

describe("an asynchronous recording", () => {
  it("accepts a promise-returning record and closes once it is issued", async () => {
    const record = vi.fn(() => Promise.resolve());
    render(
      <>
        <WorkspaceOverlayTrigger overlayId="pause" commit={{ kind: "record", record }}>
          Pause this plan
        </WorkspaceOverlayTrigger>
        <WorkspaceOverlays />
      </>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Pause this plan" }));
    await userEvent.click(screen.getByTestId("workspace-overlay-action"));
    expect(record).toHaveBeenCalledWith("pause");
    await waitFor(() => expect(contentFor("pause")).toBeNull());
  });

  it("raises a rejection where an error boundary can state that nothing was written", async () => {
    // The minimum that is not silent. Without this the rejection is an unhandled
    // promise, the overlay has already closed, and the clinician is looking at a
    // screen that appears to have recorded the decision.
    const failure = new Error("the store refused the write");
    render(
      <CommitFailureBoundary>
        <WorkspaceOverlayTrigger overlayId="pause" commit={{ kind: "record", record: () => Promise.reject(failure) }}>
          Pause this plan
        </WorkspaceOverlayTrigger>
        <WorkspaceOverlays />
      </CommitFailureBoundary>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Pause this plan" }));
    await userEvent.click(screen.getByTestId("workspace-overlay-action"));

    await waitFor(() => expect(screen.getByText(/the store refused the write/)).toBeInTheDocument());
  });
});

describe("the refusal rule", () => {
  it("answers every state of the slot, and scopes each refusal to the rows it is true of", () => {
    // Total by construction, so the rule can be read here rather than inferred
    // from a rendered button.
    expect(commitRefusalFor(null)).toEqual({ reason: NO_STAGED_COMMIT_REASON, scope: "recording-rows-only" });
    expect(commitRefusalFor({ kind: "unavailable", reason: "Not built yet." })).toEqual({
      reason: "Not built yet.",
      scope: "every-row",
    });
    expect(commitRefusalFor({ kind: "record", record: () => {} })).toBeNull();
  });

  it("states the unstaged refusal in permitted vocabulary", () => {
    expect(NO_STAGED_COMMIT_REASON).not.toMatch(CARING_CONTACTS_PROHIBITED_LANGUAGE);
  });
});

/*
 * ===========================================================================
 * ONE `ExitOnlyOverlayTrigger`, in one module
 * ===========================================================================
 *
 * Two implementations of this component were live at once, and the reason they survived the merge
 * is the reason this check is a source scan rather than a render. They sat at DIFFERENT PATHS, so
 * git had nothing to report: no conflict, no overlapping hunk, both branches' files applied
 * cleanly, and each consumer went on importing whichever one its own branch had built. Every DOM
 * suite in the repository stayed green throughout, because each was rendering a component that
 * really did exist and really did work.
 *
 * What that cost was not a crash. It was that "what an exit row's commit is" had TWO ANSWERS in one
 * tree -- one staging `{ kind: "record", record: () => {} }`, one staging nothing -- and that Ruling
 * [130]'s compile-time guarantee held at two call sites and not at the third, whose copy still typed
 * `overlayId` as `string`. A duplicate that both halves of a fork keep working is invisible to every
 * gate that asks whether the code works.
 *
 * So the invariant is about the TREE, not about a rendering: the component name is exported by
 * exactly one module, and every module that imports it resolves to that one. It is written to be
 * able to redden -- restoring either half of the fork fails it and names the file.
 */
describe("`ExitOnlyOverlayTrigger` is one component, exported once", () => {
  const SURVIVING_MODULE = "src/components/caring-contacts/workspace/overlays/exit-only-overlay-trigger.tsx";
  const SOURCE_ROOTS = ["src/components/caring-contacts", "src/app/caring-contacts"] as const;

  /**
   * The component name followed by a NON-IDENTIFIER character, so `ExitOnlyOverlayTriggerProps` --
   * a different name, and legitimately exported beside it -- does not count as a second component.
   *
   * A character class rather than a word boundary DELIBERATELY: a `\b` typed into this repository
   * has arrived as a literal `0x08` byte before now, which renders as nothing, matches nothing, and
   * leaves every gate green (`tests/source-control-bytes.test.ts` exists because of it).
   */
  const NAME_END = "[^A-Za-z0-9_$]";
  const DECLARES_THE_NAME = new RegExp(
    String.raw`export\s+(?:(?:async\s+)?function|const|let|class)\s+ExitOnlyOverlayTrigger(?=${NAME_END})`,
  );
  const RE_EXPORTS_THE_NAME = new RegExp(
    String.raw`export\s+(?:type\s+)?\{[^}]*ExitOnlyOverlayTrigger(?=${NAME_END})[^}]*\}`,
  );
  const IMPORTS_A_CLAUSE = new RegExp(String.raw`import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*"([^"]+)"`, "g");

  function sourceModules(): string[] {
    const found: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const child = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(child);
          continue;
        }
        if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) found.push(child);
      }
    };
    for (const root of SOURCE_ROOTS) walk(path.join(process.cwd(), root));
    return found.map((absolute) => path.relative(process.cwd(), absolute).split(path.sep).join("/")).sort();
  }

  const MODULES = sourceModules();
  const SOURCE_BY_MODULE = new Map(
    MODULES.map(
      (sourceModule) => [sourceModule, readFileSync(path.join(process.cwd(), sourceModule), "utf8")] as const,
    ),
  );

  /** A relative or `@/`-aliased specifier, as a repository-relative path with its extension. */
  function resolveSpecifier(fromModule: string, specifier: string): string | null {
    const base = specifier.startsWith("@/")
      ? path.join(process.cwd(), "src", specifier.slice(2))
      : specifier.startsWith(".")
        ? path.resolve(process.cwd(), path.dirname(fromModule), specifier)
        : null;
    if (base === null) return null;
    for (const candidate of [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      path.join(base, "index.ts"),
      path.join(base, "index.tsx"),
    ]) {
      const relative = path.relative(process.cwd(), candidate).split(path.sep).join("/");
      if (SOURCE_BY_MODULE.has(relative)) return relative;
    }
    return null;
  }

  it("scans the workspace source at all", () => {
    // The positive control for every absence below. A walk that found nothing -- a moved directory,
    // a renamed root -- would satisfy "exported by exactly one module" vacuously if the surviving
    // module were also missing, and would satisfy "no other module exports it" outright.
    expect(MODULES).toContain(SURVIVING_MODULE);
    expect(MODULES.length, "the workspace source walk found almost nothing").toBeGreaterThan(20);
  });

  it("is exported by exactly one module", () => {
    const exporters = MODULES.filter((sourceModule) => {
      const source = SOURCE_BY_MODULE.get(sourceModule) ?? "";
      return DECLARES_THE_NAME.test(source) || RE_EXPORTS_THE_NAME.test(source);
    });
    expect(exporters).toEqual([SURVIVING_MODULE]);
  });

  it("is imported from that module by every consumer, and from nowhere else", () => {
    const wrong: string[] = [];
    const consumers: string[] = [];
    for (const sourceModule of MODULES) {
      const source = SOURCE_BY_MODULE.get(sourceModule) ?? "";
      for (const [, clause, specifier] of source.matchAll(IMPORTS_A_CLAUSE)) {
        if (!new RegExp(String.raw`ExitOnlyOverlayTrigger(?=${NAME_END}|$)`).test(clause)) continue;
        consumers.push(sourceModule);
        const resolved = resolveSpecifier(sourceModule, specifier);
        if (resolved !== SURVIVING_MODULE) wrong.push(`${sourceModule}: imports it from ${specifier} (${resolved})`);
      }
    }
    // Positive control for the absence above: there ARE consumers, so "none imports it from
    // anywhere else" is a statement about real imports rather than about an empty set.
    expect(consumers.length, "no module imports the exit-only trigger at all").toBeGreaterThan(0);
    expect(wrong).toEqual([]);
  });
});

/**
 * The surviving `ExitOnlyOverlayTrigger`'s own behaviour, which is not the base trigger's.
 *
 * The adjudication recorded in `docs/caring-contacts/phase-2b-build-record.md` ("The duplicate
 * `ExitOnlyOverlayTrigger`, adjudicated") resolved two implementations into one: Task 10's module
 * and structure, Task 16's runtime behaviour, and Task 16's DOM marker. The two properties below are
 * exactly the halves of that resolution, so a regression to either implementation reddens here.
 */
describe("the exit-only trigger", () => {
  it("opens its row with NOTHING staged, and says which route it took", async () => {
    // THE POSITIVE CONTROL, and it is doing real work: it proves the slot is observable from this
    // test at all, and that a click through the RECORDING route writes it. Without it, "nothing is
    // staged" would be satisfied just as well by a broken reader or a click that never landed.
    render(
      <WorkspaceOverlayTrigger overlayId="pause" commit={{ kind: "record", record: () => {} }}>
        Pause this plan
      </WorkspaceOverlayTrigger>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Pause this plan" }));
    expect(readStagedWorkspaceOverlayCommit(), "the recording route staged nothing either").not.toBeNull();

    cleanup();
    clearStagedWorkspaceOverlayCommit();
    seedHistory();

    render(<ExitOnlyOverlayTrigger overlayId="delivery-detail">Close this detail</ExitOnlyOverlayTrigger>);
    const trigger = screen.getByRole("button", { name: "Close this detail" });
    expect(trigger).toHaveAttribute("data-overlay-trigger", "delivery-detail");
    // Task 16's marker, carried over by the adjudication: it makes "this is an exit route, not a
    // no-op commit" assertable from the DOM rather than only from the source. The base trigger does
    // not write it, which is what makes it a distinction rather than a decoration.
    expect(trigger).toHaveAttribute("data-overlay-trigger-kind", "exit-only");

    await userEvent.click(trigger);

    // The overlay really opened -- so the absence below is about what the opening STAGED, not about
    // a click that did nothing.
    expect(window.location.search).toContain("overlay=delivery-detail");
    expect(readStagedWorkspaceOverlayCommit(), "the exit route staged a commit").toBeNull();
  });

  it("wears the same surface and the same 48px tap floor as the base trigger", () => {
    render(<ExitOnlyOverlayTrigger overlayId="delivery-detail">Close this detail</ExitOnlyOverlayTrigger>);
    const trigger = screen.getByRole("button", { name: "Close this detail" });

    // One shared constant rather than two copies: the duplicate implementation carried its own copy
    // of this string, which is how two visibly similar controls start drifting apart.
    expect(trigger.className).toContain("min-h-tap");
    expect(trigger.className, "44px reintroduces a known ui-smoke sub-pixel flake").not.toContain("min-h-11");
    expect(trigger.className).toMatch(/bg-\[color:var\(--[a-z-]+\)\]/);
  });

  it("refuses a recording row at COMPILE time", () => {
    // Ruling [130] at this component, which is the guarantee F1 found absent at one call site while
    // two implementations were live: the surviving one types `overlayId` as `NonMutatingOverlayId`,
    // the deleted one typed it `string`. Checked by `tsc --noEmit`; `@ts-expect-error` fails the
    // typecheck if the error ever stops being raised.
    const mistyped = (
      // @ts-expect-error "withdrawal" records a decision, so it is not an exit row.
      <ExitOnlyOverlayTrigger overlayId="withdrawal">Withdraw this plan</ExitOnlyOverlayTrigger>
    );
    expect(mistyped).toBeTruthy();
  });

  it("still fails loudly at render for a recording row that reaches it past the type", () => {
    // The cast is the POINT rather than a convenience: the type is defeated deliberately, because a
    // cast, an `any`, or a value that entered the program untyped is what the throw is left for --
    // and it is the only thing that catches a row whose `mutatesState` changes in the frozen table.
    expect(() =>
      render(
        <ExitOnlyOverlayTrigger overlayId={"withdrawal" as unknown as NonMutatingOverlayId}>
          Withdraw this plan
        </ExitOnlyOverlayTrigger>,
      ),
    ).toThrow(/records a decision/i);
  });
});
