-- caring-contacts/supabase/migrations/0009_caring_contacts_audit_guard_governance_tables.sql
--
-- Bring `pathway_versions` and `retention_state` under the transactional audit guard.
--
-- THIS DIRECTORY IS NOT THE REPOSITORY'S `supabase/migrations/`. That directory replays against the
-- live Clinical KB project and merging to `main` applies it there automatically, within seconds;
-- nothing here may ever be placed in it, and both tests/caring-contacts-domain-isolation.test.ts and
-- tests/caring-contacts-migrations.test.ts fail if a caring-contact migration appears there.
--
-- WHY THIS EXISTS. 0001 states the schema's headline promise as "EVERY CHANGE CARRIES ITS AUDIT
-- EVENT IN THE SAME TRANSACTION, enforced by a DEFERRABLE CONSTRAINT TRIGGER that fires at commit".
-- That promise is per table: `attach_audit_guard` takes a list, and a table missing from every list
-- carries no `require_audit` trigger at all. Fourteen tables were listed across 0001, 0003 and 0006.
-- Two clinically meaningful ones never were:
--
--   1. `pathway_versions` -- whose `state` (draft / inReview / approved / retired), `published_at`
--      and `retired_at` decide which message content a patient actually receives. A direct SQL
--      change to which version is approved, published or retired committed with no audit row, so
--      the access trail could not show that it happened or who did it.
--   2. `retention_state` -- the de-identification record. A hand-inserted or hand-edited
--      `cleared_at` is a claim that a patient's identifying detail was removed; that claim could be
--      written, or withdrawn, with nothing in `audit_events` to answer for it.
--
-- The promise now holds for both. The gap was synthetic-data-only, but it is the kind that is only
-- ever noticed after the change nobody can account for.
--
-- WHY THIS IS SAFE FOR EVERY EXISTING WRITER, checked rather than assumed:
--
--   * Both tables are written only through the repository's `runWrite`, which sets
--     `caring_contacts.audit_token` and writes the audit event in the same transaction --
--     `authorPathwayVersion` and `transitionPathwayVersion` for the first,
--     `markRetentionCleared` for the second (src/lib/caring-contacts/db/postgres-repository.ts).
--   * The Postgres fixtures seed `pathway_versions` inside their own audited transaction, beside
--     the `referrals` and `plans` rows that already carry the guard
--     (tests/helpers/caring-contacts-postgres.ts).
--   * No migration in this directory inserts into either table, so a replay writes no unaudited
--     row through the guard it just attached.
--   * The guard is an AFTER ... FOR EACH ROW constraint trigger. TRUNCATE fires no row trigger, so
--     the between-test truncation is unaffected.
--
-- Replay-safe: `attach_audit_guard` drops the trigger by name before creating it, so applying this
-- file twice is a no-op. Transactional: one `begin`/`commit`, and no CREATE INDEX CONCURRENTLY.

begin;

select caring_contacts.attach_audit_guard(array['pathway_versions', 'retention_state']);

-- Fail fast rather than record a migration whose statement did not achieve its effect. The guard
-- is only worth having if it is actually attached, and a silent no-op here would leave the promise
-- above false while looking applied.
do $$
declare
  unguarded text[];
begin
  select array_agg(expected.table_name order by expected.table_name)
    into unguarded
  from (values ('pathway_versions'), ('retention_state')) as expected(table_name)
  where not exists (
    select 1
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'caring_contacts'
      and c.relname = expected.table_name
      and t.tgname = 'require_audit'
      and not t.tgisinternal
  );

  if unguarded is not null then
    raise exception
      'caring-contacts audit guard not attached to: %', array_to_string(unguarded, ', ');
  end if;
end;
$$;

comment on table caring_contacts.pathway_versions is
  'The versioned message content a patient receives, with its governance state. Under the require_audit constraint trigger since 0009: approving, publishing or retiring a version cannot commit without its audit event in the same transaction.';

comment on table caring_contacts.retention_state is
  'When an episode ended and when its identifying detail was cleared. Under the require_audit constraint trigger since 0009: a clearance record cannot be written, changed or removed without its audit event in the same transaction.';

commit;
