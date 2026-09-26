import { existsSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const routeFiles = [
  "src/app/mockups/caring-contacts/page.tsx",
  "src/app/mockups/caring-contacts/patients/page.tsx",
  "src/app/mockups/caring-contacts/patients/[patientId]/page.tsx",
  "src/app/mockups/caring-contacts/plans/new/page.tsx",
  "src/app/mockups/caring-contacts/plans/[planId]/page.tsx",
  "src/app/mockups/caring-contacts/schedule/page.tsx",
  "src/app/mockups/caring-contacts/contacts/[contactId]/page.tsx",
  "src/app/mockups/caring-contacts/templates/page.tsx",
  "src/app/mockups/caring-contacts/templates/[pathwayId]/page.tsx",
  "src/app/mockups/caring-contacts/team/page.tsx",
  "src/app/mockups/caring-contacts/guidance/page.tsx",
  "src/app/mockups/caring-contacts/reports/page.tsx",
  "src/app/mockups/caring-contacts/system-states/page.tsx",
] as const;

const MOCKUP_ROOTS = ["src/app/mockups/caring-contacts", "src/components/caring-contacts/mockups"] as const;

/** Every `.ts`/`.tsx` file under the given repo-relative roots, keyed by repo-relative path. */
function collectSources(roots: readonly string[]): Map<string, string> {
  const sources = new Map<string, string>();
  for (const root of roots) {
    const absoluteRoot = resolve(process.cwd(), root);
    for (const entry of readdirSync(absoluteRoot, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(?:ts|tsx)$/.test(entry.name)) continue;
      const absolute = resolve(entry.parentPath, entry.name);
      sources.set(relative(process.cwd(), absolute).split(sep).join("/"), readFileSync(absolute, "utf8"));
    }
  }
  return sources;
}

describe("Caring Contact mockup route registration", () => {
  it("registers every approved page inside the synthetic mockup namespace", () => {
    for (const file of routeFiles) {
      expect(existsSync(resolve(process.cwd(), file)), `${file} is missing`).toBe(true);
    }
    expect(existsSync(resolve(process.cwd(), "src/app/mockups/caring-contacts/layout.tsx"))).toBe(true);
  });

  // Standalone extract: this checks PsychSift's shared /mockups layout, which is not part of this copy.
  it.skip("keeps the Caring Contact shell independent from shared mockup search chrome", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/mockups/mockups-layout-client.tsx"), "utf8");
    expect(source).toContain('pathname.startsWith("/mockups/caring-contacts/")');
    expect(source).toContain("!isCaringContactMockup");
  });

  it("keeps the prototype memory-only and provider-free inside its mockup namespace", () => {
    const source = [...collectSources(MOCKUP_ROOTS).values()].join("\n");

    expect(source).not.toMatch(/\b(?:localStorage|sessionStorage|indexedDB)\b|document\.cookie/);
    expect(source).not.toMatch(/from\s+["'][^"']*(?:openai|supabase|twilio|analytics)[^"']*["']/i);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(existsSync(resolve(process.cwd(), "src/app/plans"))).toBe(false);
    expect(existsSync(resolve(process.cwd(), "src/app/contacts"))).toBe(false);
  });

  // Replaces the former `src/app/caring-contacts` non-existence assertion. That
  // assertion was reserving the production namespace *for* production, and
  // production has now arrived (Task 15). The separation it protected is kept,
  // and strengthened: it is now enforced in both directions instead of by the
  // absence of one side. The prototype's storage and `fetch(` bans above stay
  // scoped to the mockup roots they were written for — the production tree
  // legitimately fetches, the prototype still may not.
  it("keeps the prototype and the production workspace from reaching into each other", () => {
    const mockupSources = collectSources(MOCKUP_ROOTS);
    expect(mockupSources.size).toBeGreaterThan(0);
    for (const [file, source] of mockupSources) {
      expect(source, `${file} imports production workspace code`).not.toMatch(
        /from\s+["']@\/components\/caring-contacts\/workspace/,
      );
      expect(source, `${file} imports a production caring-contacts route`).not.toMatch(
        /from\s+["']@\/lib\/caring-contacts-server/,
      );
    }

    const productionSources = collectSources(["src/app/caring-contacts", "src/components/caring-contacts/workspace"]);
    expect(productionSources.size).toBeGreaterThan(0);
    for (const [file, source] of productionSources) {
      expect(source, `${file} imports mockup code`).not.toMatch(/caring-contacts\/mockups/);
    }
  });

  it("enforces full screen registration parity between adoption-contract.json and ui-caring-contacts-workspace.spec.ts", () => {
    const adoptionContract = JSON.parse(
      readFileSync(resolve(process.cwd(), "docs/design-system/adoption-contract.json"), "utf8"),
    );
    const workspaceSurface = adoptionContract.productionSurfaces.find(
      (surface: { id: string }) => surface.id === "caring-contacts-workspace",
    );
    expect(workspaceSurface).toBeDefined();
    const declaredRoutes: string[] = workspaceSurface.routes;
    expect(declaredRoutes.length).toBeGreaterThan(0);

    const specSource = readFileSync(resolve(process.cwd(), "tests/ui-caring-contacts-workspace.spec.ts"), "utf8");

    // Resolve route constant expressions used by WORKSPACE_SCREENS so each
    // declared adoption-contract route is compared to its own registration,
    // not a PATIENTS_ROUTE fallback that would pass for any non-root route.
    const constValues = new Map<string, string>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const match of specSource.matchAll(/^const\s+([A-Z0-9_]+)\s*=\s*"([^"]+)";/gm)) {
        if (!constValues.has(match[1])) {
          constValues.set(match[1], match[2]);
          changed = true;
        }
      }
      for (const match of specSource.matchAll(/^const\s+([A-Z0-9_]+)\s*=\s*`([^`]+)`;/gm)) {
        const name = match[1];
        const expr = match[2];
        let ok = true;
        const resolved = expr.replace(/\$\{([A-Z0-9_]+)\}/g, (_whole, ref: string) => {
          if (!constValues.has(ref)) {
            ok = false;
            return "";
          }
          return constValues.get(ref)!;
        });
        if (ok && !constValues.has(name)) {
          constValues.set(name, resolved);
          changed = true;
        }
      }
    }

    const screensBlock = specSource.match(/const WORKSPACE_SCREENS = \[([\s\S]*?)\] as const;/);
    expect(screensBlock, "WORKSPACE_SCREENS must be declared in ui-caring-contacts-workspace.spec.ts").not.toBeNull();
    const registeredRoutes = new Set<string>();
    for (const match of screensBlock![1].matchAll(/route:\s*([A-Z0-9_]+)/g)) {
      const resolved = constValues.get(match[1]);
      expect(resolved, `WORKSPACE_SCREENS route constant ${match[1]} must resolve`).toBeDefined();
      registeredRoutes.add(resolved!);
    }

    const declaredUrlPaths = declaredRoutes.map((routeFile) => {
      expect(existsSync(resolve(process.cwd(), routeFile)), `${routeFile} must exist on disk`).toBe(true);
      return (
        "/" +
        routeFile
          .replace(/^src\/app\//, "")
          .replace(/\/page\.tsx$/, "")
          .replace(/^page\.tsx$/, "")
      );
    });

    const matchesDeclaredPattern = (registered: string, declared: string) => {
      if (registered === declared) return true;
      const pattern = new RegExp(
        `^${declared
          .split("/")
          .map((segment) =>
            segment.startsWith("[") && segment.endsWith("]") ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          )
          .join("/")}$`,
      );
      return pattern.test(registered);
    };

    for (const urlPath of declaredUrlPaths) {
      expect(
        [...registeredRoutes].some((registered) => matchesDeclaredPattern(registered, urlPath)),
        `Route ${urlPath} must be registered in WORKSPACE_SCREENS in tests/ui-caring-contacts-workspace.spec.ts`,
      ).toBe(true);
    }

    for (const registered of registeredRoutes) {
      expect(
        declaredUrlPaths.some((declared) => matchesDeclaredPattern(registered, declared)),
        `WORKSPACE_SCREENS route ${registered} must correspond to a declared caring-contacts-workspace adoption-contract route`,
      ).toBe(true);
    }
  });
});
