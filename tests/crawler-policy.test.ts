// Standalone extract: only the Caring Contacts case of PsychSift's tests/crawler-policy.test.ts is
// kept. Dropped: the public-indexing and robots.txt sitemap cases (this copy has no
// src/app/robots.ts and no public pages -- its root layout is private), and the offline.html case
// (no public/offline.html here). Changed: PsychSift's mockups had their own
// src/app/mockups/layout.tsx carrying the private robots object; this copy has none, so the
// Caring Contacts mockups inherit the root layout's metadata, and the case now checks that the root
// layout carries the private object, that it is not the public one, and that no mockup file
// overrides it. The root layout is read as text, as the original read the mockups layout, because
// it loads next/font, which Vitest cannot import.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "vitest";

import { metadata as caringContactsMetadata } from "../src/app/caring-contacts/layout";
import { PRIVATE_APP_ROBOTS_METADATA } from "../src/lib/crawler-policy";

function sourceFilesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFilesUnder(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

it("keeps Caring Contacts and mockups on the private noindex robots object", () => {
  expect(PRIVATE_APP_ROBOTS_METADATA).toMatchObject({
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
      nosnippet: true,
    },
  });
  expect(caringContactsMetadata.robots).toEqual(PRIVATE_APP_ROBOTS_METADATA);

  // The mockups have no layout of their own here, so the root layout is what makes them private.
  const rootLayout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");
  expect(rootLayout).toContain("robots: PRIVATE_APP_ROBOTS_METADATA");
  expect(rootLayout).not.toContain("PUBLIC_APP_ROBOTS_METADATA");

  // ...and nothing under the mockup routes replaces that robots object with another one.
  const mockupFiles = sourceFilesUnder(join(process.cwd(), "src/app/mockups"));
  expect(mockupFiles.length).toBeGreaterThan(0);
  const overriding = mockupFiles.filter((file) => {
    const source = readFileSync(file, "utf8");
    return /\brobots\s*:/.test(source) && !source.includes("robots: PRIVATE_APP_ROBOTS_METADATA");
  });
  expect(overriding).toEqual([]);
});
