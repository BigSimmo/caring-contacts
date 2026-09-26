# Standing verification discipline — read once, applies to every Caring Contacts task

Every brief in this programme referenced these rules in full, which cost about forty lines per brief
and drifted between them. They live here now. **A brief that says "the standing discipline applies"
means all of this.** Where a brief contradicts this file, the brief wins — it knows its task.

Every rule below was bought by a real defect in this programme, and the defect is named so you can
tell whether your situation is the one it is about.

## Mutation testing

- **Test-first.** Task 7 skipped it, disclosed it honestly, and it cost exactly one real bug: an
  in-memory fallback unreachable in the exact case its own comment claimed it handled. Nobody had
  written an assertion about that branch, and **mutation testing can only falsify tests that exist.**
- **A mutation proves the assertion it makes fail, not the case it makes red.** A case with N
  assertions needs N mutations, or it needs splitting. Two ways this bites: an assertion behind a
  sibling that fails first is never reached; and an assertion nobody mutated is simply unproven.
- **Check first that the mutation changes a value some assertion reads.** A mutation that leaves every
  asserted value unchanged proves nothing however red the suite goes.
- **Predict each failure message, then compare.** An unexpected number in an assertion error is a
  second defect. One control here fired at `expected 3 to be 1` where 2 was predicted — it was
  counting its own explanatory comment.
- **Itemise every attempt**, including greens and unmatched anchors. **No aggregate total** — the table
  is the evidence, and a total that reconciles invites nobody to check its parts.
- **A mutation that should leave a gate green is evidence too.** Label it; over-sensitivity controls
  belong in the ledger beside the reds.
- **A check you believe is redundant is a hypothesis.** Mutate it before filing it as unnecessary. One
  `not.toContain` loop here was nearly deleted as implied by the assertion above it — which passes,
  because both sides read the same record.
- **A test that installs a double must assert the double was used.** jsdom's storage is a Proxy
  answering from the prototype, so a mock assigned to the instance is never called and the test passes
  inert.
- **"Could this possibly go red?" is a question for EVERY assertion.** Ask it as you write each one,
  before any mutation exists to answer it for you.

  This rule replaced a narrower one, and how the narrower one failed is the point. Task 9b's M6 found an
  assertion comparing three reads only to each other — emptying the mapper they shared left it green,
  because three empty lists agree perfectly. That was written up as a rule about **comparing two outputs
  of one function**; the implementer then hunted its own diff for that literal shape and correctly found
  none. The next review found **three more instances in the same diff**, in different clothes: a field
  asserted null where the fixture had set it null; a length held against the very list the function
  filters; an absence checked across four reads with no positive control, which four empty reads satisfy.

  Its own conclusion is better than the rule it corrected: **"I proved each property where it was
  convenient to assert rather than where it is load-bearing."** That is the family. Comparing two outputs
  is one member, and hunting for the member misses the family.

  Two forms that catch most of it:
  - **Give every absence a positive control.** Set the value, assert it is held, _then_ assert the act
    under test removes it. An absence asserted over a fixture where the value was never present is
    decoration presented as proof.
  - **Assert where the property is load-bearing, not merely where it is reachable.** Task 9b proved its
    named refusal on the panel that displays it and not on the control a coordinator actually presses —
    so the property was real, and proven on a surface nobody reaches by the path the fix had just created.

- **Do not label an assertion "cannot fail" unless you have checked which inputs it reads.** Task 12
  marked two fixture preconditions as unable to redden under any mutation of the module under test. One
  read planner records and was right; the other read the module's own **output** and reddens under M20.
  The error was conservative — it under-claimed — but "this cannot fail" is exactly the note a later
  reader trusts without re-deriving.
- **Commit each piece before you mutate the file it lives in.** `git checkout --` also discards any
  uncommitted fix in that file.
- **Never `git add -A`, `git add .` or `git commit -a` while a mutation is applied.** This has now
  captured a live mutation into a commit **three times** in this programme — twice by the controller
  sweeping an implementer's uncommitted work, once by an implementer committing its own mutation. The
  worst instance disabled the demo's only entry point by leaving a referral in `awaitingHandover`;
  the full suite caught it. **Stage explicit paths, always.** The two rules are converses and you need
  both: commit before mutating, and never stage by wildcard while mutated.

