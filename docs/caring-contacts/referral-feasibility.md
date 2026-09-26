# Caring Contacts: Hospital Referral Interface Feasibility & Hazard H-44 Mitigation

**Status:** Technical & Clinical Governance Reference  
**Hazard Addressed:** H-44 (Hospital referral feed feasibility is unconfirmed and is the largest programme risk)  
**Related Hazards:** H-C01 (A caring contact is delivered after the recipient has died), H-00, H-04, H-05  
**Code References:** `src/lib/caring-contacts/referral/adapter.ts`, `src/lib/caring-contacts/referral/synthetic-hospital-adapter.ts`, `src/app/caring-contacts/intake/page.tsx`

---

## 1. Executive Summary & Clinical Hazard Statement

The Caring Contacts programme provides structured, post-discharge non-demanding text messages for individuals following an acute psychiatric presentation or hospital discharge. Every schedule, contact date, and safety stop depends on timely and accurate knowledge of two hospital events:

1. **Discharge Initiation:** Establishing the 12-month caring contacts schedule based on the true hospital discharge date and validated patient contact details.
2. **Inpatient Readmission or Death (Hazard H-C01):** Immediate suppression and cancellation of pending contacts if a patient is readmitted or has died. Delivering an automated message to a deceased patient's family is a catastrophic clinical failure that causes immense distress.

### Hazard H-44 Analysis

Prior to this implementation, the system assumed that automated electronic medical record (EMR) feeds would stream seamlessly from Western Australia public hospitals into the database. In reality, WA Health enterprise integrations involve significant procurement, data governance, and architectural hurdles across multiple Health Service Providers (HSPs).

**Failure Mode:** If the project assumes an automated feed that cannot be provisioned or is delayed by months, the service either cannot launch or suffers unexpected outages.  
**Mitigation Strategy:**

1. **Decoupled Adapter Layer:** `HospitalReferralAdapter` (`src/lib/caring-contacts/referral/adapter.ts`) defines an abstract, provider-neutral boundary.
2. **Synthetic WA Health Feed:** `SyntheticHospitalReferralAdapter` (`src/lib/caring-contacts/referral/synthetic-hospital-adapter.ts`) simulates payloads from all major WA health facilities for local development and automated CI.
3. **Verified Manual Intake Fallback:** A dedicated clinical interface at `/caring-contacts/intake` allows care coordinators to manually transcribe and verify hospital referrals when electronic feeds are unavailable or partitioned.

---

## 2. Key Stakeholders Across WA Health

To transition from synthetic feeds to live enterprise integration, engagement with the following organizational entities is required:

### Health Support Services (HSS)

- **Integration & Interoperability Services (IIS):** Owns the central enterprise interface engines (e.g. Intersystems HealthShare, Orion Rhapsody) that broker HL7 v2 and FHIR messages across WA Health.
- **Enterprise Architecture & Security:** Approves network topology, GovNext-ICT connectivity, data sovereignty compliance, and encryption standards.
- **Application Services (WebPAS / EMR Teams):** Manages patient administration systems (WebPAS), electronic medical record systems, and psychiatric information systems (e.g., PSOLIS).

### Health Service Providers (HSPs)

- **East Metropolitan Health Service (EMHS):** Royal Perth Hospital (RPH), Bentley Health Service.
- **South Metropolitan Health Service (SMHS):** Fiona Stanley Hospital (FSH), Fremantle Hospital, Rockingham General Hospital.
- **North Metropolitan Health Service (NMHS):** Sir Charles Gairdner Hospital (SCGH), Graylands Hospital, King Edward Memorial Hospital.
- **WA Country Health Service (WACHS):** Regional hospitals across the Kimberley, Pilbara, Midwest, Goldfields, Wheatbelt, South West, and Great Southern regions.
- **Child and Adolescent Health Service (CAHS):** Perth Children’s Hospital (PCH) and Child and Adolescent Mental Health Services (CAMHS).

### Clinical & Governance Leadership

