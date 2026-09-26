// tests/caring-contacts-patients-directory.dom.test.tsx
//
// The Patients directory, tested through its server half: `PatientsDirectory` is handed the records
// the page already read, narrows them to `PatientsDirectoryRow`, filters by the non-identifying plan
// state, and hands the result to the client island that renders it.
//
// The assertions that matter are about honesty rather than layout:
//   * A PATIENT'S NAME MUST NEVER REACH A URL. Ruling [111]: "a query string is logged by every
//     proxy between here and the browser. Nothing about a patient may travel here." The caseload
//     search matches names, so it lives in the browser and not in `?q=`. That is the load-bearing
//     proof in this file and it is written first, below, with a positive control on both halves:
//     the searched name IS in the fixture and IS found, and the collector that reads the screen's
//     addresses IS reading something.
//   * an empty caseload and a caseload hidden by a filter are DIFFERENT facts, and the two
//     `ListEmptyState` kinds are not interchangeable (Task 1's whole reason for existing);
//   * a role that may not view plans at all must not be told the team has no patients;
//   * a directory releases the patient's NAME and no other identifying detail -- the name comes
//     from `listPatientNames`, whose type holds nothing else, and `getEpisode` (the only read that
//     releases a mobile number, an identifier list or a cultural identity) is never called here;
//   * a role that may not see names is TOLD so once, above the list, rather than left to wonder why
//     every row is headed by an identifier;
//   * moving the name search into the browser costs a reload, and the screen SAYS so rather than
//     letting a coordinator watch their list change for no reachable reason (spec 4.4).
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { patientsDirectoryHref } from "@/components/caring-contacts/workspace/patients-directory-client";
import { WORKSPACE_OVERLAY_PARAM } from "@/components/caring-contacts/workspace/overlays/workspace-overlays";
import { PatientsDirectory } from "@/components/caring-contacts/workspace/patients-directory";
import { demoActorForRole } from "@/lib/caring-contacts-server/session";
import { CARING_CONTACTS_ROUTES, patientRoute } from "@/lib/caring-contacts-routes";
import { contactId, pathwayVersionId, patientId, planId, referralId, teamId } from "@/lib/caring-contacts/ids";
import type { PlanState } from "@/lib/caring-contacts/model";
import { readPatientsDirectoryAddress } from "@/lib/caring-contacts/patients-directory-address";
import { parsePatientsDirectoryFilter } from "@/lib/caring-contacts/patients-directory-filter";
import type { PatientNameProjection, PlanRecord, StoredContact } from "@/lib/caring-contacts/repository";

const TEAM = teamId("demo-team");

function contact(sequence: number, options: { absorbed?: boolean; suppressed?: boolean } = {}): StoredContact {
  return {
    contact: {
      id: contactId(`contact-${sequence}`),
      planId: planId("plan-1"),
      // Both stores write an absorbed contact straight into the terminal `suppressed` state so it
      // can never be dispatched (in-memory-repository.ts, `createPlan`). The fixture matches the
      // stores rather than the schedule, because the screen counts what the store holds.
      state: options.absorbed || options.suppressed ? "suppressed" : "scheduled",
      version: 1,
    },
    planned: {
      sequence,
      cadenceLabel: sequence === 1 ? "Day 1" : `Month ${sequence}`,
      calendarDay: "2026-03-02",
      sendAt: new Date("2026-03-02T02:00:00.000Z"),
      messageType: sequence === 1 ? "first" : "standard",
      ...(options.absorbed ? { suppressed: { reason: "absorbedByFirstContact" as const } } : {}),
    },
  };
}

function planRecord(options: { id: string; state: PlanState; contacts?: readonly StoredContact[] }): PlanRecord {
  return {
    plan: { id: planId(options.id), teamId: TEAM, state: options.state, version: 1 },
    patientId: patientId(`patient-${options.id}`),
    referralId: referralId(`referral-${options.id}`),
    pathwayVersionId: pathwayVersionId("pathway-1"),
    dischargeAt: new Date("2026-03-01T02:00:00.000Z"),
    // Not under test here: this fixture asserts nothing about the unclaimed queue age, so the
    // plan's creation instant is set to the same instant as its discharge rather than invented.
    createdAt: new Date("2026-03-01T02:00:00.000Z"),
    completedAt: null,
    outcome: "inProgress",
    assuranceAttestations: [],
    contacts: options.contacts ?? [contact(1), contact(2)],
  };
}

const ALL = parsePatientsDirectoryFilter({});

/**
 * What `listPatientNames` releases when it releases nothing for these plans -- a de-identified
 * episode, or a role that may list plans without holding `viewPatientRecord`. Most tests below use
 * it because they are about something other than the name, and it keeps the row on its fallback:
 * headed by the synthetic identifier, exactly as Task 5 shipped it.
 */
const NO_NAMES: readonly PatientNameProjection[] = [];

/** The names read's answer for one plan. Two fields, which is all the type has. */
function name(planIdText: string, patientName: string): PatientNameProjection {
  return { planId: planId(planIdText), patientName };
}

/**
 * Every address on this screen that a browser could put into its history, or send to a server, or
 * leave in a proxy log: the `href` of every link, plus -- because a `<form method="get">` is exactly
 * how the defect got in -- the `action` of every form and the name and value of every field inside
 * one.
 *
 * The search input is deliberately NOT read here even though it holds the typed name. That is the
 * property under test: the name lives in a control that is part of no address at all.
 */
