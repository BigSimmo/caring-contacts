-- caring-contacts/supabase/migrations/0011_caring_contacts_composite_team_foreign_keys.sql
--
-- Replace the four bare foreign keys onto plans/contacts with composite same-team keys (#4VKAA1).
-- Enforces multi-tenant isolation per Rulings 25 & 27 so a row written by one team cannot
-- reference another team's plan or contact.
--
-- ON DELETE CASCADE matches the original bare FKs from 0001 (contacts/dispatches/retention_state/
-- cultural_identity_reports). Drop+recreate so a prior draft that used RESTRICT is corrected.
--
-- Replay-safe and transactional.

begin;

-- Ensure referencable composite unique targets
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint c
    join pg_catalog.pg_class t on t.oid = c.conrelid
    join pg_catalog.pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'caring_contacts' and t.relname = 'plans' and c.conname = 'plans_team_id_id_key'
  ) then
    alter table caring_contacts.plans add constraint plans_team_id_id_key unique (team_id, id);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint c
    join pg_catalog.pg_class t on t.oid = c.conrelid
    join pg_catalog.pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'caring_contacts' and t.relname = 'contacts' and c.conname = 'contacts_team_id_id_key'
  ) then
    alter table caring_contacts.contacts add constraint contacts_team_id_id_key unique (team_id, id);
  end if;
end $$;

-- 1. caring_contacts.contacts: replace bare plan_id fk with composite (team_id, plan_id)
alter table caring_contacts.contacts drop constraint if exists contacts_plan_id_fkey;
alter table caring_contacts.contacts drop constraint if exists contacts_team_plan_fk;
alter table caring_contacts.contacts
  add constraint contacts_team_plan_fk
  foreign key (team_id, plan_id)
  references caring_contacts.plans (team_id, id)
  on delete cascade;

-- 2. caring_contacts.contact_dispatches: replace bare contact_id fk with composite (team_id, contact_id)
alter table caring_contacts.contact_dispatches drop constraint if exists contact_dispatches_contact_id_fkey;
alter table caring_contacts.contact_dispatches drop constraint if exists contact_dispatches_team_contact_fk;
alter table caring_contacts.contact_dispatches
  add constraint contact_dispatches_team_contact_fk
  foreign key (team_id, contact_id)
  references caring_contacts.contacts (team_id, id)
  on delete cascade;

-- 3. caring_contacts.retention_state: replace bare plan_id fk with composite (team_id, plan_id)
alter table caring_contacts.retention_state drop constraint if exists retention_state_plan_id_fkey;
alter table caring_contacts.retention_state drop constraint if exists retention_state_team_plan_fk;
alter table caring_contacts.retention_state
  add constraint retention_state_team_plan_fk
  foreign key (team_id, plan_id)
  references caring_contacts.plans (team_id, id)
  on delete cascade;

-- 4. caring_contacts.cultural_identity_reports: replace bare plan_id fk with composite (team_id, plan_id)
alter table caring_contacts.cultural_identity_reports drop constraint if exists cultural_identity_reports_plan_id_fkey;
alter table caring_contacts.cultural_identity_reports drop constraint if exists cultural_identity_reports_team_plan_fk;
alter table caring_contacts.cultural_identity_reports
  add constraint cultural_identity_reports_team_plan_fk
  foreign key (team_id, plan_id)
  references caring_contacts.plans (team_id, id)
  on delete cascade;

commit;
