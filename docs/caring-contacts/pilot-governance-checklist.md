# Caring Contacts — Pilot Clinical Governance Checklist & Sign-Off Protocol

**Status:** Codified Pilot Governance Framework, 2026-09-12.  
**Scope:** Hard pre-pilot clinical governance controls gating real-patient operation (#1S81R8).  
**Enforcement:** Runtime and build-time fail-closed validation (`src/lib/caring-contacts/pilot-governance.ts`).

---

## Executive Summary

Before any non-synthetic or real-patient pilot of Caring Contacts can be initiated in Western Australia, three primary unmitigated hazards must be formally closed:

1. **H-00**: Clinical Safety Officer (CSO) named appointment, risk boundary, and sign-off.
2. **H-04**: Lived-experience review of all patient-visible message copy, tone, and autonomy.
3. **H-05**: Aboriginal cultural safety consultation and protocol review with WA Aboriginal Health Practitioners.

This document establishes the mandatory verification criteria, sign-off workflow, and attestation schema required before production deployment can be authorized.

---

## 1. Hazard H-00: Named Clinical Safety Officer (CSO) Sign-off Protocol

### Clinical Risk Boundary & Authority

- **Appointee Requirement:** A named Consultant Psychiatrist (AHPRA-registered, FRANZCP) or Senior Clinical Director holding operational clinical responsibility for the participating mental health service.
- **Decision Authority:**
  - Emergency Service Stop: The CSO holds unilateral authority to trigger a service-wide safety stop (`/caring-contacts/service-stop`) halting all SMS dispatches during system anomalies or clinical incidents.
  - Pathway Approval: Dual-sign-off requirement for all new or modified caring contact pathways (`PathwayVersion`), verifying sending cadences, trigger windows, and clinical suitability.
  - Incident Escalation: Mandatory notification to the CSO for any delivery failure exception older than 4 hours, acute hospital re-admission notification, or report of adverse clinical events.
  - Attestation Gate: Any toggle disabling demo/training mode or configuring live SMS credentials (`CARING_CONTACTS_MODE=live`) requires a cryptographically referenced attestation signed by the CSO.

---

## 2. Hazard H-04: Lived Experience Review & Facilitation Protocol

### Integration with Review Pack

All patient-facing communications must be evaluated using the facilitation framework codified in [`docs/caring-contacts/message-review-pack.md`](message-review-pack.md).

### Evaluation Dimensions

1. **Language & Stigma:**
   - Person-first language only.
   - Absolute prohibition of clinical or CRM terminology ("campaign", "retention", "high-risk", "relapse prediction", "adherence").
   - Clear distinction between caring touchpoints and clinical assessments.
2. **Autonomy & Agency:**
   - Respecting the patient's right to pause or withdraw without confrontation or guilt.
   - Messages must communicate care without creating obligation ("No need to reply, just thinking of you").
3. **Tone & Warmth:**
   - Genuine, respectful, and non-presumptive tone that does not pretend an automated system is a human therapist while maintaining compassionate connection.
4. **Crisis Support Clarity:**
   - Direct, legible crisis numbers (Lifeline 13 11 14, Suicide Call Back Service 1300 659 467) presented without overwhelming clinical disclaimers.

---

## 3. Hazard H-05: Western Australian Aboriginal Cultural Safety Framework

### Consultation Framework

In Western Australia, suicide-aftercare services operate in diverse urban, regional, and remote settings where Aboriginal and Torres Strait Islander peoples represent significant portions of consumers. Clinical safety requires structured consultation with Aboriginal Health Practitioners (AHPs), Aboriginal Medical Services (e.g. Derbarl Yerrigan, Bega Garnbirringu, KAMSC), and local Elders.

### Core Cultural Safety Requirements

1. **Local Language & Phrasing:**
   - Plain English, non-institutional phrasing adapted to regional terminology.
   - Avoidance of jargon, acronyms, or cold administrative language.
2. **Kinship & Community Circles:**
   - Recognition that safety planning frequently involves extended family and community networks.
   - Optional nominating of trusted kinship contacts for notification upon mutual agreement.
3. **Sorry Business & Bereavement Protocols:**
   - Immediate automatic suspension of caring contacts upon notice of family bereavement or community sorry business.
   - Culturally informed liaison before any reconnection attempt.
4. **Privacy & Community Notification:**
   - Strict adherence to small-cell suppression rules codified in `src/lib/caring-contacts/reach-reporting-governance.ts` to prevent community-level re-identification.

---

## 4. Attestation Verification Schema

The application tier enforces an attestation file check (`assertPilotGovernanceReady`) in `src/lib/caring-contacts/pilot-governance.ts`. When moving outside of synthetic demo mode, the following JSON document must be present and verified:

```json
{
  "attestationVersion": "1.0.0",
  "clinicalSafetyOfficer": {
    "name": "Dr. Eleanor Vance, FRANZCP",
    "ahpraRegistrationNumber": "MED0001928374",
    "role": "Clinical Safety Officer & Director of Mental Health",
    "organisation": "WA Health Mental Health Division"
  },
  "hazardMitigations": {
    "h00SafetyOfficerApproved": true,
    "h04LivedExperienceReviewApproved": true,
    "h05AboriginalCulturalSafetyApproved": true
  },
  "pilotScope": {
    "environment": "australia-southeast-pilot",
    "authorizedCatchments": ["Perth Metro", "Fiona Stanley Hospital Catchment"],
    "validUntilIso": "2027-09-12T00:00:00Z"
  },
  "signedDateIso": "2026-09-12T00:00:00Z",
  "digitalSignatureRef": "SIG-CSO-20260912-9843A1B2"
}
```

Any deployment failing this check fails closed at boot and refuses to dispatch live communications.