function addressesIn(container: HTMLElement): string[] {
  const addresses: string[] = [];
  for (const link of container.querySelectorAll("a[href]")) addresses.push(link.getAttribute("href") ?? "");
  for (const form of container.querySelectorAll("form")) {
    addresses.push(form.getAttribute("action") ?? "");
    for (const field of form.querySelectorAll("input, select, textarea")) {
      addresses.push(`${field.getAttribute("name") ?? ""}=${(field as HTMLInputElement).value}`);
    }
  }
  return addresses;
}

/**
 * The forms a name could be smuggled into an address as. A hash is in the list because a hash of a
 * name is still a name-derived identifier sitting in a log, and both cases of the raw text are in
 * it because a lower-cased needle is the shape the matcher itself uses.
 */
function urlFormsOf(text: string): string[] {
  return [
    text,
    text.toLowerCase(),
    encodeURIComponent(text),
    encodeURIComponent(text).toLowerCase(),
    text.replace(/ /g, "+"),
    ...text.split(" "),
    ...text.toLowerCase().split(" "),
  ];
}

describe("Patients directory - RULING [111]: a patient's name never reaches a URL", () => {
  const SEARCHED_NAME = "Jordan Nguyen";

  /**
   * THE load-bearing case in this file.
   *
   * Three things have to be true together, and each is asserted with something that could redden it:
   *   1. the name IS in the fixture and the search DOES find it by name -- otherwise the absence
   *      below is an absence over a screen that never held the name in the first place, which is
   *      decoration presented as proof;
   *   2. the collector IS reading addresses -- otherwise `not.toContain` over an empty list passes
   *      for a screen that puts the name in every href;
   *   3. no address contains the name in any form it could travel as.
   */
  it("finds the row by name, and puts no part of that name into any address on the screen", async () => {
    const user = userEvent.setup();
    const records = [planRecord({ id: "plan-1", state: "active" }), planRecord({ id: "plan-2", state: "active" })];
    const names = [name("plan-1", SEARCHED_NAME), name("plan-2", "Alex Whitlock")];

    const { container } = render(
      <PatientsDirectory mayViewPatientNames patientNames={names} records={records} filter={ALL} mayViewPlans />,
    );

    // (1a) The fixture really holds this name, before anything is typed.
    expect(screen.getByRole("heading", { name: SEARCHED_NAME })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);

    await user.type(screen.getByRole("searchbox"), SEARCHED_NAME);

    // (1b) ...and the search really matched on it: the other plan, whose identifiers are identical
    // in shape and differ only in their name, is gone.
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: SEARCHED_NAME })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Alex Whitlock" })).toBeNull();
    // The typed text is on screen, in a control -- so it exists to be leaked.
    expect(screen.getByRole("searchbox")).toHaveValue(SEARCHED_NAME);

    // (2) The collector is not answering from an empty list.
    const addresses = addressesIn(container);
    expect(addresses.length).toBeGreaterThan(0);
    expect(addresses).toContain(CARING_CONTACTS_ROUTES.patients);

    // (3) The property itself.
    for (const form of urlFormsOf(SEARCHED_NAME)) {
      for (const address of addresses) {
        expect(address, `an address on this screen carries "${form}"`).not.toContain(form);
      }
    }

    // And there is no GET form left that could put it there on submit -- the mechanism the fix
    // removed, asserted as removed rather than assumed gone.
    expect(container.querySelector("form")).toBeNull();
    // Nothing navigated: the search changed no address at all. `addressesIn` reads the DOM, so a
    // script-driven write to the address would slip past it entirely -- these two read the address
    // itself. The hash is here because nothing in this island writes one TODAY and a hash would
    // evade both the DOM sweep and the search-string check; the assertion is the cheap guard, and
    // no machinery was added to look for hash writes.
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
  });

  it("keeps the name out of the parsed filter, while the plan state is read from the same URL", () => {
    // A `?q=` on an old bookmark must be ignored rather than honoured. The state in the SAME object
    // is the positive control: this proves the parser read the URL and dropped the name, not that it
    // read nothing.
    const parsed = parsePatientsDirectoryFilter({ state: "active", q: SEARCHED_NAME, name: SEARCHED_NAME });

    expect(parsed.state).toBe("active");
    for (const form of urlFormsOf(SEARCHED_NAME)) {
      expect(JSON.stringify(parsed)).not.toContain(form);
    }
  });

  it("builds every filter href from the plan state alone, and the state survives the round trip", () => {
    expect(patientsDirectoryHref({ state: "all" })).toBe(CARING_CONTACTS_ROUTES.patients);

    const href = patientsDirectoryHref({ state: "paused" });
    expect(href).toBe(`${CARING_CONTACTS_ROUTES.patients}?state=paused`);
    // The whole point of leaving state in the address: it comes back out of it.
    const params = Object.fromEntries(new URL(href, "https://example.invalid").searchParams);
    expect(parsePatientsDirectoryFilter(params).state).toBe("paused");
  });

  it("says, beside the control, that the search is not in the address and a reload clears it", () => {
    // Spec 4.4 applied to the cost of this fix. A reload keeps the plan-state filter and drops the
    // typed name; a coordinator who did not know that would watch their list change for no reachable
    // reason. Read from the element the input POINTS AT, not from anywhere the words happen to be:
    // a note the screen reader never reaches is not a note.
    const { container } = render(
      <PatientsDirectory mayViewPatientNames patientNames={[]} records={[]} filter={ALL} mayViewPlans />,
    );

    const describedBy = screen.getByRole("searchbox").getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    const note = container.querySelector(`#${describedBy}`);
    expect(note).not.toBeNull();
    const text = note?.textContent ?? "";
    expect(text).toMatch(/reloading/i);
    expect(text).toMatch(/clears/i);
    expect(text).toMatch(/keeps the plan-state filter/i);
    expect(text).toMatch(/never is|never put into/i);
  });
});

