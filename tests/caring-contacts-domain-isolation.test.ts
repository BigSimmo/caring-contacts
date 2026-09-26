// tests/caring-contacts-domain-isolation.test.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PLAN_ASSURANCE_VALUES } from "@/lib/caring-contacts/assurances";
import { PREFERRED_NAME_MAX_SEPTETS } from "@/lib/caring-contacts/message-copy";

const DOMAIN_ROOT = path.join(process.cwd(), "src", "lib", "caring-contacts");
const CARING_CONTACTS_ASSURANCE_MIGRATION = "0006_caring_contacts_plan_assurances.sql";
const CARING_CONTACTS_PREFERRED_NAME_MIGRATION = "0007_caring_contacts_preferred_name.sql";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith(".ts") ? [full] : [];
  });
}

/**
 * Every module specifier in a file, however it is written.
 *
 * The earlier form required WHITESPACE after the keyword, so `await import("@supabase/supabase-js")`
 * and `require("openai")` -- the two shapes a provider is most likely to arrive through once
 * someone wants it loaded lazily -- were invisible to both assertions below. `\s*\(?\s*` covers the
 * call forms without loosening the quoted-specifier capture that follows.
 */
function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/\b(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g)].map((match) => match[1]);
}

describe("caring-contacts domain isolation", () => {
  it("imports nothing from outside its own directory", () => {
    // An ALLOWLIST, not a denylist, and the difference is the whole property. The claim being made
    // is that this domain is self-contained and provider-free -- and a denylist can only ever say
    // that the six things somebody thought of are absent. It named `@supabase` and `openai`, so
    // `twilio`, `redis` and `stripe` all passed, and a messaging provider is exactly what a
    // caring-contact domain would reach for first.
    //
    // Inverting it is free here rather than aspirational: there is currently not one non-relative
    // specifier anywhere under this tree, not even a `node:` builtin. `tests/caring-contacts-
    // message-policy.test.ts` already holds one file to this shape; this holds the whole tree to it.
    const offences: string[] = [];
    for (const file of walk(DOMAIN_ROOT)) {
      for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
        if (specifier.startsWith("node:")) continue;
        if (specifier.startsWith(".")) continue;
        offences.push(`${path.relative(process.cwd(), file)} -> ${specifier}`);
      }
    }
    expect(offences).toEqual([]);
  });

  it("sees a provider arriving through require or a dynamic import, not only a static one", () => {
    // The extractor, tested directly. Every specifier form below was invisible to the previous
    // whitespace-requiring pattern, so a sealed module could have loaded a provider lazily and
    // both assertions in this file would have reported green.
    const source = [
      'import Twilio from "twilio";',
      'const { createClient } = require("redis");',
      'await import("@supabase/supabase-js");',
      'export { send } from "./dispatch";',
      'import "node:crypto";',
    ].join("\n");

    expect(importSpecifiers(source)).toEqual(["twilio", "redis", "@supabase/supabase-js", "./dispatch", "node:crypto"]);
  });

  it("never escapes its directory with a relative import", () => {
    const offences: string[] = [];
    for (const file of walk(DOMAIN_ROOT)) {
      for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
        if (!specifier.startsWith(".")) continue;
        const resolved = path.resolve(path.dirname(file), specifier);
        // A bare `startsWith(DOMAIN_ROOT)` is a string-prefix test, not a path-containment test:
        // `.../src/lib/caring-contacts-server/config` satisfies it too, because that sibling
        // directory's name extends this one's as a prefix. Require the separator (or an exact
        // match on the root itself) so a relative import escaping into caring-contacts-server --
        // the reverse-direction dependency the plan forbids absolutely -- cannot pass silently.
        if (resolved !== DOMAIN_ROOT && !resolved.startsWith(DOMAIN_ROOT + path.sep)) {
          offences.push(`${path.relative(process.cwd(), file)} -> ${specifier}`);
        }
      }
    }
    expect(offences).toEqual([]);
  });

  // Standalone extract: this checks PsychSift's own supabase/migrations folder, which is not part of this copy.
  it.skip("keeps caring-contact migrations out of the PsychSift migration directory", () => {
    const clinicalKbMigrations = path.join(process.cwd(), "supabase", "migrations");
    const strays = readdirSync(clinicalKbMigrations).filter((name) => /caring[-_]?contact/i.test(name));
    expect(strays).toEqual([]);
  });
});