- **Chief Clinical Information Officers (CCIOs) & Informatics Leads:** Lead clinical workflow alignment for electronic referrals.
- **Mental Health Clinical Directors:** Authorize pilot participation and agree on clinical handover protocols.
- **Office of the Chief Psychiatrist (OCP):** Regulatory oversight for mental health services in Western Australia.
- **Caldicott Guardians & Health Privacy Officers:** Govern patient consent, secondary data use, and information disclosure boundaries under the WA Health Data Breach and Privacy policies.

---

## 3. Integration Architectures

Four distinct architectural pathways have been identified, evaluated, and mitigated within the codebase:

```
+-------------------------------------------------------------------------------+
|                             WA Health Infrastructure                          |
|  [WebPAS / Meditech / BOSSnet] ---> [HSS Central Interface Engine (Rhapsody)]  |
+-------------------------------------------------------------------------------+
                                          |
                   +----------------------+----------------------+
                   | (Option 1: HL7 v2)   | (Option 2: FHIR R4)  | (Option 3: API)
                   v                      v                      v
            [ADT^A03 MLLP/VPN]     [FHIR Event Sub]      [Enterprise Gateway]
                   |                      |                      |
                   +----------------------+----------------------+
                                          |
                                          v
                      +---------------------------------------+
                      |       HospitalReferralAdapter         |
                      |  (SyntheticHospitalReferralAdapter)   |
                      +---------------------------------------+
                                          ^
                                          | (Option 4: Fallback)
                                          |
                      +---------------------------------------+
                      |         Manual Intake Screen          |
                      |       (/caring-contacts/intake)       |
                      +---------------------------------------+
```

### Architecture 1: HL7 v2.x Message Broker Feed (Primary Enterprise Integration)

- **Mechanism:** HSS interface engine emits standard HL7 v2.x messages over secure VPN via MLLP (Minimal Lower Layer Protocol) wrapped in TLS, or pushed via HTTPS webhook.
- **Key Event Types:**
  - `ADT^A03`: Patient Discharge (triggers caring contacts schedule creation).
  - `ADT^A08`: Patient Information Update (updates mobile number or demographic details).
  - `ADT^A01` / `ADT^A02`: Inpatient Admission / Transfer (detects unplanned readmission, immediately pausing pending contacts).
  - `ADT^A03` with Discharge Disposition `20` (Expired): Inpatient death notification (triggers irreversible cancellation per Hazard H-C01).
- **Pros:** Proven, standard protocol universally supported by WebPAS and HSS.
- **Cons:** Requires bilateral networking (GovNext-ICT VPN), complex message parsing, and extensive commissioning lead time.

### Architecture 2: HL7 FHIR R4 / AU Core Event Subscription (Modern API)

- **Mechanism:** Event-driven RESTful architecture where Caring Contacts subscribes to FHIR `Encounter` resources with status `finished` (`$discharge`), coupled with `Patient` and `Flag` resources.
- **Standards:** Complies with HL7 Australia AU Core and AU Base standards.
- **Pros:** Expressive data model, native JSON encoding, standardized representation of safety alerts and clinical summaries.
- **Cons:** Dependent on WA Health's internal roadmap for enterprise FHIR gateway deployment.

### Architecture 3: Secure REST API / Webhook via HSS API Gateway

- **Mechanism:** HSS pushes validated JSON discharge notifications directly to an authenticated Caring Contacts API endpoint protected by mTLS and OAuth2 bearer tokens.
- **Payload Shape:** Structured JSON envelope matching `PatientReferral` specifications in `src/lib/caring-contacts/referral/adapter.ts`.
- **Pros:** High developer ergonomics, lightweight integration, simple observability.
- **Cons:** Requires custom API gateway configuration within HSS.

### Architecture 4: Verified Manual Clinical Intake Fallback (The Operational Safeguard)

- **Mechanism:** Web interface located at `/caring-contacts/intake`. Care coordinators manually input patient details from discharge summaries or referral forms.
- **Validation:** Synchronous execution through `SyntheticHospitalReferralAdapter` validating MRN, Australian mobile format (`04xx xxx xxx` or `+61 4xx xxx xxx`), discharge timestamp, and facility metadata.
- **Role:** Guarantees that Caring Contacts can launch immediately in clinical trials or maintain 100% operational continuity during electronic feed outages without depending on external IT timelines.