describe("Patients directory - the two empty states are not interchangeable", () => {
  it("an empty caseload renders the no-data kind, which states how a first patient arrives", () => {
    const { container } = render(
      <PatientsDirectory mayViewPatientNames patientNames={NO_NAMES} records={[]} filter={ALL} mayViewPlans />,
    );

    const empty = screen.getByRole("group", { name: /no patients yet/i });
    expect(empty).toBeInTheDocument();
    // The "filtered" wording shape must never appear on a genuinely empty caseload: it would
    // tell a clinician that patients exist and something is hiding them.
    expect(container.textContent ?? "").not.toContain("What changes it:");
    expect(empty.textContent ?? "").toMatch(/referral/i);
  });

  it("a caseload hidden by the state filter renders the filtered kind, naming the filter and the remedy", () => {
    const records = [planRecord({ id: "plan-1", state: "active" }), planRecord({ id: "plan-2", state: "active" })];
    const filter = parsePatientsDirectoryFilter({ state: "paused" });

    const { container } = render(
      <PatientsDirectory mayViewPatientNames patientNames={NO_NAMES} records={records} filter={filter} mayViewPlans />,
    );

    const empty = screen.getByRole("group", { name: /no patients match/i });
    expect(empty).toBeInTheDocument();
    expect(within(empty).getByText(/Why:/)).toBeInTheDocument();
    expect(within(empty).getByText(/What changes it:/)).toBeInTheDocument();
    // The reason must name the filter that is actually set, and the count it is hiding.
    expect(empty.textContent ?? "").toContain("Paused");
    expect(empty.textContent ?? "").toContain("2");
    // Never the no-data claim.
    expect(container.textContent ?? "").not.toContain("No patients yet");
    // The remedy is reachable, not merely described...
    const remedy = screen.getByRole("link", { name: /show every plan/i });
    expect(remedy).toHaveAttribute("href", CARING_CONTACTS_ROUTES.patients);
    // ...and reaches it as a `<Link>`, not a raw anchor. The row test below makes this assertion
    // for the filter chips; without it here, the empty state's own action was the one link on this
    // screen that nothing checked -- measured, not assumed: removing the attribute from this link
    // alone left the whole file green.
    expect(remedy).toHaveAttribute("data-internal-link", "true");
  });

  it("a caseload hidden by the identifier search names the search text as the reason", async () => {
    const user = userEvent.setup();
    const records = [planRecord({ id: "plan-1", state: "active" })];

    render(
      <PatientsDirectory mayViewPatientNames patientNames={NO_NAMES} records={records} filter={ALL} mayViewPlans />,
    );
    // Positive control: the row is present before the search hides it, so the empty state below is
    // the search's doing rather than an empty fixture.
    expect(screen.getAllByRole("listitem")).toHaveLength(1);

    await user.type(screen.getByRole("searchbox"), "nothing-matches-this");

    const empty = screen.getByRole("group", { name: /no patients match/i });
    expect(empty.textContent ?? "").toContain("nothing-matches-this");
  });

  it("a role that may not view plans is never told the team has no patients", () => {
    const { container } = render(
      <PatientsDirectory mayViewPatientNames patientNames={NO_NAMES} records={[]} filter={ALL} mayViewPlans={false} />,
    );

    expect(container.textContent ?? "").not.toContain("No patients yet");
    const empty = screen.getByRole("group", { name: /not visible in this role/i });
    expect(within(empty).getByText(/Why:/)).toBeInTheDocument();
    expect(within(empty).getByText(/What changes it:/)).toBeInTheDocument();
    // The reason must not claim anything about how many plans exist: a read this role may not make
    // and a team holding none are indistinguishable by design, and saying otherwise would leak the
    // very thing the store withholds.
    expect(empty.textContent ?? "").toMatch(/says nothing about how many/i);
  });

  // Ruling 93. Asserting that "What changes it:" is PRESENT is a shape check, and a shape check
  // certifies a well-formed lie: the first version of this screen said "The role switcher changes
  // which role you are acting in", and no role switcher exists anywhere in this workspace's
  // interface. Spec 4.4 requires a remedy that can be REACHED, so the content is pinned here.
  it("states a remedy that exists, and never names a control the workspace does not have", () => {
    render(
      <PatientsDirectory mayViewPatientNames patientNames={NO_NAMES} records={[]} filter={ALL} mayViewPlans={false} />,
    );
    const empty = screen.getByRole("group", { name: /not visible in this role/i });
    const text = empty.textContent ?? "";

    expect(text).toMatch(/nothing on this screen changes it/i);
    expect(text).toMatch(/no control for it anywhere in this workspace/i);
    // The exact false claim this test was written to keep out.
    expect(text).not.toMatch(/role switcher/i);
  });

  it("uses the not-permitted kind, so the icon does not report a search nobody ran", () => {
    // Ruling 92: the words were honest under `"filtered"`, the TYPE and the ICON were not.
    // `"filtered"` selects `SearchX`; this case must not.
    const restricted = render(
      <PatientsDirectory mayViewPatientNames patientNames={NO_NAMES} records={[]} filter={ALL} mayViewPlans={false} />,
    );
    const restrictedIcon = restricted.container.querySelector("[role='group'] svg")?.getAttribute("class") ?? "";
    restricted.unmount();

    const filtered = render(
      <PatientsDirectory
        mayViewPatientNames
        patientNames={NO_NAMES}
        records={[planRecord({ id: "plan-1", state: "active" })]}
        filter={parsePatientsDirectoryFilter({ state: "paused" })}
        mayViewPlans
      />,
    );
    const filteredIcon = filtered.container.querySelector("[role='group'] svg")?.getAttribute("class") ?? "";

    expect(restrictedIcon).not.toBe("");
    expect(filteredIcon).not.toBe("");
    expect(restrictedIcon, "the role-restricted empty state reuses the search icon").not.toBe(filteredIcon);
  });

  it("hides the filter controls entirely for a role that may not view plans", () => {
    render(
      <PatientsDirectory mayViewPatientNames patientNames={NO_NAMES} records={[]} filter={ALL} mayViewPlans={false} />,
    );
    expect(screen.queryByRole("link", { name: "Active" })).toBeNull();
    expect(screen.queryByRole("searchbox")).toBeNull();
  });
});

