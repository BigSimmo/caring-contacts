-- caring-contacts/supabase/migrations/0007_caring_contacts_preferred_name.sql
--
-- Keep what the patient asked to be called in the messages they receive.
--
-- THIS DIRECTORY IS NOT THE REPOSITORY'S `supabase/migrations/`. That directory replays against the
-- live Clinical KB project and merging to `main` applies it there automatically, within seconds;
-- nothing here may ever be placed in it, and both tests/caring-contacts-domain-isolation.test.ts and
-- tests/caring-contacts-migrations.test.ts fail if a caring-contact migration appears there.
--
-- WHY THE COLUMN EXISTS. The patient-visible message opens with a name (owner decision, 2026-08-26),
-- and the system ASKS for that name rather than splitting the one it already stores.
-- `patient_name` is a single free-text box: splitting it at the first space greets a person with one
-- name by their only name, a person whose family name is written first by their surname, `Mr John
-- Smith` as "Mr", and someone with two given names by half of them. All four are ordinary in Perth,
-- and a suicide-prevention message opening with a surname or a title is worse than one opening with
-- no name at all. So nothing anywhere derives this column from `patient_name`; a clinician types it.
--
-- WHAT IS DELIBERATELY NOT HERE:
--
--   * NO DEFAULT, AND NO BACKFILL. The column is nullable and every existing row keeps null. A plan
--     created before this migration genuinely holds no preferred name, and that is a fact the
--     interface states as its own. Writing a placeholder -- a first token of `patient_name`, or a
--     literal such as 'not recorded' -- would fabricate a clinical record and make it
--     indistinguishable from a name a clinician was actually given.
--
--   * NO `not null`. Same reason: a row that predates the column has no value to be not-null with,
--     and there is nothing honest to put there.
--
--   * NO SECOND COPY OF `patient_name`. This is a different fact, supplied by a different act. A
--     column populated from the other would be a second answer to a question nobody asked.
--
-- THE EMPTY STRING IS NOT REFUSED, AND THAT IS THE ONE PLACE THIS DIFFERS FROM 0005. There, null is
-- what "absent" means and `''` can only be a caller's bug, so the check refuses it. Here `''` is the
-- value a RETENTION CLEARANCE writes -- exactly as it already does for `patient_name`, which is
-- `not null` and so has no other way to say "removed". The three values therefore mean three
-- different things and stay distinguishable: a non-empty string is a recorded name, `null` is "no
-- preferred name is held", and `''` is "a name was held and retention removed it". The application
-- schema (`createPlanSchema.patientDetail.preferredName`) is `min(1).nullable()`, so `''` cannot
-- arrive through the API at all; the clearance is its only writer.
--
-- THE LENGTH CHECK IS A BACKSTOP, NOT THE ENFORCEMENT, exactly as in 0005. The rule is owned by
-- src/lib/caring-contacts/message-copy.ts, where an over-long name is refused BY NAME
-- (`preferred-name-too-long`) before any message is built. This check exists so a write that reached
-- the table another way cannot store unbounded free text in a column a patient-visible message is
-- substituted from.
--
-- THE NUMBER IS `PREFERRED_NAME_MAX_SEPTETS`, AND THE UNIT IS DELIBERATELY WEAKER THAN THE DOMAIN'S.
-- The domain caps the name's GSM-7 SEPTET cost, because that is what decides whether the message
-- fits two segments; Postgres cannot count septets, so this counts characters. Every character costs
-- at least one septet, so `septets <= N` implies `char_length <= N`: this constraint can never
-- refuse a name the domain accepted, and drift can only ever make it redundant rather than make it
-- reject a clinical write. That is the same one-way asymmetry `isAwstCalendarDay` has with the
-- calendar-day pattern check, and the opposite of 0005's, where the two express one rule in one unit
-- and so had to be pinned equal. tests/caring-contacts-domain-isolation.test.ts fails if the domain
-- cap ever rises above this number.
--
-- Row-level security needs nothing here. `caring_contacts.plans` already has it enabled and forced,
-- policies are per row rather than per column, and 0002's grants are table-wide -- so this column is
-- reachable exactly where the row is, and nowhere else.
--
-- Transactional: one `begin`/`commit`, no `CREATE INDEX CONCURRENTLY`.
--
-- Replay-safe: the column add is `if not exists`, and the constraint is added only when absent.

begin;

alter table caring_contacts.plans add column if not exists preferred_name text;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class t on t.oid = c.conrelid
    join pg_catalog.pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'caring_contacts'
      and t.relname = 'plans'
      and c.conname = 'plans_preferred_name_shape'
  ) then
    alter table caring_contacts.plans
      add constraint plans_preferred_name_shape
      check (
        preferred_name is null
        -- No longer than the domain's cap. The number must not be below
        -- PREFERRED_NAME_MAX_SEPTETS in src/lib/caring-contacts/message-copy.ts; see the note above
        -- on why the units differ and why the comparison is one-way.
        or char_length(preferred_name) <= 59
      );
  end if;
end;
$$;

comment on column caring_contacts.plans.preferred_name is
  'What the patient asked to be called in messages, typed by a clinician and never derived from patient_name. Cleared to the empty string by markRetentionCleared with the rest of the patient detail; null means none was ever held; never selected by a list read.';

commit;