---

## 4. The 12 Clinical Informatics Questions for WA Health

When meeting with WA Health HSS and clinical informatics directors, the following 12 questions must be answered:

### 1. System of Record

> _Which clinical system is authoritative for psychiatric inpatient discharge records at each facility (e.g. WebPAS, Meditech, BOSSnet, or PSOLIS), and does a single HSS interface engine aggregate all sites?_

### 2. Event Latency & Delivery Timeliness

> _What is the maximum end-to-end latency between a patient being physically discharged on the ward and the electronic discharge notification being transmitted to downstream integration consumers?_

### 3. Inpatient Death Notification Reliability (Hazard H-C01)

> _Does WebPAS/EMR reliably emit a distinct discharge event (`ADT^A03` with disposition code Expired/Deceased) immediately upon clinical recording of a patient death, and is there an automated feed for deaths that occur shortly after discharge?_

### 4. Readmission & Emergency Department Presentation Detection

> _How quickly are emergency department presentations or unplanned psychiatric readmissions recorded, and can an event stream be established to automatically pause caring contacts while a patient is admitted?_

### 5. Telephone Number Validation & Classification

> _How are patient telephone numbers classified in the Patient Master Index (PMI), how are mobile numbers programmatically distinguished from fixed landlines, and what is the recorded accuracy of these numbers at discharge?_

### 6. Consent & Opt-In Governance

> _Where in the clinical discharge workflow is patient consent for supportive text messages obtained and documented, and will an electronic consent flag be transmitted with the referral?_

### 7. Facility & Ward Scoping

> _Which acute mental health inpatient units (e.g., RPH Ward 4A, FSH Ward 5A, SCGH Mental Health Unit, Bunbury Acute Psychiatric Unit) are authorized for the initial cohort, and how are transfers between wards handled?_

### 8. Identifier Conventions & Master Patient Index

> _What is the primary patient identifier used across messages (Unit Medical Record Number - UMRN vs facility-specific MRN vs Individual Healthcare Identifier - IHI), and how are duplicate or merged records handled?_

### 9. Clinical Summary & Diagnostic Metadata Filtering

> _What clinical summary or diagnostic coding (ICD-10-AM) will accompany the referral, and what sensitive psychiatric details must be redacted to adhere to the WA Health Privacy Policy and Health Services Act 2016?_

### 10. Technical Transport & Security Boundary

> _What security transport standards does HSS mandate for external health software (e.g., GovNext-ICT IPsec VPN, AWS Direct Connect, mutual TLS, OAuth2/OIDC), and what audit logging is required by the HSS Security Operations Centre?_

### 11. Resilience, Backpressure & Replay Capabilities

> _In the event of an interface downtime, network partition, or scheduled maintenance window, can the HSS integration engine buffer and replay queued messages in strict chronological order?_

### 12. Governance Approval Pathway & Lead Time

> _What is the formal governance pathway (e.g., HSS Project Delivery Framework, Health Research Ethics Committee - HREC, Data Custodian review) required to certify this interface, and what is the typical approval lead time?_

---

## 5. Ongoing Risk & Audit Status

| Component                                                   | Status                 | Verification Gate                                  |
| ----------------------------------------------------------- | ---------------------- | -------------------------------------------------- |
| Domain Adapter Interface (`adapter.ts`)                     | Implemented            | `tests/caring-contacts-referral-ingestion.test.ts` |
| Synthetic WA Health Feeds (`synthetic-hospital-adapter.ts`) | Implemented            | `tests/caring-contacts-referral-ingestion.test.ts` |
| Manual Intake Fallback (`/caring-contacts/intake`)          | Implemented            | Route reachability & DOM validation                |
| Enterprise WA Health Feed                                   | Pending HSS Onboarding | Gated by WA Health stakeholder consultation        |

Hazard H-44 is mitigated from **Unmitigated / Blocking** to **Controlled — Feasibility & Fallback Intake Available**. The software build is insulated and fully operational.