describe("Patients directory - rows", () => {
  it("lists one row per plan the team may see, keyed by the synthetic patient identifier", () => {
    const records = [
      planRecord({ id: "plan-1", state: "active" }),
      planRecord({ id: "plan-2", state: "paused" }),
      planRecord({ id: "plan-3", state: "completed" }),
    ];

    render(
      <PatientsDirectory mayViewPatientNames patientNames={NO_NAMES} records={records} filter={ALL} mayViewPlans />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("heading", { name: "patient-plan-1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "patient-plan-2" })).toBeInTheDocument();
  });

  it("states each plan's state in words, not by colour alone", () => {
    render(
      <PatientsDirectory
        mayViewPatientNames
        patientNames={NO_NAMES}
        records={[planRecord({ id: "plan-1", state: "paused" })]}
        filter={ALL}
        mayViewPlans
      />,
    );
    const row = screen.getAllByRole("listitem")[0];
    expect(row.textContent ?? "").toContain("Paused");
  });

  it("explains a contact the SYSTEM suppressed, in place, with why and what would change it", () => {
    const withAbsorbed = planRecord({
      id: "plan-1",
      state: "active",
      contacts: [contact(1), contact(2, { absorbed: true })],
    });

    render(
      <PatientsDirectory
        mayViewPatientNames
        patientNames={NO_NAMES}
        records={[withAbsorbed]}
        filter={ALL}
        mayViewPlans
      />,
    );

    const automated = screen.getByRole("group", { name: "Suppressed" });
    expect(within(automated).getByText(/Why:/)).toBeInTheDocument();
    expect(within(automated).getByText(/What changes it:/)).toBeInTheDocument();
    // Reachable as text, never only as a hover title.
    expect(automated.querySelector("[title]")).toBeNull();
  });

  it("explains a contact suppressed by the transition, which carries no schedule marker", () => {
    // M-8: `planned.suppressed` marks only the schedule's own absorption. A contact moved to
    // `suppressed` by `applyContactTransition` has no such marker, and counting the plan rather
    // than the outcome left it with no explanation at all.
    const record = planRecord({
      id: "plan-1",
      state: "active",
      contacts: [contact(1), contact(2, { suppressed: true })],
    });

    render(
      <PatientsDirectory mayViewPatientNames patientNames={NO_NAMES} records={[record]} filter={ALL} mayViewPlans />,
    );

    const automated = screen.getByRole("group", { name: "Suppressed" });
    expect(within(automated).getByText(/Why:/)).toBeInTheDocument();
    expect(within(automated).getByText(/What changes it:/)).toBeInTheDocument();
    // Not the Week 1 wording -- that reason is false for this contact.
    expect(automated.textContent ?? "").not.toMatch(/Week 1/);
    // And the remedy is honest about being final rather than inventing one.
    expect(automated.textContent ?? "").toMatch(/final/i);
  });

  // N-3. `scheduled` changed definition this round -- it counts `contacts.length` minus the
  // contacts whose OWN state is suppressed, where it used to subtract only the schedule's absorbed
  // ones. Nothing asserted the rendered number, so the change could have been silently wrong on
  // every row. This is a clinician-facing count of how many messages a patient will receive.
  it("states how many messages remain in the schedule, and subtracts every suppressed one", () => {
    const plain = planRecord({ id: "plan-1", state: "active", contacts: [contact(1), contact(2)] });
    const withSuppressed = planRecord({
      id: "plan-2",
      state: "active",
      contacts: [contact(1), contact(2, { suppressed: true }), contact(3, { absorbed: true })],
    });

    render(
      <PatientsDirectory
        mayViewPatientNames
        patientNames={NO_NAMES}
        records={[plain, withSuppressed]}
        filter={ALL}
        mayViewPlans
      />,
    );

    const [first, second] = screen.getAllByRole("listitem");
    expect(first.textContent ?? "").toContain("2 messages in the schedule");
    // Three contacts, two of them suppressed by two different causes, so one message remains.
    expect(second.textContent ?? "").toContain("1 message in the schedule");
  });

  // N-2. The count subtracts EVERY suppressed contact, so the reason beside it has to account for
  // every one of them. The first shape branched on whether an absorbed contact existed at all, so
  // this plan showed a count short by two beside a reason explaining one.
  it("accounts for both causes when a plan carries an absorbed AND a transition-suppressed contact", () => {
    const record = planRecord({
      id: "plan-1",
      state: "active",
      contacts: [contact(1), contact(2, { absorbed: true }), contact(3, { suppressed: true })],
    });

    render(
      <PatientsDirectory mayViewPatientNames patientNames={NO_NAMES} records={[record]} filter={ALL} mayViewPlans />,
    );

    const automated = screen.getByRole("group", { name: "Suppressed" });
    const text = automated.textContent ?? "";
    // The absorbed cause, with its own remedy...
    expect(text).toMatch(/Week 1/);
    expect(text).toMatch(/first-contact date/i);
    // ...and the other one, with its own, which is a different remedy entirely.
    expect(text).toMatch(/does not hold what caused that/i);
    expect(text).toMatch(/final/i);
  });

  it("says nothing about suppression when the system suppressed nothing", () => {
    render(
      <PatientsDirectory
        mayViewPatientNames
        patientNames={NO_NAMES}
        records={[planRecord({ id: "plan-1", state: "active" })]}
        filter={ALL}
        mayViewPlans
      />,
    );
    expect(screen.queryByRole("group", { name: "Suppressed" })).toBeNull();
  });

  // Ruling 99, Task 6. This control was an `UnavailableDestination` while
  // `/caring-contacts/patients/[patientId]` did not exist -- Ruling 52: an unbuilt destination is
  // an unavailable control with a stated reason, never a link into a route that would 404. That
  // screen now exists, so the assertion inverts with it: the control must be a real `<Link>` at
  // the patient route, and it must still be NAMED by the identifier, which is the only thing
  // distinguishing one row's control from the next to a screen reader.
  it("offers the row's detail control as a Link to the patient overview, named by the identifier", () => {
    render(
      <PatientsDirectory
        mayViewPatientNames
        patientNames={NO_NAMES}
        records={[planRecord({ id: "plan-1", state: "active" })]}
        filter={ALL}
        mayViewPlans
      />,
    );

    const control = screen.getByRole("link", { name: /patient-plan-1/i });
    expect(control).toHaveAttribute("href", "/caring-contacts/patients/patient-plan-1");
    // The route module builds it -- never a path literal assembled in the component.
    expect(control).toHaveAttribute("href", patientRoute("patient-plan-1"));
    // M6, review round 1: the patient half of this negative assertion had to change -- the row
    // links there now -- but it did not have to be DROPPED. Every link into the patient family is
    // pinned to exactly the route module's answer for this record, so a wrong patient id, a
    // hand-built path, or a stray extra link into the family all still fail.
    for (const link of screen.getAllByRole("link")) {
      const href = link.getAttribute("href") ?? "";
      if (href.startsWith("/caring-contacts/patients/")) {
        expect(href, "a link into the patient family that is not this record's").toBe(patientRoute("patient-plan-1"));
      }
      // Nothing here reaches the PLAN detail route, whose page Task 7 builds...
      expect(href).not.toMatch(/\/caring-contacts\/plans\//);
      // ...nor reaches an internal route by a raw anchor. `data-internal-link` is the marker the
      // shell test uses to tell a `<Link>` from an `<a href="/…">`, which render identically.
      expect(link.getAttribute("data-internal-link"), `${link.getAttribute("href")} is not a <Link>`).toBe("true");
    }
  });

  it("releases the name and nothing else - a directory never calls getEpisode", () => {
    const records = [planRecord({ id: "plan-1", state: "active" })];
    const { container } = render(
      <PatientsDirectory
        mayViewPatientNames
        patientNames={[name("plan-1", "Jordan Nguyen")]}
        records={records}
        filter={ALL}
        mayViewPlans
      />,
    );

    // The name is rendered WITH the names read in place, so the absences below are the screen
    // holding nothing else rather than the screen holding nothing at all.
    expect(screen.getByRole("heading", { name: "Jordan Nguyen" })).toBeInTheDocument();
    // `PlanRecord` carries no identifying detail by construction and `PatientNameProjection` has
    // two fields, so the other three fields `getEpisode` releases have nowhere to come from. This
    // pins that the screen does not invent a place to put one either.
    // "patient name" is back in the alternation (review M-6). The screen renders the name itself
    // but never that literal phrase as a label, so dropping it bought nothing and lost a guard
    // against a future row growing a "Patient name:" field label beside a widened read.
    expect(container.textContent ?? "").not.toMatch(/mobile|patient name|cultural/i);
  });
});

describe("Patients directory - the plan state is a URL, and only the plan state", () => {
  it("parses a known plan state and ignores an unknown one rather than failing the render", () => {
    expect(parsePatientsDirectoryFilter({ state: "paused" }).state).toBe("paused");
    expect(parsePatientsDirectoryFilter({ state: "not-a-state" }).state).toBe("all");
    expect(parsePatientsDirectoryFilter({ state: ["active", "paused"] }).state).toBe("all");
  });

  it("filters by plan state on the server, before any row crosses the boundary", () => {
    const records = [planRecord({ id: "plan-1", state: "active" }), planRecord({ id: "plan-2", state: "paused" })];

    render(
      <PatientsDirectory
        mayViewPatientNames
        patientNames={NO_NAMES}
        records={records}
        filter={parsePatientsDirectoryFilter({ state: "paused" })}
        mayViewPlans
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "patient-plan-2" })).toBeInTheDocument();
  });

  it("matches the identifier search case-insensitively against the patient and plan identifiers", async () => {
    // The IDENTIFIER half of the same one control. A synthetic id is not a name, so it would have
    // been safe to leave on the server -- but one box searches both, and splitting them would have
    // given a coordinator a second box to type a name into. Both halves match in the browser.
    const user = userEvent.setup();
    const records = [planRecord({ id: "plan-1", state: "active" }), planRecord({ id: "plan-2", state: "active" })];
    render(
      <PatientsDirectory mayViewPatientNames patientNames={NO_NAMES} records={records} filter={ALL} mayViewPlans />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);

    await user.type(screen.getByRole("searchbox"), "PLAN-2");

    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "patient-plan-2" })).toBeInTheDocument();
  });

  it("keeps the state filter in the address while the search runs in the browser", async () => {
    // The two filters compose, and only one of them is addressable. The state came from the URL and
    // the text did not, and the list respects both at once.
    const user = userEvent.setup();
    const records = [
      planRecord({ id: "plan-1", state: "active" }),
      planRecord({ id: "plan-2", state: "active" }),
      planRecord({ id: "plan-3", state: "paused" }),
    ];
    const { container } = render(
      <PatientsDirectory
        mayViewPatientNames
        patientNames={NO_NAMES}
        records={records}
        filter={parsePatientsDirectoryFilter({ state: "active" })}
        mayViewPlans
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);

    await user.type(screen.getByRole("searchbox"), "plan-2");

    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "patient-plan-2" })).toBeInTheDocument();
    // No form to submit: the search is not a navigation.
    expect(container.querySelector("form")).toBeNull();
  });

  it("marks the current state filter, so the screen and the URL cannot disagree", () => {
    render(
      <PatientsDirectory
        mayViewPatientNames
        patientNames={NO_NAMES}
        records={[]}
        filter={parsePatientsDirectoryFilter({ state: "paused" })}
        mayViewPlans
      />,
    );
    expect(screen.getByRole("link", { name: "Paused" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: "Active" })).not.toHaveAttribute("aria-current");
  });
});

