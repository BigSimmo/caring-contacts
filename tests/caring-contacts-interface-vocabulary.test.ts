// tests/caring-contacts-interface-vocabulary.test.ts
//
// Item B3 (2026-08-24): extend the prohibited-word scan to interface strings.
//
// Until now, the prohibition on words like "campaign", "engagement score", and "inbox" ran only
// against outgoing messages (message-policy.ts) and the 24 frozen overlay definition rows
// (caring-contacts-overlay-definitions.test.ts). Nothing checked the words on a SCREEN, so the ban
// on interface wording was policy held by people rather than by software. This scans every string
// and template literal under the workspace and caring-contacts app trees for the same wider
// interface vocabulary (CARING_CONTACTS_PROHIBITED_LANGUAGE) already used by the overlay tests.
//
// #Z5P2BW and #0HYHTH later widened the roots from B3's two trees to every tree this feature
// renders from, except the mockups. The scan-root comment below records which, and which are
// deliberately left out.
//
// See docs/caring-contacts/phase-2b-sdd-archive/task-c-brief.md, "B3".
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { validateGovernedMessage } from "@/lib/caring-contacts/message-policy";
import { PROVISIONAL_MESSAGE_RULES } from "@/lib/caring-contacts/message-rules";

import { CARING_CONTACTS_PROHIBITED_LANGUAGE } from "./helpers/caring-contacts-prohibited-language";

// Deliberately narrow roots, not "all of src/components/caring-contacts": this excludes
// src/components/caring-contacts/mockups/** without needing a special-case skip. Mockups are
// frozen design scratch that 404 in production and knowingly contain one prohibited phrase the
// owner ruled (B4) to leave alone -- see task-c-brief.md, "B3", "Scope limits, deliberate".
//
// #Z5P2BW (2026-08-25) added the third root. `src/lib/caring-contacts/**` is the SEALED DOMAIN --
// it may import nothing outside itself (`workspace-address.ts`, enforced by
// caring-contacts-domain-isolation.test.ts) -- and it is where this feature's plain-words wording
// actually lives: `STOP_REASON_WORDING` and `APPROVAL_ROLE_WORDING` in service-state.ts,
// `CARING_CONTACT_ROLE_WORDING` in permissions.ts, `PATHWAY_APPROVAL_ROLE_WORDING` in
// pathway-versions.ts, `PLAN_ASSURANCE_WORDING` in assurances.ts, and all of message-copy.ts.
// Those strings are read off a clinician's screen, and until now NO prohibited-language scan read
// them: this scan stopped at the two trees above, and the overlay tests only ever covered the 24
// frozen rows. That is what made the recorded workaround for the "lead" rule -- move the wording
// down into `src/lib` -- move it somewhere UNWATCHED rather than somewhere exempt. Not merely
// exempt from one rule: outside every prohibited-language check in the repository.
//
// #0HYHTH (2026-08-24) added the last two. The ban on "high risk", "safe", "engagement score" and
// "risk score" ran against outgoing messages and the 24 frozen overlay rows, and B3 then added the
// two trees above; everything else this feature renders was still policy held by people rather
// than by software. `src/lib/caring-contacts-server/**` is deliberately outside the seal (it reads
// environment variables, which the sealed domain may not) and holds demo-seed.ts, whose fixture
// copy is what a demo-mode screen actually shows. `src/app/api/caring-contacts/**` carries the
// refusal wording the workspace renders when a request is declined.
//
// Deliberately still unscanned, so that the omission is a decision rather than an oversight. The
// two mockup trees (`src/components/caring-contacts/mockups/**` and
// `src/app/mockups/caring-contacts/**`) 404 in production and hold the one prohibited phrase the
// owner ruled under B4 to leave alone; the test below pins their exclusion. And this feature's
// entries in the cross-cutting catalogues it does not own -- `src/lib/tools-catalog.ts`,
// `src/lib/developer-area/**`, and others that mention it in passing. Those carry every feature's
// copy, so covering them is a wider job than this rule and would need its own scoping decision.
//
// One thing to know before taking that job on, because an earlier draft of this comment claimed
// the opposite and was wrong: `tools-catalog.ts` is NOT clean of this vocabulary. Its prescribing
// entry reads `bestFor: "Safe and effective prescribing"`, which `\bsafe\b` matches. That is a
// section title about prescribing practice, not a claim that a person is safe, so it is harmless
// where it is -- but anyone widening the roots to that file will hit it immediately, and should
// know it is expected rather than a regression they introduced.
const SCAN_ROOTS = [
  path.join(process.cwd(), "src", "components", "caring-contacts", "workspace"),
  path.join(process.cwd(), "src", "app", "caring-contacts"),
  path.join(process.cwd(), "src", "lib", "caring-contacts"),
  path.join(process.cwd(), "src", "lib", "caring-contacts-server"),
  path.join(process.cwd(), "src", "app", "api", "caring-contacts"),
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : [];
  });
}

/**
 * Every quoted string and template literal in `source`, with line/block comments skipped.
 *
 * A naive quote-matching regex over the raw source is unsound here: JSDoc comments in this tree
 * use single backticks for inline code (`` `useSearchParams` ``), and an odd number of them across
 * a comment block pairs a backtick from one inline-code span with one from a much later, unrelated
 * span, capturing the entire stretch between as a single fake "template literal". A small
 * character-by-character scan that recognises both line comments and block comments avoids that,
 * and handles escaped quote characters inside real literals.
 */
function extractStringAndTemplateLiterals(source: string): string[] {
  const literals: string[] = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const two = source.slice(i, i + 2);
    if (two === "//") {
      const end = source.indexOf("\n", i);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (two === "/*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      let j = i + 1;
      let content = "";
      while (j < n) {
        if (source[j] === "\\") {
          content += source[j] + (source[j + 1] ?? "");
          j += 2;
          continue;
        }
        if (source[j] === quote) {
          j += 1;
          break;
        }
        content += source[j];
        j += 1;
      }
      literals.push(content);
      i = j;
      continue;
    }
    i += 1;
  }
  return literals;
}

