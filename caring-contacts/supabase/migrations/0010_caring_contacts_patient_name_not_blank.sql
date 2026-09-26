-- caring-contacts/supabase/migrations/0010_caring_contacts_patient_name_not_blank.sql
--
-- Enforce that patient_name in caring_contacts.plans is non-blank on creation/storage (#V6CDEV).
--
-- Empty string '' remains reserved for the policy-cleared sentinel written by markRetentionCleared
-- (CLEARED_PATIENT_DETAIL.patientName). Whitespace-only values are still rejected.
--
-- Replay-safe and transactional.

begin;

-- Drop then re-add so a prior draft of this migration that rejected '' is corrected on replay.
alter table caring_contacts.plans drop constraint if exists check_patient_name_not_blank;

alter table caring_contacts.plans
  add constraint check_patient_name_not_blank
  check (patient_name = '' or length(trim(patient_name)) > 0);

comment on constraint check_patient_name_not_blank on caring_contacts.plans is
  'Ensures patient_name cannot be whitespace-only. Empty string remains reserved as the post-retention policy-cleared sentinel (CLEARED_PATIENT_DETAIL.patientName).';

commit;