describe("Patients directory - the names-only projection (Ruling 91)", () => {
  it("heads the row with the patient's name, and keeps the synthetic identifier beside it", () => {
    const records = [planRecord({ id: "plan-1", state: "active" })];

    render(
      <PatientsDirectory
        mayViewPatientNames
        patientNames={[name("plan-1", "Jordan Nguyen")]}
        records={records}
        filter={ALL}
        mayViewPlans
      />,
    );

    expect(screen.getByRole("heading", { name: "Jordan Nguyen" })).toBeInTheDocument();
    // Still present in the row's own body, because two patients can share a name.
    //
    // M7 in the mutation ledger: this assertion was first written as "the row's text contains the
    // identifier", which the DETAIL CONTROL satisfies on its own -- so deleting the identifier line
    // entirely left the file green. It reads the line itself now.
    const row = screen.getAllByRole("listitem")[0];
    expect(within(row).getByText(/Synthetic identifier: patient-plan-1/)).toBeInTheDocument();
    // And the control is still named by the identifier, which is what distinguishes one row's
    // control from the next to a screen reader.
    expect(screen.getByRole("link", { name: /patient-plan-1/i })).toBeInTheDocument();
  });

  it("falls back to the synthetic identifier, and labels it as one, when no name came back", () => {
    // The case a role without `viewPatientRecord` produces: `listPatientNames` answers `[]`, exactly
    // as `listPlans` answers an actor who may not read it, and the screen must not present an
    // identifier as though it were a name.
    render(
      <PatientsDirectory
        mayViewPatientNames
        patientNames={NO_NAMES}
        records={[planRecord({ id: "plan-1", state: "active" })]}
        filter={ALL}
        mayViewPlans
      />,
    );

    expect(screen.getByRole("heading", { name: "patient-plan-1" })).toBeInTheDocument();
    expect(screen.getByText("Synthetic patient identifier")).toBeInTheDocument();
  });

  it("treats a de-identified plan's empty name as no name held, never as a blank heading", () => {
    // `markRetentionCleared` writes the empty string for a removed name in both stores, so the
    // projection carries an entry whose name is "". Rendering it verbatim would give the row an
    // empty heading and no identifier at all -- a row naming nobody.
    render(
      <PatientsDirectory
        mayViewPatientNames
        patientNames={[name("plan-1", "")]}
        records={[planRecord({ id: "plan-1", state: "active" })]}
        filter={ALL}
        mayViewPlans
      />,
    );

    expect(screen.getByRole("heading", { name: "patient-plan-1" })).toBeInTheDocument();
    expect(screen.getByText("Synthetic patient identifier")).toBeInTheDocument();
  });

  it("matches the search against the name case-insensitively, on a part of it", async () => {
    const user = userEvent.setup();
    const records = [planRecord({ id: "plan-1", state: "active" }), planRecord({ id: "plan-2", state: "active" })];
    const names = [name("plan-1", "Jordan Nguyen"), name("plan-2", "Alex Whitlock")];

    render(<PatientsDirectory mayViewPatientNames patientNames={names} records={records} filter={ALL} mayViewPlans />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);

    await user.type(screen.getByRole("searchbox"), "nguyen");

    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Jordan Nguyen" })).toBeInTheDocument();
  });

  it("finds no row by a name it does not hold, when the names read released nothing", async () => {
    // The empty haystack segment must not turn into a wildcard: a role that may not read names
    // searching for one must find nothing, not everything.
    const user = userEvent.setup();
    render(
      <PatientsDirectory
        mayViewPatientNames
        patientNames={NO_NAMES}
        records={[planRecord({ id: "plan-1", state: "active" })]}
        filter={ALL}
        mayViewPlans
      />,
    );
    // Positive control: the row IS here until the name search hides it.
    expect(screen.getAllByRole("listitem")).toHaveLength(1);

    await user.type(screen.getByRole("searchbox"), "Jordan");

    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByRole("group", { name: /no patients match/i })).toBeInTheDocument();
  });

  it("clears the typed name from the control when the search is cleared", async () => {
    // The remedy the empty state promises has to be reachable, and the typed text has to actually
    // leave the control rather than merely stop filtering.
    const user = userEvent.setup();
    const records = [planRecord({ id: "plan-1", state: "active" }), planRecord({ id: "plan-2", state: "active" })];
    render(
      <PatientsDirectory
        mayViewPatientNames
        patientNames={[name("plan-1", "Jordan Nguyen")]}
        records={records}
        filter={ALL}
        mayViewPlans
      />,
    );

    await user.type(screen.getByRole("searchbox"), "Jordan Nguyen");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: /clear search/i }));

    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    // And the control is gone again once there is nothing to clear.
    expect(screen.queryByRole("button", { name: /clear search/i })).toBeNull();
  });
});