/**
 * `className` attribute VALUES are excluded before extraction. This is narrowing which literals
 * reach the scan, not adding a file to an ignore list: a `className` value is CSS/Tailwind tokens,
 * including custom-property names like `var(--safe-area-bottom)`, which contains "safe" as a
 * substring of a CSS identifier with no relationship to interface prose a patient or clinician
 * would read. Both real occurrences of `--safe-area-bottom` in this tree are inside `className`
 * attributes (shell.tsx, overlay-host.tsx) -- confirmed while building this scan.
 */
const CLASSNAME_ATTRIBUTE_VALUE = /className\s*=\s*(?:"[^"]*"|'[^']*'|\{`[^`]*`\})/g;

function extractInterfaceStrings(source: string): string[] {
  return extractStringAndTemplateLiterals(source.replace(CLASSNAME_ATTRIBUTE_VALUE, ""));
}

/**
 * `source` with comments, `className` attribute values, and quoted string/template literals all
 * removed -- what is left is the prose carrying no quotes at all, which is exactly what this pass
 * exists to read: plain JSX text between tags.
 *
 * Fix round 1 (Important 3): `extractInterfaceStrings` above only sees quoted/template-literal
 * strings, but this tree writes copy the OTHER way too -- as plain JSX text between tags (e.g.
 * shell.tsx's `<span>Caring Contacts</span>`, loading.tsx's `<p className="sr-only">Loading the
 * Caring Contacts workspace</p>`). `<p>Check your inbox for the latest campaign.</p>` extracted
 * nothing and scored zero offences under the quote-only scan, while the same words wrapped as
 * `<p>{"..."}</p>` were caught -- this function is the second pass that closes that gap.
 *
 * #Z5P2BW: blanking the quoted literals as well is a SHARPENING, not a relaxation. Every one of
 * them is already read, whole, by `extractInterfaceStrings`, so nothing stops being scanned; what
 * stops is this pass reporting the same literal a SECOND time and at a worse granularity -- the
 * literal pass names the offending string, this pass named only the fragment that matched inside
 * it. The sealed domain is where that duplication started to cost something real:
 * reach-reporting.ts's machine discriminant `"no-safe-disclosure"` is one reviewed literal to the
 * literal pass, but surfaced here as a bare "safe", and exempting a bare "safe" in that file would
 * have hidden a genuine safety claim made anywhere else in it. Literals are blanked rather than
 * deleted so that words either side of one cannot be pushed together into a phrase that was never
 * written.
 */