## Proving a mutation is present

- **Do not run the presence check through a shell.** On this Windows machine the MSYS2 runtime
  re-parses the command line, so an argv element containing `"`, `{`, `?`, `[` or `*` is not the string
  you sent. `grep -c` silently returns 0 for a mutation that is demonstrably present, and **`-F` does
  not fix it** — `-F` governs how grep reads a pattern it has already received. Read the file
  in-process and check the substring there.
- **Treat exit 1 as distinct from a count of 0.** A driver that conflates them cannot tell "no match"
  from "the tool refused to try".
- **A red proves presence by itself** — a mutation that never reached disk cannot make its own target
  assertion fail. **So a presence check is load-bearing only for a GREEN.** Three conditions:
  the failure message names the mutated behaviour; the assertion was green on the same tree
  immediately before; and the worktree is quiet with a deterministic assertion. File-content
  assertions meet the third trivially, async DOM assertions do not.
- **Assert `git diff --quiet` clean on both sides of every mutation.** A concurrent writer in the same
  worktree has voided a whole mutation round here, and this is how you find out rather than absorb it.
- **Re-establish the unmutated baseline on the tree you are mutating. A round that never does can launder
  a broken test into proof.** Task P nearly shipped two: `M20` went **green** where red was predicted,
  which exposed that the property it guarded had never been tested at all because no fixture built the
  row; and `M20b` went **red for the wrong reason**, because the case added to fix that was itself failing
  unmutated against a schema trigger. **Neither was caught by the mutation ledger.** Both were caught by
  running the whole suite **unmutated, on a clean tree**.

  The sharp part is why the ledger could not catch them: `M20b`'s first failure named the **same test** as
  the runs that followed it, so the failing test name could never have distinguished a real red from a
  pre-existing one. **Only the unmutated verdict on the same tree could.** Two other rows in that task
  were likewise unattributable — they had run in a window where their target file was failing on its own,
  and their `Test Files 1 failed (1)` line is byte-identical to what that failure alone prints.

  So: **record the commit each row ran against**, and re-run the baseline whenever the tree moves. A red
  is only evidence if you know the suite was green without you.

- **Check presence by BYTE EQUALITY against a computed post-image — and assert the post-image differs from
  the original first.** Compute `expected = before.replace(find, replace)`, **assert `expected !== before`**,
  write it, re-read from disk, and assert `onDisk === expected` byte for byte. Substring heuristics fail
  structurally: `!after.includes(find)` is false for **every additive mutation**, because a replacement that
  is a superstring of its anchor still contains it. Occurrence-counting fails the same way.

  **Two guards, two distinct failure modes, and neither substitutes for the other.** An occurrence guard
  (the anchor appears, exactly once) catches an **absent or ambiguous anchor** and fires first. The
  `expected !== before` assertion catches a mutation that **matches its anchor and changes nothing anyway** —
  which no count can see. The controller published this rule once _without_ the second guard, attributing
  the absent-anchor case to it; an implementer corrected that by building a positive control for each —
  `CTRL_NOOP` (replacement equals anchor) and `CTRL_ABSENT` (anchor not in the file) — and confirming each
  threw on its own line. **A check written to fix a check is still a check.**

- **Validate every row your driver consumes against an allowlist of the files THIS task may mutate, before
  any file I/O — and assert id uniqueness.** A **foreign row from another task's table** reached a driver
  here as an append edit to its own array, shaped differently, naming a file the branch never touched. With
  no `find` key it counted occurrences of the literal `"undefined"`, got zero, and took the no-write skip
  path — logging as a near-miss rather than an error, under a **duplicate id** that made it read as this
  task's own row failing. **Ledger identity was what got corrupted.** Namespacing a directory cannot stop
  this and a shape heuristic cannot either: a foreign row carrying the right keys passes and is applied to
  another task's file. The allowlist must run **before** the read, or a row naming an absent path throws an
  uncaught ENOENT and kills the pass before any refusal can fire. The escape was narrow — the foreign
  anchor occurred exactly once in the file it named, so a `find` key would have applied it.

