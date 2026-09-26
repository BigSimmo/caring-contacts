-- caring-contacts/supabase/migrations/0020_caring_contacts_sender_heartbeat_staff_alerts.sql
--
-- Two small operational tables for staff alerts and the sender health check.
--
-- THIS DIRECTORY IS NOT THE REPOSITORY'S `supabase/migrations/`. Nothing here may ever be placed
-- there; see 0005 for why, and the two tests that fail if it is.
--
-- WHY THEY EXIST. The background sender runs on an external timer. When that timer stops, nothing
-- in the app used to notice: the readiness probe checked the database and nothing else, and no
-- staff alert was ever sent. Two facts must now survive across app instances and restarts:
--
--   * `sender_heartbeats` -- ONE row, the instant the sender last finished a run (including a run
--     that found the service stopped or nothing due). Any app instance's readiness probe reads it
--     and reports the sender stalled when it is too old. It is a singleton, like `service_state`:
--     the sender is one service-wide process, not one per team.
--   * `staff_alert_deliveries` -- the instant each (scope, alert class) alert was last delivered,
--     so the same alert is not re-sent on every five-minute run or every health-probe poll while a
--     condition persists. The claim is one atomic upsert (see the Postgres store), so two app
--     instances cannot both deliver the same alert inside one cooldown.
--
-- WHAT THEY HOLD. No patient content of any kind: a fixed singleton key, an alert class from a
-- closed set, a scope (a team id, or a fixed service-wide token) and instants. Checked below.
--
-- ROW-LEVEL SECURITY: SERVICE-WIDE, deliberately. Both tables describe the service rather than a
-- team -- the sender is one process for every team, and a stalled sender or a carrier throttling
-- the service must be visible to whichever team's session asks. They follow 0003's exception for
-- `service_state` exactly: enabled and forced, readable and writable by any session that has named
-- a team, and invisible to an unscoped session (deny-by-default is untouched: `current_team_id()
-- is not null` is false without a team). `caring_contacts_anon` keeps SELECT with no policy, so its
-- denial is row-level security's doing, as 0003 arranges for every table.
--
-- NOT AUDITED, deliberately. The transactional audit guard is NOT attached. These rows record what
-- software did (a run finished, an alert went out), not an action a person took on anybody's
-- record. The heartbeat is written every five minutes; attaching the guard would add close to 300
-- audit events a day that say nothing about access to patient data and would bury the ones that
-- do. The store only lets a SYSTEM actor write either table.
--
-- Transactional: one `begin`/`commit`. Replay-safe: `if not exists`, constraints added only when
-- absent, policies dropped before they are created.

begin;

create table if not exists caring_contacts.sender_heartbeats (
  id text primary key,
  last_run_at timestamptz not null
);

create table if not exists caring_contacts.staff_alert_deliveries (
  scope text not null,
  alert_class text not null,
  last_sent_at timestamptz not null,
  primary key (scope, alert_class)
);

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint c
    join pg_catalog.pg_class t on t.oid = c.conrelid
    join pg_catalog.pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'caring_contacts' and t.relname = 'sender_heartbeats'
      and c.conname = 'sender_heartbeats_is_singleton'
  ) then
    alter table caring_contacts.sender_heartbeats
      add constraint sender_heartbeats_is_singleton check (id = 'sender');
  end if;

  -- Must equal ALERT_CLASSES in src/lib/caring-contacts/notification-preferences.ts. A class added
  -- there without a migration here is refused by name rather than stored as free text.
  if not exists (
    select 1 from pg_catalog.pg_constraint c
    join pg_catalog.pg_class t on t.oid = c.conrelid
    join pg_catalog.pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'caring_contacts' and t.relname = 'staff_alert_deliveries'
      and c.conname = 'staff_alert_deliveries_class_is_known'
  ) then
    alter table caring_contacts.staff_alert_deliveries
      add constraint staff_alert_deliveries_class_is_known check (
        alert_class in (
          'unclaimedWorkEscalation', 'permanentDeliveryFailure', 'serviceSafetyStop',
          'exceptionBacklog', 'pathwayRetired', 'senderStalled', 'carrierRateLimited'
        )
      );
  end if;

  -- A scope is an identifier-shaped token (a team id, or `service`, or `service-stop:<instant>`),
  -- never prose. Bounded and restricted to identifier characters so free text cannot land here.
  if not exists (
    select 1 from pg_catalog.pg_constraint c
    join pg_catalog.pg_class t on t.oid = c.conrelid
    join pg_catalog.pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'caring_contacts' and t.relname = 'staff_alert_deliveries'
      and c.conname = 'staff_alert_deliveries_scope_shape'
  ) then
    alter table caring_contacts.staff_alert_deliveries
      add constraint staff_alert_deliveries_scope_shape check (scope ~ '^[A-Za-z0-9:._-]{1,128}$');
  end if;
end;
$$;

grant select, insert, update, delete on caring_contacts.sender_heartbeats to caring_contacts_app;
grant select, insert, update, delete on caring_contacts.staff_alert_deliveries to caring_contacts_app;
grant select on caring_contacts.sender_heartbeats to caring_contacts_anon;
grant select on caring_contacts.staff_alert_deliveries to caring_contacts_anon;

do $$
declare
  service_wide_table text;
begin
  foreach service_wide_table in array array['sender_heartbeats', 'staff_alert_deliveries']
  loop
    execute format('alter table caring_contacts.%I enable row level security', service_wide_table);
    execute format('alter table caring_contacts.%I force row level security', service_wide_table);
    execute format(
      'drop policy if exists %I on caring_contacts.%I',
      service_wide_table || '_service_wide',
      service_wide_table
    );
    execute format(
      'create policy %I on caring_contacts.%I
         for all to caring_contacts_app
         using (caring_contacts.current_team_id() is not null)
         with check (caring_contacts.current_team_id() is not null)',
      service_wide_table || '_service_wide',
      service_wide_table
    );
  end loop;
end
$$;

comment on table caring_contacts.sender_heartbeats is
  'Singleton: when the background sender last finished a run. Read by the readiness probe. No patient content; not audited (software telemetry).';
comment on table caring_contacts.staff_alert_deliveries is
  'When each staff alert (scope, class) was last delivered, for the re-send cooldown. No patient content; not audited (software telemetry).';

commit;
