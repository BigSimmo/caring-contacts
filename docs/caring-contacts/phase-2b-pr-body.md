# Caring Contacts Phase 2B — prepared pull-request body

**This file is the PR description, held here until the owner asks for the pull request to be
opened.** It is kept in the repository rather than in a chat message because
`scripts/pr-policy.mjs` parses the body as structured input: it matches the seven governance items
by exact string, so a paraphrase fails the gate silently. Copy this file's contents below the rule
verbatim.

---

## Summary

Phase 2B builds the Caring Contacts workspace: a coordinator's surface for a fixed schedule of brief
supportive messages to people recently discharged after a suicide-related presentation. **Every
patient in this system is fictional and nothing is ever sent to any telephone number** — there is no
carrier integration, no dispatch transport, and the specimen marker on the message body is asserted
by tests on both the scheduled message and the automated reply.

- **The workspace itself** — caseload, per-patient plan, schedule by day, templates, guidance,
  and reports — sharing one shell with the existing clinical modes.
- **The plan lifecycle** — pause, resume, withdrawal and reassignment, each with an explicit
  lifecycle version, an announcement to assistive technology, and no silent path out of the handler.
- **The team surface** — an operational roster showing who is carrying which plans and what is
  unclaimed. It deliberately **does not rank clinicians**, per the phase specification.
- **Reporting** with small-cell suppression at a threshold of 5, recorded with its decision-maker
  and date rather than left as an unattributed constant.
- **A Postgres schema with row-level security**, exercised by a database suite that runs against a
  real Postgres 17 in CI and is required by `pr-required` whenever database paths change.
- **A decision record** at `docs/caring-contacts/phase-2b-build-record.md` carrying 157 numbered
  rulings, including every defect found and every premise that turned out to be wrong.

## Clinical Governance Preflight

- [x] Source-backed claims still require linked source verification before clinical use
- [x] No patient-identifiable document workflow was introduced or expanded without explicit governance approval
- [x] Supabase target remains `Clinical KB Database` (`sjrfecxgysukkwxsowpy`)
- [x] Service-role keys and private document access remain server-only
- [x] Demo/synthetic content remains clearly separated from real clinical sources
- [x] Source metadata, review status, and outdated/unknown-source behavior remain conservative
- [x] Deployment classification/TGA SaMD impact was checked when clinical decision-support behavior changed

**Notes against those items, in full rather than as ticks alone.**

This change introduces **no source-backed clinical claim and no retrieval path**. The patient-visible
message is a fixed, frozen string; it is not generated, not retrieved, and not ranked. The only
externally verifiable facts it contains are two crisis telephone numbers — Lifeline `13 11 14` and
13YARN `13 92 76` — which the service owner confirmed explicitly on two separate occasions, recorded
as rulings [144] and [156]. **That confirmation is the governing control**, because no check inside
this repository can establish whether a telephone number connects to anybody.

**No patient-identifiable workflow is introduced.** Every person in this system is fictional. The
demonstration seed contains three invented people whose surnames are literally `Example` and
`Sample`, and the free-text fields that could otherwise accumulate identifiable detail — a
reassignment reason, a dispatch discrepancy note — are cleared on retention expiry.

**No Supabase target changed**, and no service-role credential moved. The Caring Contacts schema is
a separate namespace with its own row-level security, verified against a real Postgres rather than
against a mock.

**Demonstration content is separated by construction, not by convention.** The seed is refused
outright in production and the specimen marker is asserted on the message body, so a demonstration
record cannot be mistaken for a real one at the point where it would matter.

**Failure behaviour is conservative throughout.** An unknown state does not render an optimistic
one: an unclaimed plan says it is unclaimed, an empty roster says nobody is carrying work, and a
failed delivery surfaces for review rather than being retried into silence.

**On deployment classification: this is a prototype, not clinical decision support, and it is not
being proposed for patient use in this pull request.** Three hazards remain unmitigated and are
tracked as outstanding item `#1S81R8` — safety-officer review, lived-experience review, and
Aboriginal health review. **None of them can be closed by code**, and this pull request does not
claim to close them.

RAG impact: no retrieval behaviour change — this change touches no file under `src/lib/rag/**` and
none of the protected ranking surfaces (clinical-search, retrieval-selection, released-search-order,
ranking-config, answer-ranking, answer-verification), adds no comparator key, and leaves the golden
fixture and eval harness untouched. Verified by listing the diff's paths against that set.

## Verification

Every gate below was re-run **after** catching up on `main` (which had moved ahead by #2447, other
Caring Contacts work), with the local dev server stopped so nothing could rewrite generated files
mid-check.

- [x] Full unit suite — `11587 passed | 75 skipped` (925 files), zero failures.
- [x] Database and row-level-security suite — `213 passed`, against Postgres 17 in a container. The
      suite drops the schema and replays the whole migration chain from empty, so this is also the
      proof that migration 0008 replays from nothing.
- [x] Lint — clean at `--max-warnings 0`.
- [x] Typecheck — exit 0, unscoped.
- [x] Cold build — compiled from a cleared `.next`; client bundle secret-surface check passed.
- [x] Bundle budget — production 1725.0 KiB gzip against a 1656.0 KiB baseline, within tolerance;
      mockups 637.9 KiB against 613.1 KiB, within tolerance; both measured routes within tolerance.
- [x] Browser gate — `629 passed (21.8m)`, Chromium, full journey set, run on the pre-merge tree.
      Re-run against the merged tree is delegated to this PR's own Chromium job rather than bought
      twice locally.

Every figure above is the decisive line from the gate's own output, not a summary of an exit code.

**The main merge found a defect, stated rather than buried.** One test went red that could not have
failed on either branch alone: #2447 added a route error boundary that matches a thrown error's
message text against a substring list including the literal `"permission-unavailable"`, and this
branch's overlay-trigger inventory records that id as unwired and scans for it by plain text. The
record is still true — that boundary renders a full-page component and never opens an overlay — so
the mention is now **declared on the record itself**, and the guard is checked in both directions so
a declared exemption fails once it stops being needed. Both new guards were mutation-tested.

**One warning, stated rather than hidden.** `check:bundle-budget` reports that its recorded baseline
commit cannot be verified as an ancestor of `HEAD` in this checkout. That is a missing-object
condition in the local clone, not a size regression — every measured figure is inside tolerance.

## Risk and rollout

**The largest risk in this pull request is its size**: 216 files across 514 commits. That is a
consequence of the phase being built and merged as one unit, and it is stated plainly rather than
minimised. The mitigation is the decision record: every non-obvious choice, every defect found, and
every wrong premise corrected is written down with a ruling number, so a reviewer can read why a
thing is the way it is without reconstructing it from the diff.

**Nothing here is reachable by a patient and nothing here sends anything.** The rollout is: merge,
leave the workspace as a prototype behind the existing surfaces, and do not proceed toward any real
pilot until `#1S81R8`'s three reviews are complete.
