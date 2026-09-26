// Standalone extract: PsychSift's `collectSiteMapData` (scripts/generate-site-map.ts) walks the whole
// PsychSift app and imports most of its route registry, so it is not in this copy. It is replaced
// by `collectCaringContactsPageRoutes` below, a small recursive walk of src/app/caring-contacts
// that builds the route the same way the site-map generator's `fileToRoute` does: the folder path
// under src/app, route groups `(name)` and parallel slots `@name` dropped, dynamic segments such as
// `[patientId]` kept verbatim. Every case and assertion is otherwise unchanged.
// tests/caring-contacts-workspace-screens.test.ts
//
// Turns one piece of policy held by people into a gate.
//
// `docs/design-system/adoption-contract.json` names `tests/ui-caring-contacts-workspace.spec.ts`
// as the SOLE evidence for all five proof categories of the `caring-contacts-workspace` surface.
// That spec visits the screens listed in its own `WORKSPACE_SCREENS` array -- so a screen added to
// the surface and not to that array is a SILENCED GATE: the five proofs still pass, because they
// never visit the route. Nothing enforced the array's completeness; its own comment said so, and
// the build record recorded it as a rule that people had to remember.
//
// This is the cheap way to make the omission fail rather than pass. It is offline, reads two
// files, and runs in milliseconds: it resolves the route expressions in `WORKSPACE_SCREENS`
// against the workspace's production page routes and fails when a route has no entry.
//
// WHY IT RESOLVES THE EXPRESSIONS RATHER THAN IMPORTING THE ARRAY. `WORKSPACE_SCREENS` is not
// exported, and the spec that holds it imports `@playwright/test`, which a Vitest run must not
// pull in. So the array is read as TEXT and its `${...}` interpolations are resolved from the
// `const` declarations beside it. Every step of that parse throws rather than returning nothing:
// a rename that this parser stops understanding fails loudly here instead of quietly covering
// nothing, which is the same failure mode the check itself exists to close.
//
// WHAT IT DOES NOT CLAIM. Listing a route proves the spec CAN reach it, not that any proof
// actually asserts anything about it -- the array is also used to type and index the screen
// constants, and a test still has to be written against a screen for it to be proved. This check
// closes the silent half: a route that no proof could even visit.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const SPEC_PATH = "tests/ui-caring-contacts-workspace.spec.ts";
const specSource = readFileSync(path.join(repoRoot, SPEC_PATH), "utf8");

/**
 * Every `const NAME = "…"` or `const NAME = \`…\`` in the spec, with template interpolations of
 * OTHER such constants resolved. Two passes are enough for the shapes this file uses
 * (`PATIENTS_ROUTE` builds on `WORKSPACE_ROUTE`, and the overview route builds on both), and an
 * unresolved `${` at the end is an error rather than a value.
 */
function resolveStringConstants(source: string): Map<string, string> {
  const declarations = [...source.matchAll(/^const (\w+)(?::\s*[^=]+)?\s*=\s*(?:"([^"]*)"|`([^`]*)`);$/gm)];
  if (declarations.length === 0) {
    throw new Error(`${SPEC_PATH}: parsed no string constants — update this parser to match the current source.`);
  }

  const values = new Map<string, string>();
  for (const [, name, quoted, templated] of declarations) {
    values.set(name, quoted ?? templated ?? "");
  }

  for (let pass = 0; pass < 4; pass += 1) {
    for (const [name, value] of values) {
      values.set(
        name,
        value.replace(/\$\{(\w+)\}/g, (whole, reference: string) => values.get(reference) ?? whole),
      );
    }
  }
  return values;
}

/** The `route:` value of every entry in `WORKSPACE_SCREENS`, fully resolved. */
function workspaceScreenRoutes(): string[] {
  const block = specSource.match(/const WORKSPACE_SCREENS = \[([\s\S]*?)\] as const;/);
  if (!block) {
    throw new Error(`${SPEC_PATH}: WORKSPACE_SCREENS could not be located — update this parser.`);
  }

  const constants = resolveStringConstants(specSource);
  const expressions = [...block[1].matchAll(/route:\s*(?:"([^"]*)"|`([^`]*)`|(\w+))\s*,/g)];
  if (expressions.length === 0) {
    throw new Error(`${SPEC_PATH}: WORKSPACE_SCREENS parsed to no routes — update this parser.`);
  }

  return expressions.map(([whole, quoted, templated, identifier]) => {
    const raw = quoted ?? templated ?? (identifier === undefined ? undefined : constants.get(identifier));
    if (raw === undefined) {
      throw new Error(`${SPEC_PATH}: could not resolve the route in \`${whole.trim()}\``);
    }
    const resolved = raw.replace(/\$\{(\w+)\}/g, (all, reference: string) => constants.get(reference) ?? all);
    if (resolved.includes("${") || !resolved.startsWith("/")) {
      throw new Error(`${SPEC_PATH}: the route in \`${whole.trim()}\` resolved to "${resolved}", which is not a path`);
    }
    return resolved;
  });
}

const APP_DIR = path.join(repoRoot, "src", "app");

/** Mirrors the site-map generator's `routeSegment`: groups and parallel slots are not URL segments. */
function routeSegment(segment: string): string | null {
  if (segment.startsWith("(") && segment.endsWith(")")) return null;
  if (segment.startsWith("@")) return null;
  return segment;
}

/** Every `page.tsx` under `directory`, recursively. */
function collectPageFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectPageFiles(full);
    return entry.isFile() && entry.name === "page.tsx" ? [full] : [];
  });
}