describe("Patients directory - a role that may not see names is told once, not per row", () => {
  const records = [planRecord({ id: "plan-1", state: "active" }), planRecord({ id: "plan-2", state: "active" })];

  it("states the role restriction once above the list, with a reason and a remedy", () => {
    render(
      <PatientsDirectory
        mayViewPatientNames={false}
        patientNames={NO_NAMES}
        records={records}
        filter={ALL}
        mayViewPlans
      />,
    );

    const notice = screen.getByRole("note", { name: /names are not shown in this role/i });
    expect(within(notice).getByText(/Why:/)).toBeInTheDocument();
    expect(within(notice).getByText(/What changes it:/)).toBeInTheDocument();
    // ONCE, not per row: two rows, one notice.
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByRole("note")).toHaveLength(1);
    // Reachable as text, never only as a hover title -- spec 4.4.
    expect(notice.querySelector("[title]")).toBeNull();
    // And it must not claim anything about whether names are held, which it cannot know.
    expect(notice.textContent ?? "").toMatch(/says nothing about\s+whether a name is held/i);
  });

  it("never prints the notice for a role that may see names, so a nameless row means de-identified", () => {
    // This is the whole point of stating the actor-level fact: with no notice on the page, the only
    // remaining cause of a nameless row is a retention clearance. A notice printed here would make
    // that inference false.
    render(
      <PatientsDirectory mayViewPatientNames patientNames={NO_NAMES} records={records} filter={ALL} mayViewPlans />,
    );

    expect(screen.queryByRole("note")).toBeNull();
  });

  it("offers a name search only when names are released, so the control cannot promise what it cannot find", () => {
    const withNames = render(
      <PatientsDirectory mayViewPatientNames patientNames={NO_NAMES} records={records} filter={ALL} mayViewPlans />,
    );
    expect(
      screen.getByLabelText(/Search by name, or by synthetic patient, plan or referral identifier/i),
    ).toBeInTheDocument();
    expect(withNames.container.querySelector("input[type='search']")).toHaveAttribute(
      "placeholder",
      "Name or synthetic ID",
    );
    withNames.unmount();

    const withoutNames = render(
      <PatientsDirectory
        mayViewPatientNames={false}
        patientNames={NO_NAMES}
        records={records}
        filter={ALL}
        mayViewPlans
      />,
    );
    expect(screen.getByLabelText(/^Search by synthetic patient, plan or referral identifier$/i)).toBeInTheDocument();
    expect(withoutNames.container.querySelector("input[type='search']")).toHaveAttribute(
      "placeholder",
      "Synthetic identifier",
    );
  });

  // Review M-5: the row's eyebrow label had only its dangerous direction pinned. Collapsing it to
  // always-"Synthetic patient identifier" left the suite green even with a name rendered above it --
  // a row that reads "Synthetic patient identifier / Jordan Nguyen" is a mislabelled name, which is
  // the same class of defect as an unlabelled one. Both branches are read here.
  it("labels the heading for what it is, in both directions", () => {
    const named = render(
      <PatientsDirectory
        mayViewPatientNames
        patientNames={[name("plan-1", "Jordan Nguyen")]}
        records={[planRecord({ id: "plan-1", state: "active" })]}
        filter={ALL}
        mayViewPlans
      />,
    );
    const namedRow = screen.getAllByRole("listitem")[0];
    expect(within(namedRow).getByText("Patient")).toBeInTheDocument();
    expect(within(namedRow).queryByText("Synthetic patient identifier")).toBeNull();
    named.unmount();

    render(
      <PatientsDirectory
        mayViewPatientNames
        patientNames={NO_NAMES}
        records={[planRecord({ id: "plan-1", state: "active" })]}
        filter={ALL}
        mayViewPlans
      />,
    );
    const fallbackRow = screen.getAllByRole("listitem")[0];
    expect(within(fallbackRow).getByText("Synthetic patient identifier")).toBeInTheDocument();
    expect(within(fallbackRow).queryByText("Patient")).toBeNull();
  });
});

