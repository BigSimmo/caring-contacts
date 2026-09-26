-- caring-contacts/supabase/migrations/0021_caring_contacts_inbound_replies.sql
--
-- Incoming text messages (owner request, 2026-09-26): a patient's reply becomes a "reply to check"
-- for a person, an opt-out pauses the plan, and every sender gets one automatic safety reply per
-- day at most. The rules are in src/lib/caring-contacts/inbound-replies.ts.
--
-- THIS DIRECTORY IS NOT THE REPOSITORY'S `supabase/migrations/`. Nothing here may ever be placed
-- there; see 0005 for why, and the two tests that fail if it is.
--
-- TWO TABLES, AND THEY ARE DIFFERENT KINDS OF THING.
--
--   * `inbound_replies` is PATIENT DATA: the words a patient texted back, filed on their plan. It
--     follows every rule a patient table in this schema follows -- team-scoped row-level security,
--     enabled and FORCED; a composite same-team foreign key onto the plan (0011's reason: a bare
--     `plan_id` key would accept a row claiming one team against another team's plan, because
--     foreign-key checks bypass row-level security); and the transactional audit guard, so no row
--     is written or changed without the audit event the store writes beside it. Which ROLES may
--     read it is the application's rule (`READ_ACTIONS.inboundReply`, the episode's own
--     capability), exactly as it is for the plan's patient columns.
--     `body` is cleared to '' by `markRetentionCleared` with the rest of the patient detail
--     (`CLEARED_PATIENT_FREE_TEXT.inboundReplyText`); the row itself stays.
--
--   * `inbound_auto_reply_limits` is NOT patient data and belongs to no team. It is the loop guard
--     for the automatic reply, and an unknown number has no team. It holds a keyed HMAC of the
--     sending number (`inboundSenderKey`, which names nobody without the webhook's secret) and the
--     instant it was last answered, and rows older than the window are deleted on every claim. So
--     it takes the service-wide policy `service_state` takes (0003): visible to any session that
--     names a team, and to no unscoped or anonymous session. It carries NO audit guard, because no
--     audit event exists for it -- like `recordAccess`, a claim changes nothing about any person.
--
-- Transactional: one `begin`/`commit`. Replay-safe: `if not exists`, policies dropped and recreated.

begin;

create table if not exists caring_contacts.inbound_replies (
  id text primary key,
  team_id text not null references caring_contacts.teams (id),
  plan_id text not null,
  kind text not null,
  -- The patient's own words. Never blank on write (the domain refuses a blank reply); '' only ever
  -- means a retention clearance removed them. The length must equal INBOUND_REPLY_TEXT_MAX_LENGTH.
  body text not null,
  received_at timestamptz not null,
  plan_paused boolean not null default false,
  followed_up_at timestamptz,
  followed_up_by text,
  version integer not null default 1,
  constraint inbound_replies_team_plan_fk
    foreign key (team_id, plan_id) references caring_contacts.plans (team_id, id) on delete cascade,
  constraint inbound_replies_id_shape check (id ~ '^reply-[A-Za-z0-9_-]{8,64}$'),
  constraint inbound_replies_kind_is_known check (kind in ('reply', 'optOutRequest')),
  constraint inbound_replies_body_length check (char_length(body) <= 2000),
  -- Followed up means both who and when, or neither.
  constraint inbound_replies_follow_up_pair check ((followed_up_at is null) = (followed_up_by is null)),
  -- Only an opt-out ever pauses a plan.
  constraint inbound_replies_only_opt_out_pauses check (not plan_paused or kind = 'optOutRequest'),
  constraint inbound_replies_version_positive check (version >= 1)
);

create index if not exists inbound_replies_plan_id_idx on caring_contacts.inbound_replies (plan_id);
create index if not exists inbound_replies_open_idx
  on caring_contacts.inbound_replies (team_id, received_at)
  where followed_up_at is null;

comment on column caring_contacts.inbound_replies.body is
  'The words a patient texted back. Patient content: readable only by roles that may read the patient''s record, cleared by markRetentionCleared, never selected by the team-wide list read.';

create table if not exists caring_contacts.inbound_auto_reply_limits (
  sender_key text primary key,
  last_replied_at timestamptz not null,
  -- An unpadded base64url HMAC-SHA256: 43 characters. A phone number cannot satisfy this shape.
  constraint inbound_auto_reply_limits_key_shape check (sender_key ~ '^[A-Za-z0-9_-]{43}$')
);

-- ---------------------------------------------------------------------------
-- Privileges. 0002's grants are a snapshot of the tables that existed when it ran; re-granted here
-- for the same reason 0003 re-grants -- and `caring_contacts_anon` keeps SELECT with no policy, so
-- the anonymous denial is row-level security's doing rather than a missing GRANT.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on all tables in schema caring_contacts to caring_contacts_app;
grant select on all tables in schema caring_contacts to caring_contacts_anon;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table caring_contacts.inbound_replies enable row level security;
alter table caring_contacts.inbound_replies force row level security;
drop policy if exists inbound_replies_team_scope on caring_contacts.inbound_replies;
create policy inbound_replies_team_scope on caring_contacts.inbound_replies
  for all to caring_contacts_app
  using (team_id = caring_contacts.current_team_id())
  with check (team_id = caring_contacts.current_team_id());

alter table caring_contacts.inbound_auto_reply_limits enable row level security;
alter table caring_contacts.inbound_auto_reply_limits force row level security;
drop policy if exists inbound_auto_reply_limits_service_wide on caring_contacts.inbound_auto_reply_limits;
create policy inbound_auto_reply_limits_service_wide on caring_contacts.inbound_auto_reply_limits
  for all to caring_contacts_app
  using (caring_contacts.current_team_id() is not null)
  with check (caring_contacts.current_team_id() is not null);

-- ---------------------------------------------------------------------------
-- The transactional audit guard, on the patient table only (see the note at the top).
-- ---------------------------------------------------------------------------
select caring_contacts.attach_audit_guard(array['inbound_replies']);

commit;
