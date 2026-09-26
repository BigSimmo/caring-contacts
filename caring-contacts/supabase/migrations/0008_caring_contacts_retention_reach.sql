-- caring-contacts/supabase/migrations/0008_caring_contacts_retention_reach.sql
--
-- Let a retention clearance reach the free text about a patient that lives outside the plan row,
-- and classify the two columns nobody had classified.
--
-- THIS DIRECTORY IS NOT THE REPOSITORY'S `supabase/migrations/`. That directory replays against the
-- live Clinical KB project and merging to `main` applies it there automatically, within seconds;
-- nothing here may ever be placed in it, and both tests/caring-contacts-domain-isolation.test.ts and
-- tests/caring-contacts-migrations.test.ts fail if a caring-contact migration appears there.
--
-- WHY THIS EXISTS. `markRetentionCleared` cleared exactly two things: the plan row's patient columns
-- and the cultural-identity projection. Ruling [139] MAJOR-4 found a third store it did not reach --
-- the handover note a coordinator writes when a plan moves -- and the owner ruled on 2026-08-27 that
-- such notes are deleted with the patient rather than that coordinators be told to write less. The
-- whole-branch review then found two more, and the owner approved the same disposition for all three
-- on 2026-08-28:
--
--   1. `plan_reassignments.reason` -- the handover note itself.
--   2. `idempotency_records.result` -- the verbatim result payload of EVERY write, kept for replay
--      with no expiry. A reassignment's payload is a `PlanAssignment` whose
--      `reassignmentHistory[].reason` is that same note, so clearing (1) alone would leave a
--      byte-identical copy behind.
--   3. `contact_dispatches.discrepancy_note` -- a clinician's free-text account of what happened to
--      one named patient's message, three hundred lines from a `service_stops.note` that carries a
--      "Treat it as patient data" classification and a recorded owner disposition. Somebody
--      classified that column and did not classify this one.
--
-- WHAT NEEDED A SCHEMA CHANGE, AND WHAT DID NOT. (1) and (3) needed none: the store can already
-- reach both by plan id, and this file only records what they hold. (2) needed the one structural
-- change here -- a replay record is keyed by `(team_id, idempotency_key)` and knew nothing about the
-- plan its answer was about, so there was no way to ask which records belong to a patient. It now
-- carries the plan id its write named.
--
-- REDACTED, NEVER DELETED, and this is the decision worth reading. Deleting a replay record returns
-- its key to unused: an identical retry would find nothing and EXECUTE THE WRITE A SECOND TIME. The
-- guarantee that table exists for -- one key, one execution -- would be destroyed in order to remove
-- a note, and a clinical write running twice is a worse failure than a retained note. So the row
-- stays, the key stays consumed, and `markRetentionCleared` replaces only the stored ANSWER with a
-- named refusal (`RETENTION_CLEARED_REPLAY_ANSWER` in src/lib/caring-contacts/repository.ts). A
-- replay after a clearance therefore no longer returns the original answer, which is a real
-- narrowing of the replay contract and the conservative direction: the caller is told the answer is
-- no longer held rather than being handed a discharged patient's prose.
--
-- NO FOREIGN KEY ON `plan_id`, and it is a decision rather than an omission. Two reasons, either one
-- sufficient:
--
--   * A replay record must OUTLIVE its plan. `on delete cascade` would delete replay protection
--     along with a plan and let a retry re-execute; `no action` would make a plan undeletable, which
--     is a constraint this table has no business imposing on the plans table.
--   * A REFUSED write is recorded too. A `createPlan` refused for `duplicate-active-plan` names a
--     plan id that was never inserted, so a reference would turn that named refusal into a raised
--     error -- the store's whole convention is a refusal, not a throw.
--
-- The column is therefore an unenforced pointer, and the clearance treats it as one: it updates the
-- rows that match and does not care whether the plan still exists.
--
-- NO BACKFILL, AND NONE IS NEEDED FOR THE ESCALATION EITHER. Every replay record written before this
-- migration keeps `null` and is unreachable by a clearance -- honestly so, because nothing recorded
-- which plan it was about and inventing one would be worse than leaving it. Those records predate
-- the assignments route in a prototype holding no real data. The plan's own `created_at`, which the
-- unclaimed-work escalation is re-anchored on in this same change, needs no backfill at all: it has
-- been `not null default now()` since 0001, so every existing row already carries a real observed
-- instant rather than a placeholder.
--
-- Row-level security needs nothing here. `idempotency_records` has had it enabled and forced since
-- 0002 and its policy is per row rather than per column, so the new column is reachable exactly
-- where the row is. 0002's grants are table-wide, so the application role already holds the UPDATE
-- privilege the clearance needs on all three tables; no grant is added or widened by this file.
--
-- The audit guard is untouched. `idempotency_records` is deliberately outside `attach_audit_guard`,
-- and `plan_reassignments` and `contact_dispatches` are inside it -- which is satisfied, because the
-- clearance writes its audit event in the same transaction as these updates.
--
-- Transactional: one `begin`/`commit`, no `CREATE INDEX CONCURRENTLY`.
--
-- Replay-safe: the column add and the index are `if not exists`, and every comment is idempotent.

begin;

alter table caring_contacts.idempotency_records add column if not exists plan_id text;

-- The clearance's own lookup. `team_id` leads because row-level security adds
-- `team_id = caring_contacts.current_team_id()` to every statement against this table, so a
-- plan-only index would not be reached by the query that needs it.
create index if not exists idempotency_records_team_plan_idx
  on caring_contacts.idempotency_records (team_id, plan_id);

comment on column caring_contacts.idempotency_records.plan_id is
  'The plan the stored result is ABOUT, so markRetentionCleared can find every replay record holding free text about one patient. Null for a write that named no plan, and for every record written before migration 0008. Deliberately not a foreign key: the record must outlive its plan, and a refused createPlan names a plan id that was never inserted.';

comment on column caring_contacts.idempotency_records.result is
  'The verbatim result payload of the write this key protects. It can therefore hold free text a clinician typed about a patient -- a reassignment payload carries the handover note. Treat it as patient data. markRetentionCleared REDACTS it to a named refusal rather than deleting the row, because deleting the row would free the key and let a retry execute the write a second time.';

comment on column caring_contacts.contact_dispatches.discrepancy_note is
  'Free text written by a clinician about what happened to one named patient''s message. Treat it as patient data. Required non-blank on write by the domain; cleared to the empty string by markRetentionCleared, which is a value no write can produce, so a removed note stays distinguishable from an attempt that never had one.';

comment on column caring_contacts.plan_reassignments.reason is
  'The handover note a coordinator wrote when this plan moved. Free text about one named patient. Treat it as patient data. Cleared to the empty string by markRetentionCleared; the row itself survives, because spec 4.3 requires a formal reassignment to stay visible and from/to/at hold no patient content.';

comment on column caring_contacts.plans.created_at is
  'The observed instant this plan came into existence, and therefore the instant it became free for a coordinator to take: a plan is created with no assignment row, claiming requires only that there is no owner, and nothing in this domain returns a claimed plan to unowned. Released on the contract as PlanRecord.createdAt and used as the anchor for the spec 4.2 unclaimed-work escalation. Written from the domain clock by createPlan rather than left to the default, so both stores answer from one clock.';

commit;