## Reporting a gate

- **Never report a gate as passing from an exit code. Paste the `N passed` line.** A refusal arriving
  through a pipe leaves `$?` reading **0** for a gate that never ran, and one wrapper here printed
  `[exited with code 0]` while reporting `1 failed`.
- **No summary line means no run**, whatever the exit code says.
- **Run controls with `GATE_RECEIPTS=refresh`.** A restored tree hits a cached receipt and exits 0 with
  no summary line, which reads exactly like a gate that never ran.
- **`npm run lint` uses a per-file cache.** A file that has not changed is not re-examined — so a
  failure caused by a _different_ file's change stays invisible locally and goes red in CI. If lint
  matters to your claim, clear `node_modules/.cache/eslint` or run `npx eslint <paths>` without it.
- **A gate's verdict covers the tree it saw. Any edit after it voids the verdict — RE-VERIFY after your
  final edit.** One task lost two rounds to this identically: typecheck passed, a case was added
  afterwards, the added case did not compile. Both times the error was real and both times it was
  invisible because the gate had been run and mentally banked. **This includes an edit that only adds a
  test.** Its own first draft of this rule was "run the gate last", and the correction is the reason the
  rule reads as it does: _"run it last" only prevents this if nothing is added afterwards — which is
  precisely the assumption that failed twice._ Ordering is not the mechanism; re-running is.
- **Check every SHA you write down still exists**, with `git cat-file -e <sha>^{commit}`. A reported
  `4c1a5ff96` had been orphaned by an amend to `856f1fd7e`; the controller copied the dead SHA into a
  review brief without checking, and the reviewer spent time reconstructing the real range. This binds
  **whoever repeats a SHA**, not only whoever first produced it — a commit identifier is a claim about
  the repository like any other.
- **The session scratchpad is NOT private — namespace anything you write there by worktree.** Several
  tasks share one machine and one scratchpad path. An implementer's mutation driver was overwritten by a
  different task's driver at the same path; running it produced **the other task's output** — different
  worktree, different suite, different test count — and because that driver takes its ledger filename as
  an argument, it wrote the **wrong task's ledger into a file named after this task's mutation**. Nothing
  was corrupted and only the test count made it obviously foreign. Mutation evidence is the entire basis
  on which this programme accepts work, so **an unattributable result is worse than a missing one**. Put
  the worktree name in the **path**, make every result identifiable by something other than the fact that
  you ran it, and when a number surprises you, **check whose result it is before interpreting it**.

## Gates, and the shared machine

- **Run `npm run test:cc-guards` only** — never the full `npm run test`. It takes a _shared_ lease and two
  are permitted concurrently across worktrees.
- **But per MUTATION, run only the suite(s) that mutation targets**, not the whole guard set:
  `node scripts/run-vitest.mjs run --reporter=dot tests/<the-suite>`. Explicit test paths still qualify for
  the shared lease, so the run stays coordinated and frees the slot far sooner. The guard set names twenty-
  plus suites and four-hundred-plus tests, and a mutation round is twenty to thirty of them — re-running
  everything to prove one assertion in one file is the single largest avoidable cost in this method.

  **This buys speed, never evidence, and the boundary is what keeps it honest:**
  - **The full `test:cc-guards` still runs once at the end, on the final tree**, with its `N passed` line
    pasted. That is what catches a mutation reddening something nobody predicted; a narrowed run cannot see
    collateral damage and must never be reported as though it could.

    **This is measured, not a precaution.** Task 14 added a `useRouter()` call and it broke **eleven
    Schedule-screen cases and two page cases that no per-mutation selection ever ran** — `invariant
expected app router to be mounted`, thrown at render. Every narrowed row was green; only the wide run
    at the end saw it. **The narrowing is safe precisely because this run exists**, so a task that narrows
    its rows and then skips the full run has not saved time, it has removed the thing that made narrowing
    safe.

  - **Predict and compare the failure message exactly as before.** Narrowing the selection narrows the
    files, never the evidence owed.
  - **Where a mutation targets a shared mechanism** — a type every overlay consumes, a helper three routes
    call — run the wider set. An honest slower row beats a fast wrong one.
  - **Record which selection each row used**, so a per-suite red is never read as a full-set red.

  Measured 2026-08-26: four implementers plus another project competing for **two** shared slots produced
  eight consecutive refusals in one round, a typecheck needing four attempts, and one final gate that took
  **21 attempts over 20 minutes** behind another worktree's Playwright run.

