# Caring Contacts: where things stand and what is next

Updated 26 September 2026 (v5 of this copy). Each item is marked **Done in this copy**,
**Needs you** (only the owner can do it) or **Still to build**. **[most impact]** marks the
items that matter most before any real patient.

## 1. Needs you (steps only the owner can take)

1. **[most impact] Clinical, privacy and lived-experience sign-off.** Before any real patient:
   1. Have the clinical lead and a lived-experience representative approve the final message
      wording for every message type, including the first and closing messages (none exist yet),
      with real, verified support-line numbers. The current wording uses invented numbers on
      purpose, and the sender refuses to send invented numbers to a real phone.
   2. Complete a privacy impact assessment and review the hazard log
      (`docs/caring-contacts/hazard-log.md`).
   3. Record the approvals as a pathway version in the app (Templates screen).
2. **[most impact] Staff sign-in set-up.** In your organisation's identity provider (for example
   WA Health single sign-on), follow "Staff sign-in" in `deploy/australia/README.md`: register the
   app, set its callback address, create one group per role and per team, and copy the issuer,
   client ID and secret into the settings.
3. **[most impact] Text-message provider.** Follow "Text messages" in `deploy/australia/README.md`:
   1. The connection was checked on 26 September 2026 against Telstra's own published toolkits
      (Telstra's website pages could not be read by the tools used). Five differences were fixed,
      including turning on delivery reports. Open the Messaging API v3 endpoints page on
      dev.telstra.com in a browser and confirm the points listed at the top of
      `src/lib/caring-contacts/transport/telstra.ts`, especially whether Telstra keeps the
      signed part of the delivery-report address. Delivery reports are a paid Telstra feature.
   2. Open a Telstra Messaging API account, turn on delivery reports, and get written
      confirmation that messages are stored and handled in Australia.
   3. Get a sending number or approved sender name, and the client ID and secret.
   4. Test with a staff phone first (`npm run sender -- --test-to 04xx xxx xxx`).
4. **Australian hosting account.** Open an AWS (Sydney) or Azure (Australia East) account, then
   follow `deploy/australia/README.md` sections 4 or 5. Store every secret in the cloud's secrets
   vault, not in files.
5. **Database.** Create a dedicated Australian-hosted Postgres, run the migrations, turn on daily
   backups kept in Australia, and do one test restore.
6. **Monitoring.** Set up uptime checks on `/api/caring-contacts/ready`, and alerts for failed or
   piling-up messages. Error reporting (for example Sentry with an Australian endpoint and patient
   details scrubbed) was deliberately left out of this copy.
7. **GitHub (optional).** Put this folder in its own private repository; the automatic checks in
   `.github/workflows/ci.yml` then run on every change.

## 2. Built and checked

| Item                                                                                  | Status            |
| ------------------------------------------------------------------------------------- | ----------------- |
| Staff sign-in for live mode (OpenID Connect), with sign-out                           | Done in this copy |
| Text-message sending: simulated by default; Telstra connection off until configured   | Done in this copy |
| Background sender (`npm run sender` or a scheduler calling a protected address)       | Done in this copy |
| Delivery-report address `/api/caring-contacts/delivery/webhook`                       | Done in this copy |
| Server refuses to start when real sending is half set up, or switched on in demo mode | Done in this copy |
| Messages use each patient's own name (the "Hi Rowan" template fault is fixed)         | Done in this copy |
| Cancel a never-started plan                                                           | Done in this copy |
| A coordinator can claim an unclaimed plan                                             | Done in this copy |
| Optional reason recorded when a plan is withdrawn                                     | Done in this copy |
| Duplicate referrals for the same patient refused                                      | Done in this copy |
| New plan list shows name, discharge date and hospital; hides patients with a plan     | Done in this copy |
| Dashboards agree on "not delivered", approved send window and "plans on record"       | Done in this copy |
| Tab titles per screen; full desktop menu; previous/next week on Schedule              | Done in this copy |
| Confirmation dialogs show the patient and plan facts being confirmed                  | Done in this copy |
| Closed production workspace returns a real "not found" (404)                          | Done in this copy |
| Australian container built and smoke-tested locally                                   | Done in this copy |
| Postgres tables, security rules, audit trail; tested on local Postgres 16             | Done in this copy |

## 3. Decisions taken for you (change them if you disagree)

- **Keeping patient data:** identifying details can be cleared only 7 years after a plan ends,
  never earlier.
- **Restarting the service after a safety stop:** each approval must come from a different named
  person who actually holds that approval role.
- **Moving a message:** it cannot be moved to a time that has already passed.
- **Plans on a pathway missing wording:** refused only when real sending is switched on (the demo
  pathway has no first or closing wording, so refusing in demo mode would block every plan).
- **A failed or unclear send is never retried automatically;** it is marked for a person to
  check, because a second caring message is the worse failure.

## 4. Still to build

- A cancelled draft's referral is not offered again on the New plan list; a fresh referral is
  needed. Re-offering the old one is a small change if you want it.
- The Team screen's "Take on unclaimed work" list names no patient (that screen never shows
  patient details); after claiming, the coordinator opens the plan from their own caseload.
- The demo has no privacy-owner seat holder configured, so a safety stop raised in the demo cannot
  be restarted there; name the seat holders in configuration for a real service.

- The sender reads records under a "sender" identity that borrows a coordinator's read
  permission; a dedicated read-only system permission would be cleaner.
- Screens still say "no carrier is connected"; reword once real sending is live.
- The "Preview the message" dialog opened from Templates offers only "Back to personalisation"
  (its wording is fixed by the interaction-matrix document).
- The design prototypes still say "Pause future contacts" where the app says "Hold".
- Staff roles change only at next sign-in (up to 8 hours); there is no way to end a session early.