/**
 * Two properties that exist only as SOURCE TEXT, and so can be held only by reading it.
 *
 * They live here, in an offline source-scanning file the default `npm run test` collects, for a
 * reason found the hard way in review round 1. The first of them was originally written in
 * `caring-contacts-postgres-repository.test.ts`, which `vitest.config.mts` lists in
 * `caringContactsDbTestFiles` and excludes from the offline `node` project outright. CI does run the
 * database suite now, in its own `caring-contacts-db` job against a Postgres service container, but
 * a guard living there still fires only where a database is configured -- never in the default
 * offline run. So the guard was real, correct, and reachable in one place too few. Neither property
 * needs a database: both are a file read and a regular expression.
 *
 * Both carry a positive control. A scan whose pattern stops matching after a rename goes GREEN, not
 * red, so a scan without one is a check that cannot fail -- which is the same defect in a different
 * costume from the one the paragraph above describes.
 */
describe("caring-contacts properties that only a source scan can hold", () => {
  const postgresStore = () => readFileSync(path.join(DOMAIN_ROOT, "db", "postgres-repository.ts"), "utf8");

  const schedule = () => readFileSync(path.join(DOMAIN_ROOT, "schedule.ts"), "utf8");

  const rawFirstContactReasonMigration = () =>
    readFileSync(
      path.join(
        process.cwd(),
        "caring-contacts",
        "supabase",
        "migrations",
        "0005_caring_contacts_first_contact_reason.sql",
      ),
      "utf8",
    );

  /**
   * The migration with its `--` comments stripped.
   *
   * Same precedent, and the same reason, as the CREATE INDEX CONCURRENTLY scan in
   * `caring-contacts-migrations.test.ts`: these migrations discuss their own rules in prose, and a
   * scan that reads its own explanation as SQL reports the wrong thing. Here it matters twice over,
   * because the anchor below is required to be UNIQUE -- so without stripping, a comment that merely
   * MENTIONS `char_length(` would fail the test while changing no behaviour at all.
   */
  const firstContactReasonMigration = () =>
    readFileSync(
      path.join(
        process.cwd(),
        "caring-contacts",
        "supabase",
        "migrations",
        "0005_caring_contacts_first_contact_reason.sql",
      ),
      "utf8",
    ).replace(/--.*/g, "");

  it("never fetches the first-contact reason for a list read", () => {
    // `first_contact_reason` is free text a clinician wrote about one patient. It is deliberately
    // absent from `PLAN_COLUMNS` -- the list `readPlanRecord` and `selectPlanForUpdate` select -- so
    // rendering a caseload never pulls it into the process at all. (`listPlans` selects the narrower
    // `PLAN_LIST_COLUMNS`, guarded separately below.)
    //
    // Nothing observable through the repository can hold that. `toPlanRecord` maps field by field,
    // so adding the column to `PLAN_COLUMNS` fetches a clinical note for every plan in the team and
    // still releases nothing: the behaviour is identical and every behavioural test stays green.
    // The narrowing lives in the QUERY, which is why it takes a scan. Found by mutation, and the
    // invariant rather than the tally: the mutation changed no test's verdict anywhere in the
    // repository until this scan existed.
    const declaration = /const PLAN_COLUMNS = `([\s\S]*?)`;/.exec(postgresStore());

    // Positive control: the constant was found and really is the plan column list.
    expect(declaration).not.toBeNull();
    expect(declaration?.[1]).toContain("patient_name");

    expect(declaration?.[1]).not.toContain("first_contact_reason");
  });

  it("keeps the first-contact reason cap identical in the domain and in its SQL backstop", () => {
    // The domain owns the rule and refuses an over-long reason BY NAME
    // (`first-contact-reason-too-long`); the column's check constraint is a backstop for a write
    // that reached the table another way.
    //
    // The `isAwstCalendarDay` precedent is real but NOT symmetric with this one, and the asymmetry
    // is why this scan exists. That function is strictly stricter than the schema's calendar-day
    // pattern by construction, so drift there can only ever make the SQL redundant. Here the two are
    // the same rule written twice: RAISING the constant without raising the constraint turns a named
    // refusal into a raw constraint violation on a clinical write -- a regression, not a redundancy.
    const migration = firstContactReasonMigration();
    const constant = /FIRST_CONTACT_REASON_MAX_LENGTH = (\d+)/.exec(schedule());

    // ANCHORED ON `char_length(`, NOT ON THE CONSTRAINT NAME, and the difference is the whole
    // robustness of this scan (review round 2).
    //
    // The first version anchored on `plans_first_contact_reason_shape` and took the first `<=` after
    // it. But the FIRST occurrence of that name is the `where c.conname = ...` existence guard, not
    // the constraint body -- so any numeric `<=` inserted between the two would have been read as the
    // cap. That scan reads the right literal today and cannot stay right by construction: a later
    // edit adding, say, `and array_length(c.conkey, 1) <= 500` to the guard would have it compare a
    // number that is not the cap, and agree with the constant while the real cap had drifted. Proving
    // it reads correctly today (M16/M17) is a different claim from proving it will keep reading the
    // right thing.
    //
    // `char_length(` appears only in the constraint body, immediately left of the comparison, so it
    // anchors on the expression that IS the cap rather than on a name that is mentioned twice.
    const sql = /char_length\([\s\S]*?<=\s*(\d+)/.exec(migration);

    // Positive controls, three of them, because each covers a different way this scan could go green
    // while meaning nothing:
    //   * the constraint is still the one this test thinks it is (a rename fails loudly);
    //   * the anchor is UNIQUE -- a second `char_length(` anywhere in the file, including one added
    //     to the existence guard, would silently displace the match, so it must fail instead;
    //   * both literals were actually found, or the comparison is two undefineds being equal.
    expect(migration).toContain("plans_first_contact_reason_shape");
    expect(migration.split("char_length(").length - 1).toBe(1);

    // Control on the stripping itself: the raw file really does carry `--` comment text that the
    // scanned copy must not contain, so a `.replace` that silently stopped working would show up
    // here rather than as a scan quietly reading prose.
    expect(rawFirstContactReasonMigration()).toContain("-- At least one character that is not whitespace.");
    expect(migration).not.toContain("At least one character that is not whitespace.");
    expect(constant?.[1]).toBeDefined();
    expect(sql?.[1]).toBeDefined();

    expect(sql?.[1]).toBe(constant?.[1]);
  });

  it("keeps the attestation vocabulary identical in the domain and in its SQL check constraint", () => {
    // The domain owns the closed set (`PLAN_ASSURANCES`); the constraint is the backstop against a
    // write that reached the table another way. Nothing observable through the repository can hold
    // the two equal: a constraint listing a value the domain does not know refuses nothing the
    // domain would ever send, and one MISSING a value the domain knows refuses a plan the wizard
    // could really create -- and that failure appears only against a real database.
    const migration = readFileSync(
      path.join(process.cwd(), "caring-contacts", "supabase", "migrations", CARING_CONTACTS_ASSURANCE_MIGRATION),
      "utf8",
    ).replace(/--.*/g, "");

    const declaration = /assurance in \(([^)]*)\)/.exec(migration);

    // Positive control: the constraint was found and really is a value list.
    expect(declaration).not.toBeNull();
    const listed = [...(declaration?.[1] ?? "").matchAll(/'([^']+)'/g)].map((match) => match[1]).sort();

    expect(listed).toEqual([...PLAN_ASSURANCE_VALUES].sort());
  });

  it("never fetches the preferred name for a list read", () => {
    // The same property, and the same argument, as the first-contact reason above: `preferred_name`
    // is a patient's own name, so pulling it for the team's whole caseload on every list render
    // would put patient content into a read that deliberately carries none. `getEpisode` selects it
    // by name, and that is the only read that does.
    //
    // Nothing observable through the repository can hold this. Adding the column to `PLAN_COLUMNS`
    // fetches it for every plan in the team and still releases nothing, because `toPlanRecord` maps
    // field by field -- identical behaviour, every behavioural test still green. The narrowing lives
    // in the QUERY.
    const declaration = /const PLAN_COLUMNS = `([\s\S]*?)`;/.exec(postgresStore());

    // Positive control: the constant was found and really is the plan column list.
    expect(declaration).not.toBeNull();
    expect(declaration?.[1]).toContain("patient_name");

    expect(declaration?.[1]).not.toContain("preferred_name");
  });

  it("never fetches any patient column for a list read (#RZVMPD)", () => {
    // The same argument as the two scans above, applied to the columns those two took as GIVEN.
    // `first_contact_reason` and `preferred_name` were kept out of the list read because they are
    // patient content -- while the list read went on selecting the patient's name, mobile number
    // and identifier list for the whole caseload on every render, and `toPlanRecord` discarded all
    // three. The narrowing was in the mapping, which releases nothing but fetches everything; it
    // is now in the query.
    //
    // Nothing observable through the repository can hold this, for exactly the reason the other
    // two scans exist: widening `PLAN_LIST_COLUMNS` back out changes no behaviour and leaves every
    // behavioural test green. Only a scan of the query text can fail.
    const source = postgresStore();
    const listDeclaration = /const PLAN_LIST_COLUMNS = `([\s\S]*?)`;/.exec(source);

    // Positive control: the constant was found and really is a plan column list. `state` is chosen
    // deliberately -- it must survive any future narrowing, unlike the patient columns asserted
    // absent below, so this control cannot be satisfied by an empty or truncated match.
    expect(listDeclaration).not.toBeNull();
    expect(listDeclaration?.[1]).toContain("state");
    expect(listDeclaration?.[1]).toContain("discharge_at");

    for (const column of [
      "patient_name",
      "patient_mobile_number",
      "patient_identifiers",
      "first_contact_reason",
      "preferred_name",
    ]) {
      expect(listDeclaration?.[1]).not.toContain(column);
    }

    // And the list read really does use it. Without this the constant could be narrowed correctly
    // and never wired up, which is the failure mode that reads as a fix.
    expect(source).toMatch(/select \$\{PLAN_LIST_COLUMNS\} from caring_contacts\.plans order by id/);
    expect(source).not.toMatch(/select \$\{PLAN_COLUMNS\} from caring_contacts\.plans order by id/);
  });

  it("never derives the preferred name from the stored patient name", () => {
    // Owner decision, 2026-08-26, and the one a later "simplification" is most likely to undo: the
    // preferred name is ASKED FOR. A store that split `patient_name` would greet `Mr John Smith` as
    // "Mr" and a family-name-first entry by its surname, and it would pass every behavioural test,
    // because every fixture in this repository happens to have an ordinary given name first.
    const source = postgresStore();

    // Positive control: the store really does write and read this column, so the absence below is
    // the invariant rather than a column this file never mentions.
    expect(source).toContain("preferred_name");

    // The write takes the caller's value and nothing else. `split_part`, `regexp_split_to_array`
    // and `substring` are how this would be done in SQL; a JavaScript split of a patient name would
    // have to name `patient_name` on the left of it.
    expect(source).not.toMatch(/split_part\s*\(\s*patient_name/);
    expect(source).not.toMatch(/regexp_split_to_array\s*\(\s*patient_name/);
    expect(source).not.toMatch(/patient_name\s*\)?\s*\.split\(/);
    expect(source).not.toMatch(/patientName\s*\.split\(/);
  });

  it("keeps the preferred-name cap at least as strict in the domain as in its SQL backstop", () => {
    // The domain owns the rule and refuses an over-long name BY NAME (`preferred-name-too-long`)
    // before any message is built; the column's check constraint is a backstop for a write that
    // reached the table another way.
    //
    // THIS IS `<=`, NOT `=`, AND THE ASYMMETRY IS DELIBERATE -- it is the opposite of 0005's, where
    // the two express one rule in one unit and had to be pinned equal. Two differences here:
    //   * THE UNITS DIFFER. The domain caps the name's GSM-7 SEPTET cost, because that is what
    //     decides whether the message fits two segments; Postgres cannot count septets, so the
    //     constraint counts characters. Every character costs at least one septet, so a septet cap
    //     of N implies a character length of at most N -- the constraint can never refuse a name the
    //     domain accepted.
    //   * THE DOMAIN CAP IS DERIVED, from the GSM-7 constants and the PROVISIONAL message's own
    //     length, so the clinical approval gate rewording that message moves it. Pinning equality
    //     would make a wording review produce a schema migration.
    //
    // The dangerous direction is still caught: a domain cap ABOVE this number would turn a named
    // refusal into a raw constraint violation on a clinical write.
    const migration = readFileSync(
      path.join(process.cwd(), "caring-contacts", "supabase", "migrations", CARING_CONTACTS_PREFERRED_NAME_MIGRATION),
      "utf8",
    ).replace(/--.*/g, "");

    const sql = /char_length\([\s\S]*?<=\s*(\d+)/.exec(migration);

    // Positive controls, three of them, each covering a different way this could go green while
    // meaning nothing:
    //   * the constraint is still the one this test thinks it is (a rename fails loudly);
    //   * the anchor is UNIQUE, so a second `char_length(` anywhere in the file -- including one
    //     added to the existence guard -- must fail rather than silently displace the match;
    //   * the literal was actually found, or the comparison is against `NaN`.
    expect(migration).toContain("plans_preferred_name_shape");
    expect(migration.split("char_length(").length - 1).toBe(1);
    expect(sql?.[1]).toBeDefined();

    expect(PREFERRED_NAME_MAX_SEPTETS).toBeLessThanOrEqual(Number(sql?.[1]));
  });

  it("never amends or deletes an attestation from the Postgres store", () => {
    // Ruling [122]: a retention clearance must leave the attestation alone, and nothing anywhere
    // rewrites one. The shared contract suite proves the clearance behaviourally -- but only when a
    // database is available to run the Postgres half against, and this property is exactly the one
    // whose absence would be silent offline.
    //
    // The whole file is scanned rather than the clearance's body, because the invariant is wider
    // than the clearance: an attestation is written once, inside the transaction that creates its
    // plan, and read afterwards. There is no amend path and there is no delete path.
    const source = postgresStore();

    // Positive control: the store really does touch this table, so the absences below are the
    // invariant rather than a table this file never mentions.
    expect(source).toContain("insert into caring_contacts.plan_assurances");

    expect(source).not.toMatch(/delete from caring_contacts\.plan_assurances/);
    expect(source).not.toMatch(/update caring_contacts\.plan_assurances/);
  });
});