- **Two refusal shapes exist, and a detector that knows only one reports a refusal as a run.**
  `run-heavy.mjs` prints `DATABASE_HEAVY_RUN_ADMISSION_BUSY`; the lock module **throws**, ending in a Node
  stack with no marker. A loop matching only the marker reported _"ran on attempt 7"_ with a stack trace as
  its evidence. Match both — this is the same family as the gate-wrapper traps already in this ledger.
- **Do not run the full `npm run test`.** The controller runs it once per branch at the merge point,
  when the other worktrees are idle. Its value is catching cross-file breakage, which matters at
  merge rather than per task.

  **Why this rule exists, measured 2026-08-26:** with three implementer worktrees plus another
  session live, the exclusive heavy lease was held continuously and **`run-vitest.mjs` queues rather
  than refusing** — so a suite blocks inside the child process with no refusal to retry around. One
  task's mutation ledger came back **ten of twelve unrun**, and the casualty was the one mutation that
  distinguished a real pair of assertions from an inert one. **An honest unrun row is worth more than
  a forced lease**, and a policy that stops the starvation is worth more than either.

- **A lock refusal is neither a pass nor a failure.** One exclusive heavy job runs at a time across
  **every** worktree of this repository, and other implementers are usually active. Retry; **never
  force past another worktree's lease.** If you believe an orphaned run is your own, prove it from the
  lease record's `worktree` field rather than a live PID — and **evidence adequate for waiting is not
  adequate for breaking a lease.** A foreground run killed at a tool timeout once orphaned the lease
  for 26 minutes and blocked every worktree.

- **A gate names its suites by hand, so it drifts from the suites that exist — union it and diff it before
  you trust it.** `test:cc-guards` is a hand-maintained list of paths in `package.json`. Nothing adds a suite
  to it when a suite is written, and nothing warns when a module the gate covers acquires a test the gate
  does not name. Both failures are silent, and "the gate is green" reads identically either way.

  **Measured across this phase's five branches:** thirty-two Caring Contacts suites exist that appear in
  **no** branch's gate — among them `message-policy` and `message-copy`, whose modules one branch had just
  changed, holding 68 cases importing exactly those two modules. Also absent: `permissions`, `assignment`,
  `access-audit`, `repository`, `contact-rescheduling`. These are not obscure corners; they are the direct
  behavioural suites of the things being built.

  **So before trusting a gate: list the suites it names, list the suites that exist, and diff the two.**
  Then run whichever of the missing ones cover a module you touched, narrowed, and paste the line. Doing
  that here turned 302 never-run cases into evidence in under a minute of machine time — and had any of them
  reddened, it would have been found before a merge instead of after one.

  **The failure this prevents is subtler than missing coverage.** An implementer reasoning from "what does
  the gate run?" concluded a distinction was **unprovable offline** that an unrun suite already proved. A
  gate that omits a suite does not merely skip it — **it hides the precedent**, and the next person rebuilds
  or defers something that was already settled.

- **A type derived from a value is still a value at runtime — a "type-only" mutation is not one.** Task 14
  predicted GREEN for a control that renamed a field in a Zod schema and ran the **suite** rather than
  `tsc`, reasoning that the change was type-level. It came back **RED, 6 failed / 11 passed**: the test
  double validates with that same schema, so the mismatched body was refused at runtime too. **This was the
  second identical wrong prediction in one task** — the same shape had already been called wrong in round 2.

  `z.infer` and its relatives make a **runtime object** look like a type-level relationship. When you mutate
  one, ask which callers read the _object_ and which read the _type_, and predict per gate — `tsc` red and
  the suite green is a real and common outcome, but so is both red, and asserting one without checking is
  guessing dressed as a control.

  **A wrong prediction that is reported is worth more than a right one that was never at risk.** The value of
  this entry is that the implementer volunteered the miss rather than relabelling the control after the fact.

