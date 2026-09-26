-- caring-contacts/supabase/migrations/0010_caring_contacts_referral_intake_payload.sql
--
-- Persist the H-44 manual intake clinical payload beside the referral identity row.
--
-- THIS DIRECTORY IS NOT THE REPOSITORY'S `supabase/migrations/`. That directory replays against the
-- live Clinical KB project; nothing here may ever be placed in it.
--
-- WHY. `createReferral` historically stored only `{ referralId, patientId }`. The intake API
-- validated a full hospital payload (MRN, name, mobile, clinicalSummary, safetyAlerts) and the
-- success UI claimed those fields were "persisted" / "staged" while only an adapter echo returned
-- them. For suicide-aftercare fallback that is a clinical silent failure: alerts appear captured
-- when they are discarded after the HTTP response.
--
-- The `Referral` domain type stays identifiers + state only. Clinical content lives in
-- `intake_payload` jsonb, written in the same audited `createReferral` transaction and read back
-- through `getReferralIntakePayload` for the plan wizard.
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS. No CREATE INDEX CONCURRENTLY. Transactional.

begin;

alter table caring_contacts.referrals
  add column if not exists intake_payload jsonb;

comment on column caring_contacts.referrals.intake_payload is
  'Optional H-44 hospital intake clinical payload (name, mobile, clinicalSummary, safetyAlerts). Written only by createReferral when the intake API supplies it; null for identifier-only referrals. Round-tripped by getReferralIntakePayload — never substituted with an adapter echo.';

commit;