describe("Patients directory - a bookmarked search term is stripped from the address, not just unread", () => {
  const NAME = "Jordan Nguyen";
  // No filterToken appears in any address these tests build, so the actor never gates a resolved
  // query here -- it exists only to satisfy `readPatientsDirectoryAddress`'s required parameter.
  const ACTOR = demoActorForRole("coordinator");

  it("reports an unrecognised parameter as a BOOLEAN, and rebuilds a query that cannot carry it", () => {
    const address = readPatientsDirectoryAddress({ state: "active", q: NAME }, ACTOR);

    expect(address.droppedUnrecognisedParams).toBe(true);
    expect(address.searchNotApplied).toBe(true);
    // Positive control: the recognised parameter survived into both the filter and the query.
    expect(address.filter.state).toBe("active");
    expect(address.canonicalQuery).toContain("state=active");
    expect(address.canonicalQuery).toContain("searchNotApplied=1");
    // The whole returned value, not only the query -- nothing anywhere in it names the term.
    for (const form of urlFormsOf(NAME)) {
      expect(JSON.stringify(address), `the address value carries "${form}"`).not.toContain(form);
    }
  });

  it("triggers on any unrecognised name, because a bookmark need not say `q`", () => {
    for (const key of ["q", "name", "search", "patient", "filter"]) {
      expect(readPatientsDirectoryAddress({ [key]: NAME }, ACTOR).droppedUnrecognisedParams, key).toBe(true);
    }
    // ...and not on the ones this route does understand, or the rewrite would fire forever.
    expect(readPatientsDirectoryAddress({}, ACTOR).droppedUnrecognisedParams).toBe(false);
    expect(readPatientsDirectoryAddress({ state: "active" }, ACTOR).droppedUnrecognisedParams).toBe(false);
    expect(readPatientsDirectoryAddress({ searchNotApplied: "1" }, ACTOR).droppedUnrecognisedParams).toBe(false);
    expect(readPatientsDirectoryAddress({ overlay: "consent-and-withdrawal" }, ACTOR).droppedUnrecognisedParams).toBe(
      false,
    );
  });

  it("produces a rewrite target that is itself clean, so the redirect cannot loop", () => {
    const address = readPatientsDirectoryAddress(
      { state: "paused", overlay: "consent-and-withdrawal", q: NAME },
      ACTOR,
    );
    const rewritten = Object.fromEntries(new URLSearchParams(address.canonicalQuery));

    // Feed the target back through the same reader: it must ask for no further rewrite.
    expect(readPatientsDirectoryAddress(rewritten, ACTOR).droppedUnrecognisedParams).toBe(false);
    // ...while still carrying everything that was allowed to survive.
    expect(rewritten.state).toBe("paused");
    expect(rewritten.overlay).toBe("consent-and-withdrawal");
    expect(rewritten.searchNotApplied).toBe("1");
  });

  it("recognises the overlay parameter the overlay host actually writes", () => {
    // This REPLACES an equality pin between `PATIENTS_DIRECTORY_OVERLAY_PARAM` and
    // `WORKSPACE_OVERLAY_PARAM`. That pin guarded a duplicated bare string; the shell-wide fix made
    // both aliases of one declaration in `workspace-address.ts`, so the assertion became one that
    // cannot fail, and an assertion that cannot fail is worse than none. What can still go wrong is
    // this route dropping the parameter the writer uses, which is what is asserted instead: a
    // deep-linked overlay must survive the caseload's own address rewrite.
    const address = readPatientsDirectoryAddress(
      { [WORKSPACE_OVERLAY_PARAM]: "consent-and-withdrawal", q: "x" },
      ACTOR,
    );
    expect(address.droppedUnrecognisedParams).toBe(true);
    expect(new URLSearchParams(address.canonicalQuery).get(WORKSPACE_OVERLAY_PARAM)).toBe("consent-and-withdrawal");
  });

  it("states that a saved search was not applied, and never echoes what it was", () => {
    const { container } = render(
      <PatientsDirectory
        mayViewPatientNames
        patientNames={[name("plan-1", NAME)]}
        records={[planRecord({ id: "plan-1", state: "active" })]}
        filter={ALL}
        mayViewPlans
        savedSearchNotApplied
      />,
    );

    const notice = screen.getByRole("note", { name: /a saved search was not applied/i });
    expect(within(notice).getByText(/Why:/)).toBeInTheDocument();
    expect(within(notice).getByText(/What changes it:/)).toBeInTheDocument();
    // Reachable as text, never only as a hover title -- spec 4.4.
    expect(notice.querySelector("[title]")).toBeNull();
    // The remedy names a control that exists on this screen.
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    // It never echoes the dropped term. The name IS on this screen -- the row is headed by it, so
    // this is not an absence over a fixture that never held it -- but the NOTICE must not repeat it.
    expect(screen.getByRole("heading", { name: NAME })).toBeInTheDocument();
    for (const form of urlFormsOf(NAME)) {
      expect(notice.textContent ?? "", `the notice echoes "${form}"`).not.toContain(form);
    }
    // And nothing about it reaches an address either.
    for (const form of urlFormsOf(NAME)) {
      for (const address of addressesIn(container)) expect(address).not.toContain(form);
    }
  });

  it("prints no such notice when the address carried nothing to drop", () => {
    render(
      <PatientsDirectory
        mayViewPatientNames
        patientNames={NO_NAMES}
        records={[planRecord({ id: "plan-1", state: "active" })]}
        filter={ALL}
        mayViewPlans
      />,
    );
    expect(screen.queryByRole("note", { name: /a saved search was not applied/i })).toBeNull();
  });
});
