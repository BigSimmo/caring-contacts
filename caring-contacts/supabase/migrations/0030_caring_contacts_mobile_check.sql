-- caring-contacts/supabase/migrations/0030_caring_contacts_mobile_check.sql
--
-- Record whether a plan's mobile number has been checked with a one-off test text.
--
-- THIS DIRECTORY IS NOT THE REPOSITORY'S `supabase/migrations/`. Nothing here may ever be placed
-- there; see 0005 for why, and the two tests that fail if it is.
--
-- WHY. A mistyped mobile number sends a year of caring contacts to a stranger while the patient
-- hears nothing. A staff member can now send a fixed test text while the patient is with them and
-- record whether it arrived; while a sent test is unanswered, or did not arrive, the plan may not
-- start or restart (`mobile-check-unconfirmed`, see src/lib/caring-contacts/mobile-check.ts).
--
-- WHAT THE COLUMNS HOLD. A closed state and two instants -- no patient content. They are therefore
-- selected by list reads (the check shows on the caseload), and `markRetentionCleared` leaves them
-- alone, for the reason 0006 gives for the plan assurances: they record that a check happened, not
-- anything about the patient. The number itself stays in `patient_mobile_number`.
--
--   * `mobile_check_state` is NOT NULL with a default of 'notChecked', which is the honest value
--     for every existing plan: none was ever checked this way. The check constraint must list
--     exactly `MOBILE_CHECK_STATES` in src/lib/caring-contacts/mobile-check.ts.
--   * `mobile_check_sent_at` / `mobile_check_resolved_at` are nullable and unbackfilled.
--
-- Row-level security needs nothing: `caring_contacts.plans` already has it enabled and forced, and
-- policies are per row. Privileges need nothing either: adding a column to a table the application
-- role may already update grants it nothing new, so no 0004/0006-style re-narrowing is required,
-- and no blanket grant is re-run here.
--
-- Transactional: one `begin`/`commit`. Replay-safe: `if not exists`, and the constraint is added
-- only when absent.

begin;

alter table caring_contacts.plans
  add column if not exists mobile_check_state text not null default 'notChecked';
alter table caring_contacts.plans add column if not exists mobile_check_sent_at timestamptz;
alter table caring_contacts.plans add column if not exists mobile_check_resolved_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class t on t.oid = c.conrelid
    join pg_catalog.pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'caring_contacts'
      and t.relname = 'plans'
      and c.conname = 'plans_mobile_check_state_shape'
  ) then
    alter table caring_contacts.plans
      add constraint plans_mobile_check_state_shape
      check (mobile_check_state in ('notChecked', 'awaitingConfirmation', 'confirmed', 'notReceived'));
  end if;
end;
$$;

comment on column caring_contacts.plans.mobile_check_state is
  'Whether the mobile number was checked with a one-off test text: notChecked, awaitingConfirmation, confirmed or notReceived. No patient content; reset to notChecked when the number changes; kept by markRetentionCleared.';
comment on column caring_contacts.plans.mobile_check_sent_at is
  'When the latest test text was handed to the carrier; null if none was sent. No patient content.';
comment on column caring_contacts.plans.mobile_check_resolved_at is
  'When a staff member recorded whether the latest test text arrived; null while unanswered. No patient content.';

commit;