function rawProseOutsideStringLiterals(source: string): string {
  const withoutClassNames = source.replace(CLASSNAME_ATTRIBUTE_VALUE, "");
  let result = "";
  let i = 0;
  const n = withoutClassNames.length;
  while (i < n) {
    const two = withoutClassNames.slice(i, i + 2);
    if (two === "//") {
      const end = withoutClassNames.indexOf("\n", i);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (two === "/*") {
      const end = withoutClassNames.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    const ch = withoutClassNames[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < n) {
        if (withoutClassNames[j] === "\\") {
          j += 2;
          continue;
        }
        if (withoutClassNames[j] === ch) {
          j += 1;
          break;
        }
        j += 1;
      }
      result += " ";
      i = j;
      continue;
    }
    result += ch;
    i += 1;
  }
  return result;
}

// A `g`-flagged copy of the shared vocabulary regex, so `matchAll` can enumerate every hit in the
// raw-prose pass rather than only reporting the first (`CARING_CONTACTS_PROHIBITED_LANGUAGE`
// itself stays non-global, matching how the quoted-literal pass above uses `.test()` on it).
const CARING_CONTACTS_PROHIBITED_LANGUAGE_GLOBAL = new RegExp(
  CARING_CONTACTS_PROHIBITED_LANGUAGE.source,
  CARING_CONTACTS_PROHIBITED_LANGUAGE.flags.includes("g")
    ? CARING_CONTACTS_PROHIBITED_LANGUAGE.flags
    : `${CARING_CONTACTS_PROHIBITED_LANGUAGE.flags}g`,
);

/** Every prohibited-vocabulary match found in prose that is not inside a quoted literal. */
function scanRawProseForProhibitedLanguage(source: string): string[] {
  const stripped = rawProseOutsideStringLiterals(source);
  return [...stripped.matchAll(CARING_CONTACTS_PROHIBITED_LANGUAGE_GLOBAL)].map((match) => match[0]);
}

// ---------------------------------------------------------------------------
// #Z5P2BW: what the sealed domain contains that is NOT interface prose
//
// Scanning `src/lib/caring-contacts/**` reaches, for the first time, strings that no clinician
// will ever read: the vocabulary policy itself, and machine discriminants. Both exemptions below
// are deliberately shaped so they CANNOT quietly become blanket permission.
// ---------------------------------------------------------------------------

/**
 * The definition site of the rule doing the scanning.
 *
 * `message-rules.ts` states the vocabulary: `PROVISIONAL_MESSAGE_RULES.prohibitedTerms` is a list
 * of the banned words, and `COMMERCIAL_LEAD_PATTERN` must spell out commercial "lead" phrasing in
 * order to refuse it. A list of forbidden words necessarily contains the forbidden words; running
 * the ban across its own statement is circular, not thorough.
 *
 * The exemption is therefore NOT the whole file, which would be the easy thing to write and the
 * wrong thing to have. That same file holds the five sentences a discharged patient actually reads
 * in an SMS -- `programmeLine`, `operatingHours`, `emergencyDirection`, `crisisSupportContact` and
 * `closingStatement` -- and exempting the file whole would put the highest-consequence wording in
 * this feature permanently outside the scan, on the one commit whose purpose is to reach wording
 * nothing was watching. It would matter: this vocabulary is deliberately WIDER than
 * `prohibitedTerms`, adding "clinical risk", "risk score", "wellbeing score" and the two
 * reply-monitoring claims, and `validateGovernedMessage` checks none of those. A closing message
 * edited to say "Replies are monitored 9 am-6 pm" would pass the message validator, and only this
 * scan would be left to catch it.
 *
 * So the exemption is computed from the policy instead: in this file, an offence is exempt only
 * when the offending text is EXACTLY one of the terms the file exists to declare. That covers all
 * eleven of its offences -- the nine `prohibitedTerms` literals, and the "conversion" and "lead"
 * fragments the raw pass reads out of `COMMERCIAL_LEAD_PATTERN`'s own source, both of which are
 * themselves prohibited terms -- while leaving every sentence in the file scanned. It also needs
 * no maintenance when a tenth term is added.
 */
const PROHIBITED_VOCABULARY_DEFINITION_SITE = path.join("src", "lib", "caring-contacts", "message-rules.ts");

/** The terms `message-rules.ts` is obliged to spell out, lower-cased for comparison. */
const DECLARED_PROHIBITED_TERMS: ReadonlySet<string> = new Set(
  PROVISIONAL_MESSAGE_RULES.prohibitedTerms.map((term) => term.toLowerCase()),
);

/**
 * Individual literals that are machine identifiers rather than wording, each with its reason.
 *
 * This is a reviewed table keyed on an exact string in a NAMED file -- not an ignore list of
 * files. Any other offending string in the same file still fails the scan, and a test below fails
 * when an entry no longer matches anything, so an exemption cannot outlive the literal it was
 * written for. Add to it only for a value that is genuinely never rendered; wording that a
 * clinician reads belongs in the scan, and if the scan is wrong about that wording then the rule
 * is what needs fixing.
 */
const NON_INTERFACE_LITERAL_EXEMPTIONS: readonly {
  readonly file: string;
  readonly text: string;
  readonly because: string;
}[] = [
  {
    file: path.join("src", "lib", "caring-contacts", "reach-reporting.ts"),
    text: "no-safe-disclosure",
    because:
      "A `ReachWithholdingReason` discriminant, one of three tags on a withheld disclosure. It " +
      "names an arithmetic property of a suppressed breakdown -- that no safe publication of it " +
      "exists -- and is never rendered; the wording a clinician reads for it lives in the " +
      "workspace tree, which this scan already covers.",
  },
  {
    file: path.join("src", "lib", "caring-contacts-server", "demo-seed.ts"),
    text: "pathway-approve-clinical-programme-lead",
    because:
      "A demo-seed write label. It becomes the `idempotencyKey` on the audit entry that records " +
      "which approval was written -- see writeAs in demo-seed.ts and audit.ts -- and nothing in " +
      "the workspace or app trees renders an idempotencyKey, so it reaches the audit record and " +
      "never a screen. Its hyphens are the whole reason it matches: the job-title exemption looks " +
      "for a qualifier followed by a space, so `programme-lead` reads as a bare `lead` where " +
      "`programme lead` does not.",
  },
];

/**
 * An exemption may only ever suppress a SHORT, SINGLE-LINE string.
 *
 * The tokenizer treats an apostrophe in JSX text (`<p>Don\'t ...</p>`) as opening a string
 * literal and swallows everything to the next quote or to end of file. Detection survives -- the
 * literal pass still reports that whole swallowed range, so nothing goes unnoticed -- but the
 * report looks like machine junk, and the obvious response to machine junk is to paste it into the
 * table below. That would exempt every word in the swallowed range at once, which is the one way
 * this table could quietly become the ignore list it is written not to be. A machine identifier is
 * never long and never spans lines; a swallowed range almost always is one or both.
 */
function isPlausiblyAnIdentifier(text: string): boolean {
  return !text.includes("\n") && text.length <= 120;
}

function isExemptOffence(relativePath: string, text: string): boolean {
  if (!isPlausiblyAnIdentifier(text)) return false;
  if (relativePath === PROHIBITED_VOCABULARY_DEFINITION_SITE) {
    return DECLARED_PROHIBITED_TERMS.has(text.trim().toLowerCase());
  }
  return NON_INTERFACE_LITERAL_EXEMPTIONS.some(
    (exemption) => exemption.file === relativePath && exemption.text === text,
  );
}

/**
 * How many times each declared term may legitimately appear as a QUOTED LITERAL in the definition
 * site: exactly the number of times it is written inside the `prohibitedTerms` array itself.
 *
 * Raised by the Codex review of 91c6766. Matching on text alone said "this literal is one of the
 * declared terms" when the question is "this literal IS the declaration". If message-rules.ts later
 * gained a rendered label whose whole literal happened to equal a banned word -- a stop-reason or
 * status wording of exactly `"safe"` -- text equality could not tell it from the array entry, and
 * the scan would stay green on the one file that also holds the sentences a discharged patient
 * reads. That is the same failure the whole-file exemption had, returning through a narrower door.
 *
 * A budget closes it without an AST. The array declares each term once, so one occurrence of each
 * is explained and a second is not, whatever it is or wherever it sits. Fails closed: if the
 * declaration cannot be located, or the literals parsed out of it do not match
 * `PROVISIONAL_MESSAGE_RULES.prohibitedTerms` exactly, this throws rather than exempting anything.
 * That cross-check is what ties the text parsed here to the value the application actually uses, so
 * the two cannot drift apart silently.
 */
function declaredTermBudget(source: string): Map<string, number> {
  // Anchored on the VALUE, `prohibitedTerms: Object.freeze([`, not on the bare field name: the
  // first `prohibitedTerms:` in the file is the type declaration, `readonly string[]`, whose `]`
  // closes an empty range. That mistake produced an empty budget rather than a wrong one, and the
  // cross-check below caught it -- which is the fail-closed behaviour working, and the reason the
  // cross-check is not optional.
  const start = source.indexOf("prohibitedTerms: Object.freeze([");
  const end = start === -1 ? -1 : source.indexOf("]", start);
  if (start === -1 || end === -1) {
    throw new Error(
      `could not locate the prohibitedTerms declaration in ${PROHIBITED_VOCABULARY_DEFINITION_SITE}; ` +
        "the definition-site exemption is not safe to apply without it",
    );
  }

  const budget = new Map<string, number>();
  for (const literal of extractStringAndTemplateLiterals(source.slice(start, end + 1))) {
    const term = literal.trim().toLowerCase();
    budget.set(term, (budget.get(term) ?? 0) + 1);
  }

  const declared = [...budget.keys()].sort();
  const expected = [...DECLARED_PROHIBITED_TERMS].sort();
  if (declared.join("\u0000") !== expected.join("\u0000")) {
    throw new Error(
      `the prohibitedTerms literals parsed from ${PROHIBITED_VOCABULARY_DEFINITION_SITE} ` +
        `(${JSON.stringify(declared)}) do not match PROVISIONAL_MESSAGE_RULES.prohibitedTerms ` +
        `(${JSON.stringify(expected)})`,
    );
  }
  return budget;
}

type Offence = { readonly file: string; readonly text: string; readonly label: string };

/**
 * Every offence in one file: quoted/template-literal strings, plus raw prose (JSX text).
 *
 * `applyExemptions` is false only in the anti-rot tests below, which need to see what the
 * exemptions are actually suppressing.
 */
function findOffencesInSource(relativePath: string, source: string, applyExemptions = true): Offence[] {
  const isDefinitionSite = relativePath === PROHIBITED_VOCABULARY_DEFINITION_SITE;
  // Consumed as literals are seen, so the SECOND `"safe"` in this file is reported even though the
  // first -- the declaration itself -- is not.
  const budget = applyExemptions && isDefinitionSite ? declaredTermBudget(source) : new Map<string, number>();

  const offences: Offence[] = [];
  const record = (text: string, label: string) => {
    if (applyExemptions && isExemptOffence(relativePath, text)) return;
    offences.push({ file: relativePath, text, label });
  };

  for (const literal of extractInterfaceStrings(source)) {
    if (!CARING_CONTACTS_PROHIBITED_LANGUAGE.test(literal)) continue;
    if (isDefinitionSite) {
      const remaining = budget.get(literal.trim().toLowerCase()) ?? 0;
      if (applyExemptions && remaining > 0) {
        budget.set(literal.trim().toLowerCase(), remaining - 1);
        continue;
      }
      offences.push({ file: relativePath, text: literal, label: "" });
      continue;
    }
    record(literal, "");
  }

  // The raw pass blanks every quoted literal, so in this tree it can only ever surface identifiers
  // and regex source -- here, "conversion" and "lead" out of COMMERCIAL_LEAD_PATTERN. A rendered
  // label is always a literal, so nothing this pass reports in the definition site can be one, and
  // the budget above does not apply to it.
  for (const match of scanRawProseForProhibitedLanguage(source)) {
    record(match, " (raw prose, e.g. JSX text)");
  }
  return offences;
}

function findOffencesInFile(file: string, applyExemptions = true): Offence[] {
  return findOffencesInSource(path.relative(process.cwd(), file), readFileSync(file, "utf8"), applyExemptions);
}

/** The same offences, rendered for a failure message: the file, how it was found, and the text. */
function scanOneFileForProhibitedLanguage(file: string, applyExemptions = true): string[] {
  return findOffencesInFile(file, applyExemptions).map(
    (offence) => `${offence.file}${offence.label}: ${JSON.stringify(offence.text)}`,
  );
}

/** Every `root -> file -> offending literal` combination found under `root`. */
function scanRootForProhibitedLanguage(root: string): string[] {
  return walk(root).flatMap((file) => scanOneFileForProhibitedLanguage(file));
}

describe("caring-contacts interface vocabulary (B3)", () => {
  it("finds a deliberately planted prohibited string in a fixture -- proving the scan can fail", () => {
    // Runs the real file-scanning code path (walk + read + extract + match) against a temporary
    // fixture, not just the extraction function in isolation. "A scan that cannot fail is worse
    // than no scan" (task-c-brief.md) -- this is that proof.
    const fixtureDir = mkdtempSync(path.join(tmpdir(), "caring-contacts-interface-vocabulary-fixture-"));
    try {
      writeFileSync(
        path.join(fixtureDir, "planted-banner.tsx"),
        [
          "export function PlantedBanner() {",
          '  return <p>{"Following up on your sales lead from this campaign."}</p>;',
          "}",
          "",
        ].join("\n"),
        "utf8",
      );

      const offences = scanRootForProhibitedLanguage(fixtureDir);
      expect(offences.length).toBeGreaterThan(0);
      expect(offences.some((offence) => offence.includes("campaign"))).toBe(true);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  // Fix round 1 (Important 3): the extractor above only sees quoted/template-literal strings, but
  // this tree writes copy the OTHER way too -- as plain JSX text between tags with no quotes at
  // all (e.g. shell.tsx's `<span>Caring Contacts</span>`, loading.tsx's `<p className="sr-only">
  // Loading the Caring Contacts workspace</p>`). `<p>Check your inbox for the latest
  // campaign.</p>` extracted nothing and scored zero offences before this fix, while the same
  // words wrapped as `<p>{"..."}</p>` were caught -- an inconsistency the fixture below is
  // deliberately shaped to close, not to lean on.
  it("finds a prohibited word planted as PLAIN JSX TEXT, not just inside quotes", () => {
    const fixtureDir = mkdtempSync(path.join(tmpdir(), "caring-contacts-interface-vocabulary-jsx-text-fixture-"));
    try {
      writeFileSync(
        path.join(fixtureDir, "planted-plain-text-banner.tsx"),
        [
          "export function PlantedPlainTextBanner() {",
          "  return <p>Check your inbox for the latest campaign.</p>;",
          "}",
          "",
        ].join("\n"),
        "utf8",
      );

      const offences = scanRootForProhibitedLanguage(fixtureDir);
      expect(offences.length).toBeGreaterThan(0);
      expect(offences.some((offence) => offence.includes("inbox"))).toBe(true);
      expect(offences.some((offence) => offence.includes("campaign"))).toBe(true);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("finds nothing in the real workspace, caring-contacts app, and sealed domain trees", () => {
    // Minor 7: a root that exists but holds no .ts/.tsx file would otherwise pass this test
    // vacuously -- close that with a floor on how many files were actually read.
    //
    // #Z5P2BW made that floor PER ROOT rather than a total. The aggregate floor was already
    // satisfied by the two original roots on their own, so a newly added root that resolved to
    // nothing -- a mistyped path segment, a directory since renamed -- would have been reported as
    // clean rather than as unread. The whole point of adding a root is that it gets read.
    const filesByRoot = SCAN_ROOTS.map((root) => [path.relative(process.cwd(), root), walk(root)] as const);
    const rootsThatMatchedNoFile = filesByRoot.filter(([, files]) => files.length === 0).map(([root]) => root);
    expect(rootsThatMatchedNoFile).toEqual([]);

    const offences = filesByRoot.flatMap(([, files]) =>
      files.flatMap((file) => scanOneFileForProhibitedLanguage(file)),
    );
    expect(offences).toEqual([]);
  });

  it("reads the sealed domain's wording constants, which no prohibited-language scan reached before", () => {
    // Naming the files, rather than trusting the root path to have covered them, is what makes the
    // clean result above mean "these were read and were clean" instead of "some files were read".
    // Each of these holds plain-words wording rendered on a clinician's screen: STOP_REASON_WORDING
    // and APPROVAL_ROLE_WORDING, CARING_CONTACT_ROLE_WORDING, PATHWAY_APPROVAL_ROLE_WORDING,
    // PLAN_ASSURANCE_WORDING, and the message copy itself.
    const sealedDomain = path.join(process.cwd(), "src", "lib", "caring-contacts");
    expect(SCAN_ROOTS).toContain(sealedDomain);

    const scanned = walk(sealedDomain).map((file) => path.relative(process.cwd(), file));
    for (const file of [
      "service-state.ts",
      "permissions.ts",
      "pathway-versions.ts",
      "assurances.ts",
      "message-copy.ts",
    ]) {
      expect(scanned).toContain(path.join("src", "lib", "caring-contacts", file));
    }
  });

  it("reads the demo seed and the caring-contacts API routes (#0HYHTH)", () => {
    // demo-seed.ts is the fixture copy a demo-mode screen actually shows; the API routes carry the
    // refusal wording the workspace renders when a request is declined. Neither was read by any
    // prohibited-language check before.
    const scanned = SCAN_ROOTS.flatMap((root) => walk(root)).map((file) => path.relative(process.cwd(), file));
    expect(scanned).toContain(path.join("src", "lib", "caring-contacts-server", "demo-seed.ts"));
    expect(scanned.some((file) => file.startsWith(path.join("src", "app", "api", "caring-contacts")))).toBe(true);
  });

  it("keeps the mockup trees out of the scan, which is a ruling and not an oversight", () => {
    // B4 ruled the one prohibited phrase in the mockups to be left alone, and mockups 404 in
    // production. Widening a root to "all of src/components/caring-contacts" would quietly reverse
    // that ruling, so the exclusion is asserted rather than left to the shape of the root paths.
    const scanned = SCAN_ROOTS.flatMap((root) => walk(root)).map((file) => path.relative(process.cwd(), file));
    expect(scanned.filter((file) => file.split(path.sep).includes("mockups"))).toEqual([]);
  });

  it("catches a prohibited word planted in a sealed-domain wording map", () => {
    // The sealed domain is .ts, not .tsx: its copy arrives as object values in a `*_WORDING` map
    // rather than as JSX text. This is the planted-failure proof for that shape specifically --
    // the two fixtures above both plant into a component.
    const fixtureDir = mkdtempSync(path.join(tmpdir(), "caring-contacts-interface-vocabulary-wording-fixture-"));
    try {
      writeFileSync(
        path.join(fixtureDir, "planted-wording.ts"),
        [
          "export const PLANTED_STOP_REASON_WORDING = Object.freeze({",
          '  "audit-integrity-loss": "the service is safe to resume",',
          "});",
          "",
        ].join("\n"),
        "utf8",
      );

      const offences = scanRootForProhibitedLanguage(fixtureDir);
      expect(offences).toHaveLength(1);
      expect(offences[0]).toContain("the service is safe to resume");
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("still catches a prohibited word in JSX text that contains an apostrophe", () => {
    // The one case where blanking quoted literals in the raw pass could plausibly have lost
    // coverage. `Don't` makes the tokenizer treat the apostrophe as opening a string and swallow
    // to the next quote or to end of file, so the raw pass now blanks the very text carrying the
    // offence. The literal pass reads that same swallowed range and reports it, which is why the
    // sharpening is coverage-neutral rather than a quiet weakening -- pinned here because the
    // reasoning is not obvious from either function alone.
    const fixtureDir = mkdtempSync(path.join(tmpdir(), "caring-contacts-interface-vocabulary-apostrophe-fixture-"));
    try {
      writeFileSync(
        path.join(fixtureDir, "planted-apostrophe.tsx"),
        [
          "export function PlantedApostrophe() {",
          "  return <p>Don't check your inbox for the campaign.</p>;",
          "}",
          "",
        ].join("\n"),
        "utf8",
      );

      const offences = scanRootForProhibitedLanguage(fixtureDir);
      expect(offences).not.toEqual([]);
      expect(offences.some((offence) => offence.includes("inbox"))).toBe(true);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("reports a quoted literal once, not a second time as raw prose", () => {
    // #Z5P2BW: the raw-prose pass used to re-report every quoted literal, at the coarser
    // granularity of the matched fragment rather than the whole string. Two reports of one offence
    // is only noise while the tree is clean; it becomes a correctness problem the moment a literal
    // has to be exempted by name, because the shadow report carries a different, much broader
    // string. Pinned here so the raw pass cannot drift back to reading inside quotes.
    const fixtureDir = mkdtempSync(path.join(tmpdir(), "caring-contacts-interface-vocabulary-single-report-fixture-"));
    try {
      writeFileSync(
        path.join(fixtureDir, "planted-notice.ts"),
        ['export const PLANTED_NOTICE = "Check your inbox.";', ""].join("\n"),
        "utf8",
      );

      const offences = scanRootForProhibitedLanguage(fixtureDir);
      expect(offences).toHaveLength(1);
      expect(offences[0]).toContain("Check your inbox.");
      expect(offences[0]).not.toContain("raw prose");
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("distinguishes clinical job titles from commercial lead generation", () => {
    expect("clinical programme lead").not.toMatch(CARING_CONTACTS_PROHIBITED_LANGUAGE);
    expect("incident lead").not.toMatch(CARING_CONTACTS_PROHIBITED_LANGUAGE);
    expect("team lead").not.toMatch(CARING_CONTACTS_PROHIBITED_LANGUAGE);
    expect("service lead").not.toMatch(CARING_CONTACTS_PROHIBITED_LANGUAGE);
    expect("clinical lead").not.toMatch(CARING_CONTACTS_PROHIBITED_LANGUAGE);

    expect("sales lead generation").toMatch(CARING_CONTACTS_PROHIBITED_LANGUAGE);
    expect("new leads").toMatch(CARING_CONTACTS_PROHIBITED_LANGUAGE);
    expect("lead capture").toMatch(CARING_CONTACTS_PROHIBITED_LANGUAGE);
    expect("sales team lead generation").toMatch(CARING_CONTACTS_PROHIBITED_LANGUAGE);
    expect("clinical lead capture").toMatch(CARING_CONTACTS_PROHIBITED_LANGUAGE);
    expect("Our team lead nurturing numbers are up").toMatch(CARING_CONTACTS_PROHIBITED_LANGUAGE);
  });
});

describe("the sealed-domain exemptions stay narrow, and cannot rot (#Z5P2BW)", () => {
  it("exempts nothing in the definition site but the vocabulary it is obliged to declare", () => {
    // Asserting the SET, not merely that the set is non-empty. Non-emptiness cannot fail here:
    // `prohibitedTerms` is a required field of `ProvisionalMessageRules`, so the file structurally
    // always contains the banned words, and a test that cannot fail is not a control. The rot that
    // actually threatens this exemption is new NON-definitional wording added to the file, which
    // is what this catches.
    const definitionSite = path.join(process.cwd(), PROHIBITED_VOCABULARY_DEFINITION_SITE);
    const everyOffence = findOffencesInFile(definitionSite, false);
    expect(everyOffence).not.toEqual([]);

    const notDeclaredVocabulary = everyOffence
      .filter((offence) => !DECLARED_PROHIBITED_TERMS.has(offence.text.trim().toLowerCase()))
      .map((offence) => offence.text);
    expect(notDeclaredVocabulary).toEqual([]);
    expect(scanOneFileForProhibitedLanguage(definitionSite)).toEqual([]);
  });

  it("leaves the sentences a patient actually reads inside the scan", () => {
    // The reason the definition-site exemption is computed rather than whole-file. These five are
    // the SMS a discharged patient receives, and they live in the same file as the vocabulary that
    // governs them. Exempting the file would have put them permanently outside every check that is
    // wider than `validateGovernedMessage` -- which is where "clinical risk", "risk score",
    // "wellbeing score" and the reply-monitoring claims all live.
    const patientVisible = [
      PROVISIONAL_MESSAGE_RULES.programmeLine,
      PROVISIONAL_MESSAGE_RULES.operatingHours,
      PROVISIONAL_MESSAGE_RULES.emergencyDirection,
      PROVISIONAL_MESSAGE_RULES.crisisSupportContact,
      PROVISIONAL_MESSAGE_RULES.closingStatement,
    ];
    for (const sentence of patientVisible) {
      expect(isExemptOffence(PROHIBITED_VOCABULARY_DEFINITION_SITE, sentence), sentence).toBe(false);
    }

    // The falsifiability proof for the above, stated on the rule rather than on today's wording:
    // a closing message that claimed replies were monitored would pass `validateGovernedMessage`
    // (it checks none of these terms) and would be reported by this scan.
    expect(
      isExemptOffence(
        PROHIBITED_VOCABULARY_DEFINITION_SITE,
        "This is the final message in this programme. Replies are monitored 9 am-6 pm.",
      ),
    ).toBe(false);
    expect(isExemptOffence(PROHIBITED_VOCABULARY_DEFINITION_SITE, "safe")).toBe(true);
  });

  it("refuses to exempt a long or multi-line string, however it got into the table", () => {
    // An apostrophe in JSX text makes the tokenizer swallow everything to the next quote, and the
    // literal pass then reports that whole range. Detection survives, but the report looks like
    // junk, and pasting junk into the table would exempt every word inside it at once. A machine
    // identifier is short and single-line; a swallowed range is not.
    const anyFile = path.join("src", "lib", "caring-contacts", "reach-reporting.ts");
    expect(isExemptOffence(anyFile, "no-safe-disclosure")).toBe(true);
    expect(isExemptOffence(anyFile, "no-safe-disclosure\nand a second line of swallowed copy")).toBe(false);
    expect(isExemptOffence(anyFile, `no-safe-disclosure${" x".repeat(80)}`)).toBe(false);
    expect(isExemptOffence(PROHIBITED_VOCABULARY_DEFINITION_SITE, `safe${" x".repeat(80)}`)).toBe(false);
  });

  it("reports a second literal equal to a banned term in the definition site, not just the declaration", () => {
    // The Codex review of 91c6766, and the falsifiability proof it asked for. Matching on text
    // alone said "this literal is one of the declared terms" when the question is "this literal IS
    // the declaration", so a rendered label in that file whose whole literal happened to equal a
    // banned word would have been exempted -- in the one file that also holds the sentences a
    // discharged patient reads. Proved against the REAL source with one line added, rather than a
    // hand-built fixture, so the parse being exercised is the one that runs in anger.
    const definitionSite = path.join(process.cwd(), PROHIBITED_VOCABULARY_DEFINITION_SITE);
    const realSource = readFileSync(definitionSite, "utf8");
    expect(findOffencesInSource(PROHIBITED_VOCABULARY_DEFINITION_SITE, realSource)).toEqual([]);

    const withPlantedLabel = `const PLANTED_STOP_REASON_LABEL = "safe";\n${realSource}`;
    const offences = findOffencesInSource(PROHIBITED_VOCABULARY_DEFINITION_SITE, withPlantedLabel);
    expect(offences.map((offence) => offence.text)).toEqual(["safe"]);

    // A whole prohibited phrase, and a term that is not a single word, behave the same way.
    const withPlantedPhrase = `const PLANTED = "engagement score";\n${realSource}`;
    expect(findOffencesInSource(PROHIBITED_VOCABULARY_DEFINITION_SITE, withPlantedPhrase).map((o) => o.text)).toEqual([
      "engagement score",
    ]);
  });

  it("refuses to exempt anything when it cannot find or trust the declaration", () => {
    // Fail closed. A budget that cannot be built is not a licence to exempt on text alone -- that
    // is the behaviour this replaced. Both failure modes throw rather than returning no offences:
    // the declaration missing entirely, and a declaration whose literals disagree with the value
    // the application actually uses.
    expect(() => findOffencesInSource(PROHIBITED_VOCABULARY_DEFINITION_SITE, 'const x = "safe";')).toThrow(
      /could not locate the prohibitedTerms declaration/,
    );

    const definitionSite = path.join(process.cwd(), PROHIBITED_VOCABULARY_DEFINITION_SITE);
    const withDroppedTerm = readFileSync(definitionSite, "utf8").replace('    "high risk",\n', "");
    expect(() => findOffencesInSource(PROHIBITED_VOCABULARY_DEFINITION_SITE, withDroppedTerm)).toThrow(
      /do not match PROVISIONAL_MESSAGE_RULES\.prohibitedTerms/,
    );
  });

  it("keeps no literal exemption that has stopped matching anything", () => {
    const stale = NON_INTERFACE_LITERAL_EXEMPTIONS.filter((exemption) => {
      const offences = scanOneFileForProhibitedLanguage(path.join(process.cwd(), exemption.file), false);
      return !offences.some((offence) => offence.endsWith(`: ${JSON.stringify(exemption.text)}`));
    }).map((exemption) => `${exemption.file}: ${JSON.stringify(exemption.text)}`);
    expect(stale).toEqual([]);
  });

  it("exempts the exact literal, not the file around it nor the same string elsewhere", () => {
    // The difference between this table and an ignore list. Both axes are pinned: another
    // offending string in an exempted file still fails, and the exempted string still fails in any
    // other file.
    for (const exemption of NON_INTERFACE_LITERAL_EXEMPTIONS) {
      expect(isExemptOffence(exemption.file, exemption.text)).toBe(true);
      expect(isExemptOffence(exemption.file, "the patient is safe")).toBe(false);
      expect(isExemptOffence(path.join("src", "lib", "caring-contacts", "service-state.ts"), exemption.text)).toBe(
        false,
      );
    }
  });

  it("states a reason for every exemption", () => {
    // A reason is what a later reader needs in order to decide the exemption is still right. An
    // entry that cannot state one is an entry that should not be here.
    for (const exemption of NON_INTERFACE_LITERAL_EXEMPTIONS) {
      expect(exemption.because.length, `${exemption.file}: ${exemption.text}`).toBeGreaterThan(40);
    }
  });
});

// ---------------------------------------------------------------------------
// Ruling [143] — the "lead" rule has TWO definitions, and the patient-facing one was the weaker
//
// `CARING_CONTACTS_PROHIBITED_LANGUAGE` above governs what a CLINICIAN reads on a screen.
// `PROVISIONAL_MESSAGE_RULES.prohibitedTermPatternOverrides.lead` governs what a DISCHARGED
// PATIENT reads in a message. They were written by two different sessions and nothing held them in
// step: measured over the same phrases, seven disagreed, and every disagreement ran the same way --
// the screen refused and the message permitted. The surface with the worse consequence had the
// weaker guard.
//
// Two definitions for two surfaces is defensible; the message side being the LOOSER of the two is
// not. This block pins the invariant that fixes the direction, and it is the durable half of that
// fix: the pattern edit stops today's seven, this stops the next seven from arriving unnoticed.
//
// Deliberately NOT an equality between the two regexes. They legitimately differ -- the screen list
// also bans scoring and reply-monitoring claims a message could not make -- so equality would be a
// false pin that later, correct divergence would have to weaken. The invariant is one-directional:
// NOTHING the screen refuses may be permitted in a message.
// ---------------------------------------------------------------------------

/** What a clinician's screen refuses. */
function screenRefuses(text: string): boolean {
  return CARING_CONTACTS_PROHIBITED_LANGUAGE.test(text);
}

/**
 * Whether a MESSAGE to a patient would be refused for the prohibited term "lead".
 *
 * Asked through `validateGovernedMessage` rather than by testing the override pattern directly:
 * that is the surface a message actually passes through, and a pattern proven in isolation would
 * not notice an override that stopped being wired into `prohibitedTermPatternOverrides` at all.
 * The issue is matched on its term so a phrase that also tripped another prohibited term could not
 * be mistaken for the "lead" rule working.
 */
function messageRefusesLead(text: string): boolean {
  const result = validateGovernedMessage({ text, messageType: "standard" });
  return !result.valid && result.issues.some((issue) => issue.code === "prohibited-term" && issue.term === "lead");
}

// Job titles this domain's own wording actually uses. BOTH surfaces must permit these: refusing a
// clinician's real title is its own defect, and so is a message that cannot say "the clinical lead".
const LEAD_JOB_TITLES_BOTH_PERMIT = [
  "Please contact the incident lead for an update.",
  "This was escalated to the programme lead.",
  "This was escalated to the clinical programme lead.",
  "Speak to the clinical lead about this.",
  "The team lead approved the change.",
  "Contact the service lead for details.",
];

// Of the seven phrases Ruling [143] measured as divergent -- the screen refused each and the message
// permitted it -- these two remain refused on both. Listed separately so a regression names which
// came back. The other five were the plural job titles, which moved to the list below when the
// owner decided their case on 2026-09-02.
const LEAD_PHRASES_RULING_143_MEASURED_DIVERGENT = ["clinical lead capture", "team lead nurturing numbers"];

// The plural job titles, and the one place these two definitions deliberately disagree.
//
// Ruling [143] refused `leads` outright on both surfaces, reasoning that nobody's job title is
// plural. True of one person's title, false of a group of them: "the clinical leads met on Tuesday"
// is ordinary English a clinician had no way to write. #AGRAKQ carried the point, and the owner
// decided on 2026-09-02 to extend the job-title exemption to the plural ON THE SCREEN ONLY.
//
// So the screen must PERMIT these and the message must still REFUSE them -- and that is asserted
// in both directions below rather than only the half that changed, because a later edit that
// "tidied up" the message side to match would loosen the wording a discharged patient receives,
// which is the one thing this decision was shaped to avoid. The invariant in the last test still
// holds: it forbids a message permitting what the screen refuses, and this is the opposite
// direction, which is why the decision could be taken here without weakening anything.
const LEAD_PLURAL_JOB_TITLES_SCREEN_ONLY = [
  "team leads",
  "clinical leads",
  "programme leads",
  "service leads",
  "incident leads",
  "The clinical leads met on Tuesday.",
];

// Commercial phrasing both surfaces already refused, kept as the control that the direction of the
// fix is "make the message stricter" rather than "make the screen looser".
const LEAD_PHRASES_BOTH_ALREADY_REFUSED = [
  "lead capture",
  "new leads",
  "sales lead generation",
  "Check out our new lead magnet.",
  "Please qualify this lead.",
  // Added 2026-09-02 with the plural exemption. These two are what the plural COMPANION branch
  // exists for -- an exempting qualifier must not license what follows it -- so they belong in the
  // corpus the invariant walks, not as inline assertions that only ever check the screen half.
  "clinical leads capture",
  "sales leads",
];

describe('the "lead" rule is defined twice, and the message side is never the looser one (Ruling [143])', () => {
  it("permits this domain's job titles on BOTH surfaces", () => {
    for (const phrase of LEAD_JOB_TITLES_BOTH_PERMIT) {
      expect(screenRefuses(phrase), `screen refuses the job title ${JSON.stringify(phrase)}`).toBe(false);
      expect(messageRefusesLead(phrase), `message refuses the job title ${JSON.stringify(phrase)}`).toBe(false);
    }
  });

  it("permits plural job titles on the screen while a message still refuses them (owner decision, 2026-09-02)", () => {
    for (const phrase of LEAD_PLURAL_JOB_TITLES_SCREEN_ONLY) {
      expect(screenRefuses(phrase), `screen still refuses the plural job title ${JSON.stringify(phrase)}`).toBe(false);
      expect(messageRefusesLead(phrase), `a message now permits ${JSON.stringify(phrase)}`).toBe(true);
    }
  });

  it("refuses on BOTH surfaces every phrase Ruling [143] measured as divergent", () => {
    for (const phrase of LEAD_PHRASES_RULING_143_MEASURED_DIVERGENT) {
      // The screen half is the positive control: it establishes that this phrase really is one the
      // interface rule refuses, so the message half below is a comparison rather than a lone claim.
      expect(screenRefuses(phrase), `screen no longer refuses ${JSON.stringify(phrase)}`).toBe(true);
      expect(messageRefusesLead(phrase), `a patient could still read ${JSON.stringify(phrase)}`).toBe(true);
    }
  });

  it("keeps refusing on BOTH surfaces the commercial phrasing neither ever allowed", () => {
    for (const phrase of LEAD_PHRASES_BOTH_ALREADY_REFUSED) {
      expect(screenRefuses(phrase), `screen no longer refuses ${JSON.stringify(phrase)}`).toBe(true);
      expect(messageRefusesLead(phrase), `message no longer refuses ${JSON.stringify(phrase)}`).toBe(true);
    }
  });

  it("permits in a message NOTHING the screen refuses, across every phrase above", () => {
    // The invariant itself, stated over the union rather than per list, so a phrase added to only
    // one list in future is still held to it. Reported as the offending phrases, not as a count.
    const everyPhrase = [
      ...LEAD_JOB_TITLES_BOTH_PERMIT,
      ...LEAD_PLURAL_JOB_TITLES_SCREEN_ONLY,
      ...LEAD_PHRASES_RULING_143_MEASURED_DIVERGENT,
      ...LEAD_PHRASES_BOTH_ALREADY_REFUSED,
    ];
    const refusedOnScreenButPermittedInAMessage = everyPhrase.filter(
      (phrase) => screenRefuses(phrase) && !messageRefusesLead(phrase),
    );
    expect(refusedOnScreenButPermittedInAMessage).toEqual([]);

    // Positive controls, so the empty list above cannot be the vacuous kind: the corpus really does
    // contain phrases the screen refuses, and really does contain phrases it permits. Without both,
    // an interface rule that had stopped matching anything at all would satisfy the filter.
    expect(everyPhrase.filter(screenRefuses)).not.toEqual([]);
    expect(everyPhrase.filter((phrase) => !screenRefuses(phrase))).not.toEqual([]);
  });
});
