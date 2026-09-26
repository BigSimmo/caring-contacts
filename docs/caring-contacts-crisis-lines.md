# Caring Contacts — Crisis Lines and Re-verification Cadence

> **Canonical crisis line reference and re-verification cadence across all Care Plan and Caring Contacts surfaces.**
> Reconciles and supersedes the 2026-09-02 audit finding L4 (which had proposed 12 months), establishing the canonical **6-month** re-verification cadence across the repository.

**Status:** Canonical reference, established 2026-09-07.

**Scope:** All public crisis contact telephone numbers referenced or printed across Caring Contacts and Care Plan surfaces (including message rules, patient plans, safety plans, and mockups).

---

## Crisis Lines Reference

The following real public crisis lines are utilised across Caring Contacts and Care Plan surfaces. The table records the repository's intended public-service contact values, not synthetic patient contacts. Numbers and availability have not been independently re-verified for this consolidation; confirm them against the official sources and record the verification dates before treating this table as current clinical evidence.

| Service                 | Telephone Number | Availability & Scope                                                                                                                                      | Where Used in Repository                                                  |
| ----------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Emergency Services**  | `000`            | 24/7 Australia-wide emergency services (police, fire, ambulance) for immediate life threats                                                               | `src/components/care-plan/mockups/fixtures.ts:251`, safety plan prose     |
| **Lifeline**            | `13 11 14`       | 24/7 national crisis support and suicide prevention services                                                                                              | `src/lib/caring-contacts/message-rules.ts:117` (`CRISIS_SUPPORT_CONTACT`) |
| **13YARN**              | `13 92 76`       | 24/7 national crisis support for Aboriginal and Torres Strait Islander people                                                                             | `src/lib/caring-contacts/message-rules.ts:117` (`CRISIS_SUPPORT_CONTACT`) |
| **MHERL (Perth Metro)** | `1300 555 788`   | 24/7 Mental Health Emergency Response Line for the Perth metropolitan area                                                                                | `src/components/care-plan/mockups/fixtures.ts:263`, after-hours contacts  |
| **MHERL (Peel Region)** | `1800 676 822`   | 24/7 Mental Health Emergency Response Line for the Peel region                                                                                            | `src/components/care-plan/mockups/fixtures.ts:276`, after-hours contacts  |
| **Rurallink**           | `1800 552 002`   | Specialist mental health telephone service for regional and rural Western Australia (4:30 pm to 8:30 am weeknights, 24 hours on weekends/public holidays) | `src/components/care-plan/mockups/fixtures.ts:289`, after-hours contacts  |

---

## Canonical 6-Month Re-verification Cadence

1. **Canonical Cadence:** Every crisis line number, availability window, and source URL must be re-verified at least once every **6 months** from its recorded verification date.
2. **Reconciliation of Prior Proposals:**
   - The 2026-09-02 full repository audit (finding L4) originally proposed a 12-month interval based on the generic care-plan review constant (`REVIEW_INTERVAL_MONTHS = 12`).
   - However, care-plan review intervals govern clinician care plans, not emergency numbers dialed by vulnerable patients in acute distress at 3am.
   - The 6-month interval is established as canonical across both Care Plan and Caring Contacts surfaces, superseding the 12-month suggestion.
3. **Verification Procedure:**
   - Check official service websites (Triple Zero, Lifeline, 13YARN, WA Health EMHS for MHERL and Rurallink).
   - Validate operating hours, geographic scope, and dialing formats.
   - Update verification logs and associated contract assertions (e.g. in `tests/care-plan-domain.test.ts` and `docs/care-plan/crisis-lines-verification.md`).
