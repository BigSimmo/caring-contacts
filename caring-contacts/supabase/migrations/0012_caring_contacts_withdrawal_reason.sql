-- caring-contacts/supabase/migrations/0012_caring_contacts_withdrawal_reason.sql
--
-- Keep the optional short reason recorded with a withdrawal (owner-approved 2026-09-26).
--
-- THIS DIRECTORY IS NOT THE REPOSITORY'S `supabase/migrations/`. Nothing here may ever be placed
-- there; see 0005 for why, and the two tests that fail if it is.
--
-- WHERE IT LIVES, AND WHY. The value is prose a clinician typed about one patient, so it sits with
-- the other patient-detail columns on `caring_contacts.plans`: released only by `getEpisode` (never
-- selected by a list read), and cleared by `markRetentionCleared` with the rest of the patient
-- detail. It is the same class of value as `first_contact_reason` (0005) and follows that column's
-- shape exactly.
--
--   * NULLABLE, NO DEFAULT, NO BACKFILL. The reason is optional, and a plan withdrawn before this
--     column existed genuinely holds none. A placeholder would be a fabricated sentence on a
--     clinical record.
--   * THE LENGTH CHECK IS A BACKSTOP, NOT THE ENFORCEMENT. `admitWithdrawalReason` in
--     src/lib/caring-contacts/hospital-events.ts refuses an over-long reason by name
--     (`withdrawal-reason-too-long`) and writes null for a blank one. The number below must equal
--     `WITHDRAWAL_REASON_MAX_LENGTH`. Blank is refused here too, for the reason 0005 gives, with the
--     same POSIX-whitespace caveat stated there.
--
-- Row-level security needs nothing: `caring_contacts.plans` already has it enabled and forced, and
-- policies are per row.
--
-- Transactional: one `begin`/`commit`. Replay-safe: `if not exists`, and the constraint is added
-- only when absent.

begin;

alter table caring_contacts.plans add column if not exists withdrawal_reason text;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class t on t.oid = c.conrelid
    join pg_catalog.pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'caring_contacts'
      and t.relname = 'plans'
      and c.conname = 'plans_withdrawal_reason_shape'
  ) then
    alter table caring_contacts.plans
      add constraint plans_withdrawal_reason_shape
      check (
        withdrawal_reason is null
        or (
          withdrawal_reason ~ '[^[:space:]]'
          and char_length(regexp_replace(withdrawal_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g')) <= 200
        )
      );
  end if;
end;
$$;

comment on column caring_contacts.plans.withdrawal_reason is
  'Optional short reason recorded with a withdrawal. Free text about this patient: cleared by markRetentionCleared with the rest of the patient detail; never selected by a list read.';

commit;