## Writing that does not decay

- **Do not restate a count in prose.** State the invariant. A count sitting **directly on top of the list
  it counts** is acceptable; a count about something elsewhere is the decaying form.

  **The actionable test, because the rule above is not enough on its own:** ask whether the thing the
  number counts is **visible in the same view as the number**. If it is not, name the set instead of
  counting it. This rule has now been broken by every role in this programme — implementer, reviewer and
  controller — repeatedly **in the act of removing someone else's count**: once inside the very comment
  written to remove counts; once in a Prettier evidence row inside the fix that removed a false count
  from a code comment ("the five Task 12 source and test files" — there were seven, listed two sections
  away); and once in the controller's own notes, where a pre-computed path count was wrong within the
  hour because a live fix round added a file while it was being written down. **A number about a set that
  is still moving is already wrong.**

- **Name the state, not the cause.** The controller ruled that a contact sitting outside the three named
  sending windows should be labelled "moved", having correctly verified that a deliberate move is the
  only way to produce one. The premise was true and the label was still wrong, because the **converse**
  is false: a contact moved onto an approved hour is indistinguishable from one that was always there.
  "Only X produces Y" licenses _"Y implies X"_ and nothing else — it does not license naming the Y-group
  after X, because that name also claims **"not-Y implies not-X"**, a different proposition. **A label is
  a claim about the whole partition, not only about the members it is attached to.** Where a state has
  one cause but the cause has more than one outcome, name the state.
- **Name the destination, not the act.** "Recorded on the plan" survives; "stored", "kept" and
  "recorded" alone do not, because this system distinguishes _held in a tab's storage_ from _written
  onto the plan_ while ordinary English does not. One sentence here was wrong twice, in opposite
  directions, before it stuck.
- **When a diff changes what a mechanism does, read every doc comment in the files it touches** and ask
  whether each still describes the code beneath it. A phrase grep is the mechanised subset of that and
  catches only literal repeats; the scope rule found four stale comments where the phrase rule found
  one.
- **A mechanism you have not seen run is a hypothesis. Reporting it as coverage is the failure.**
- **Disclosing a limitation is not discharging it.** A frank paragraph about a gap reads — to its
  author most of all — as though the gap has been handled. It has been described.
- **A `\b` you write can arrive as a literal `0x08` byte**, which renders as nothing and makes a regex
  match nothing while every gate stays green. Prefer `\\b` or an explicit character class.

## Repository constraints that fail the build

- Nothing under `src/lib/caring-contacts/` may import from `@/components`, `@/app`, any `@/lib` module
  outside itself, Supabase, or OpenAI. **A screen must never re-derive a rule a module owns.**
- **The service-state incident `note` must never cross into a Client Component.**
- Every `<button>` does something. A control unavailable for a **stated reason** uses
  `aria-disabled="true"` + an inert handler + `title="… — coming soon"` + an `sr-only` note. Native
  `disabled` is for **transient** inertness only; never both on one control.
- Internal navigation via `<Link>` / `router.push` / server `redirect()` — never a raw `<a href="/…">`,
  **including in tests**, once the route exists.
- Design tokens only, no hardcoded hex. Tap targets `min-h-12` (48px), **never `min-h-11`**, and put
  it on the element **containing** the control — on a wrapper it leaves the row's whitespace dead.
- **Patient-visible copy is frozen.** A screen that hardcodes one is a defect even when the string is
  correct. **You may not draft any patient-visible message wording, ever** — especially a closing
  message, which the owner deferred to a lived-experience representative.
- **The closed transport vocabulary is frozen**: high risk, safe, engagement score, campaign, lead,
  conversion, best match, inbox, conversation, clinical risk, risk score, wellbeing score, and any
  claim that replies are monitored. `Delivered` is a transport receipt, never a patient-state label.
  The scan checks **bare identifiers too**.