/** `{ route }` for every page under src/app/caring-contacts, in the shape `collectSiteMapData().pageRoutes` had. */
function collectCaringContactsPageRoutes(): { route: string }[] {
  return collectPageFiles(path.join(APP_DIR, "caring-contacts")).map((file) => {
    const relative = path.relative(APP_DIR, path.dirname(file)).split(path.sep).join("/");
    const segments = relative
      .split("/")
      .filter(Boolean)
      .map(routeSegment)
      .filter((segment): segment is string => segment !== null);
    return { route: segments.length ? `/${segments.join("/")}` : "/" };
  });
}

/** Every production page route this workspace serves, static and dynamic alike. */
function workspacePageRoutes(): string[] {
  return collectCaringContactsPageRoutes()
    .map((entry) => entry.route)
    .filter((route) => route === "/caring-contacts" || route.startsWith("/caring-contacts/"))
    .filter((route) => !route.startsWith("/mockups"));
}

/**
 * True when `visited` is an instance of `route`.
 *
 * A dynamic family is matched segment by segment with `[param]` accepting any single non-empty
 * segment, because a browser cannot visit `[patientId]` — the spec has to name a concrete id, and
 * that id is deliberately not pinned here. What is checked is that the spec visits SOMETHING in
 * the family, which is the whole of what "the proofs can reach this route" means.
 */
function matchesRoute(route: string, visited: string): boolean {
  const expected = route.split("/");
  const actual = visited.split("/");
  if (expected.length !== actual.length) return false;
  return expected.every((segment, index) =>
    segment.startsWith("[") && segment.endsWith("]") ? actual[index].length > 0 : segment === actual[index],
  );
}

describe("the caring-contacts-workspace browser surface lists every screen it must prove", () => {
  it("finds the workspace's production page routes at all", () => {
    // Vacuous success is the failure this whole file exists to prevent, so the inputs are checked
    // before the comparison that uses them.
    expect(workspacePageRoutes().length, "no /caring-contacts page routes were found").toBeGreaterThan(0);
    expect(workspaceScreenRoutes().length, `${SPEC_PATH} listed no screens`).toBeGreaterThan(0);
  });

  it("visits every production /caring-contacts page route", () => {
    const visited = workspaceScreenRoutes();
    const unvisited = workspacePageRoutes().filter((route) => !visited.some((entry) => matchesRoute(route, entry)));

    expect(
      unvisited,
      `${SPEC_PATH} never visits these production workspace routes, so its five proof categories ` +
        "pass without inspecting them. Add each to WORKSPACE_SCREENS with the h1 it renders, and " +
        `write at least one proof against it: ${unvisited.join(", ")}`,
    ).toEqual([]);
  });

  it("lists no screen that is not a production page route", () => {
    const routes = workspacePageRoutes();
    const stale = workspaceScreenRoutes().filter((entry) => !routes.some((route) => matchesRoute(route, entry)));

    expect(
      stale,
      `${SPEC_PATH} lists routes the workspace no longer serves, so those proofs are asserting ` +
        `against a 404: ${stale.join(", ")}`,
    ).toEqual([]);
  });
});