- **Never render a raw role identifier to a clinician.** Role wording lives in the sealed domain and is
  resolved server-side. The interface-vocabulary scan currently _rewards_ leaving identifiers on screen
  — it refuses "lead" as a whole word but passes `clinicalProgrammeLead` on a missing word boundary.
  That inversion is filed; do not exploit it.
- **This is Next.js 16.** Read `node_modules/next/dist/docs/` before writing route or boundary code.

## The approved mockups picture a later product

Five values the design shows arriving from a hospital record this system is not connected to: stage
1's identity, stage 3's personalisation, the mobile number, the discharge date, and cultural identity.
**If you find a sixth, report it — do not invent a source for it.** The design is a specification for
the product; the types are a specification for what exists. **Where they disagree, the types win, and
the disagreement is worth recording rather than silently resolving.**

## Reporting

- **A reviewer's factual claim is a claim, not a finding already checked.** This one binds the controller
  hardest, because a brief is the most expensive place for a false claim to sit — every later round
  inherits it with no reason to doubt it. **Four were relayed unverified in one session and all four were
  wrong**: an orphaned commit SHA; "only `Ari Sample` is new", disproved by checking each name at the merge
  base and finding **not one given name was new**; "no room left" in a message-length comment, which meant
  no room for one specific sentence and was reported to the owner as a hard ceiling; and a per-file test
  count relayed into a merge note, where the file's `it.each` meant **no single number described it**.
  Adjudicating between an implementer and a reviewer does not make either one's premises true.
- **A scoped re-review is not owed for every fix round.** Dispatch one when the round **changed code
  behaviour**. Accept without one when it was **prose or report corrections only**, or a small,
  precisely-enumerated set of fixes that arrived **mutation-proven with observed messages**. Record the
  judgement. A third review pass over comment edits has repeatedly returned "nothing here should hold the
  merge", and it costs a full reviewer seat each time.

Commit early — before waiting on any gate. Write the full report to your named report file and return
only: status, commit SHAs, a one-line test summary, and your concerns. **Do not push and do not open a
pull request. Do not dispatch subagents.** If the brief is unclear or contradicts the tree, **ask
before implementing rather than guessing** — and if an earlier task's report does not match what it
actually left you, that is a finding, not something to work around silently.

## For the controller — the two rules the controller kept breaking

Everything above binds implementers. These two bind whoever is dispatching them, and both were bought at
full price in this phase.

- **A narrowly-verified fact must be stated at the scope it was checked at, and no wider.** Ten instances in
  one session, several of which changed what got built: a component verified on one branch and asserted about
  the tree, producing two implementations of `ExitOnlyOverlayTrigger`; a matrix row read correctly and
  transcribed wrongly into a brief, which would have thrown at render for every coordinator opening the
  pathway chooser; a per-attempt record reported absent because one screen could not reach it.

  **The tell is a sentence with no subject.** "The trigger exists." "No per-attempt record exists." "Only one
  name is new." Each was true of something — a branch, a screen, a comparison — and the something was dropped
  on the way into the brief. **Write the scope into the sentence**: _on `cc-plan-detail`_, _from the delivery
  screen_, _against the seed's given names_. A claim that cannot name where it was checked has not been
  checked.

- **An implementer's status line is not acceptance, and neither is a green gate.** Task P reported complete;
  its round 2 held a 49-line code change to `message-copy.ts` — the module carrying the words a discharged
  patient reads — and no re-review had closed it. It was recorded as accepted and came within one step of
  being merged on the strength of the word "complete".

  **Acceptance is a thing the controller does, with evidence, after a review returns.** The cheap check that
  would have caught it: for every task about to be merged, name the review that closed its **last** round —
  not its first. A round that follows a review is the round nobody reviewed unless somebody re-reviewed it,
  and the rule permitting a re-review to be skipped applies to **prose-only** rounds. Read the round's diff
  before invoking that rule; a commit subject saying "docs" is a claim like any other.
