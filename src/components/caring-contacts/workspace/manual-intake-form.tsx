"use client";

import { AlertCircle, CheckCircle2, FilePlus, RefreshCw, Send } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { floatingControl, primaryControl } from "@/components/ui-primitives";
import { CARING_CONTACTS_ROUTES, newPlanRoute } from "@/lib/caring-contacts-routes";
import {
  INTAKE_COHORTS,
  SyntheticHospitalReferralAdapter,
  WA_HEALTH_FACILITIES,
  type IntakeCohort,
  type PatientReferral,
  type WAHealthFacility,
} from "@/lib/caring-contacts/referral";

import { workspacePanelPadded } from "./surfaces";

export function formatAwstDateTimeLocal(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Perth",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`;
}

/**
 * `datetime-local` holds an Australia/Perth wall-clock value with no offset.
 * Append the fixed AWST (+08:00) offset before converting so coordinators outside
 * Perth do not shift the discharge instant by their browser timezone.
 */
export function awstDateTimeLocalToIso(datetimeLocal: string): string {
  const trimmed = datetimeLocal.trim();
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (!match) {
    throw new Error("Discharge date must be a datetime-local Australia/Perth wall-clock value.");
  }
  const seconds = match[2] ?? "00";
  const instant = new Date(`${match[1]}:${seconds}+08:00`);
  if (Number.isNaN(instant.getTime())) {
    throw new Error("Discharge date could not be interpreted as an Australia/Perth instant.");
  }
  return instant.toISOString();
}

/** Confirmation rendering always uses Australia/Perth, matching the intake wall clock. */
export function formatAwstConfirmation(isoOrDate: string | Date): string {
  const instant = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  return instant.toLocaleString("en-AU", {
    timeZone: "Australia/Perth",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  });
}

/**
 * One control style for every field. 16px text below `sm` so a phone browser does not zoom the
 * page when a field takes focus, and the production tap floor so every field is a real target.
 */
const fieldClass =
  "block min-h-tap w-full rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-base text-[color:var(--text)] placeholder:text-[color:var(--text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--focus)] sm:text-sm";

/** Display words for the shared cohort list. Typed by it, so a cohort added there must be named here. */
const COHORT_LABELS: Readonly<Record<IntakeCohort, string>> = {
  adult_crisis: "Adult Post-Discharge Crisis",
  youth_mh: "Youth Mental Health",
  perinatal: "Perinatal Care",
  general: "General Support",
};

const labelClass = "block text-sm font-semibold text-[color:var(--text)]";

function Required() {
  return (
    <>
      <span aria-hidden="true" className="text-[color:var(--danger-text)]">
        {" "}
        *
      </span>
      <span className="sr-only"> (required)</span>
    </>
  );
}

export function ManualIntakeForm() {
  const [adapter] = useState(() => new SyntheticHospitalReferralAdapter());

  // Form State
  const [facility, setFacility] = useState<WAHealthFacility>("Royal Perth Hospital");
  const [patientIdentifier, setPatientIdentifier] = useState("");
  const [givenName, setGivenName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [admittingWard, setAdmittingWard] = useState("");
  const [dischargeDate, setDischargeDate] = useState(() => formatAwstDateTimeLocal(new Date()));
  const [cohort, setCohort] = useState("adult_crisis");
  const [clinicalSummary, setClinicalSummary] = useState("");
  const [safetyAlerts, setSafetyAlerts] = useState("");

  // Submission State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [verifiedReferral, setVerifiedReferral] = useState<PatientReferral | null>(null);
  const [stagedReferralId, setStagedReferralId] = useState<string | null>(null);
  // Retain across retries of the same form attempt so a lost response cannot mint a second referral.
  const intakeIdempotencyKeyRef = useRef<string | null>(null);
  // Where focus goes when the form is replaced by its outcome, so a keyboard or screen-reader user
  // is not left on a submit button that no longer exists.
  const outcomeHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const errorRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (verifiedReferral) outcomeHeadingRef.current?.focus();
  }, [verifiedReferral]);
  useEffect(() => {
    if (errorMessage) errorRef.current?.scrollIntoView({ block: "nearest" });
  }, [errorMessage]);

  const handlePrefill = (targetFacility: WAHealthFacility) => {
    const payload = adapter.createSyntheticPayload(targetFacility);
    const pat = payload.patient as Record<string, string>;
    const ep = payload.episode as Record<string, unknown>;

    setFacility(targetFacility);
    setPatientIdentifier(pat.mrn ?? "");
    setGivenName(pat.givenName ?? "");
    setFamilyName(pat.familyName ?? "");
    setMobileNumber(pat.mobile ?? "");
    setAdmittingWard(typeof ep.admittingWard === "string" ? ep.admittingWard : "Acute Unit");
    setDischargeDate(formatAwstDateTimeLocal(new Date()));
    setCohort(typeof ep.cohort === "string" ? ep.cohort : "adult_crisis");
    setClinicalSummary(typeof ep.clinicalSummary === "string" ? ep.clinicalSummary : "");
    setSafetyAlerts(Array.isArray(ep.safetyAlerts) ? ep.safetyAlerts.join(", ") : "");
    setErrorMessage(null);
    setVerifiedReferral(null);
    intakeIdempotencyKeyRef.current = null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);
    setStagedReferralId(null);

    const alertsList = safetyAlerts
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    let dischargeIso: string;
    try {
      dischargeIso = awstDateTimeLocalToIso(dischargeDate);
    } catch (error) {
      setIsSubmitting(false);
      setErrorMessage(error instanceof Error ? error.message : "Invalid discharge date/time.");
      return;
    }

    const payload = {
      patientIdentifier,
      givenName,
      familyName,
      mobileNumber,
      dischargeDate: dischargeIso,
      hospitalFacility: facility,
      cohort,
      admittingWard,
      clinicalSummary,
      safetyAlerts: alertsList,
    };

    // Client-side validation first so field errors stay local; persistence always goes through
    // the audited intake API before success is reported.
    const validated = await adapter.ingestReferral(payload);
    if (!validated.ok) {
      setIsSubmitting(false);
      setErrorMessage(validated.error);
      return;
    }

    try {
      const idempotencyKey = intakeIdempotencyKeyRef.current ?? `intake-${crypto.randomUUID()}`;
      intakeIdempotencyKeyRef.current = idempotencyKey;
      const response = await fetch("/api/caring-contacts/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, idempotencyKey }),
      });
      const body = (await response.json().catch(() => null)) as {
        value?: { referralId?: string; referral?: PatientReferral };
        refusal?: string;
      } | null;
      if (!response.ok || !body?.value?.referralId) {
        setErrorMessage(body?.refusal ?? "Referral could not be persisted through the audited intake API.");
        setIsSubmitting(false);
        return;
      }
      intakeIdempotencyKeyRef.current = null;
      setVerifiedReferral(body.value.referral ?? validated.value);
      setStagedReferralId(body.value.referralId);
    } catch {
      setErrorMessage("Referral could not be persisted through the audited intake API.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setVerifiedReferral(null);
    setStagedReferralId(null);
    intakeIdempotencyKeyRef.current = null;
    setErrorMessage(null);
    setPatientIdentifier("");
    setGivenName("");
    setFamilyName("");
    setMobileNumber("");
    setAdmittingWard("");
    setClinicalSummary("");
    setSafetyAlerts("");
  };

  return (
    <div className="space-y-6">
      {/* Hazard H-44 Context & Notice Banner */}
      <section
        aria-label="Intake fallback context"
        className={`${workspacePanelPadded} border-l-4 border-l-[color:var(--focus)]`}
      >
        <div className="flex items-start gap-3">
          <FilePlus aria-hidden="true" className="size-5 shrink-0 text-[color:var(--focus)] mt-0.5" />
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-[color:var(--text-heading)]">
              Manual referral intake (fallback for hazard H-44)
            </h2>
            <p className="text-xs leading-5 text-[color:var(--text-muted)]">
              This verified clinical intake interface allows coordinators to manually enter hospital discharge referrals
              when structured WA Health enterprise feeds (HL7 v2 or FHIR) are unavailable or during service onboarding.
              Referrals entered here are parsed, validated, and persisted through the audited intake API (identifiers
              plus clinical summary and safety alerts) so the plan wizard can read the same stored payload.
            </p>
          </div>
        </div>

        {/* Quick Prefill Actions */}
        <div className="mt-4 pt-3 border-t border-[color:var(--border)] flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-[color:var(--text-muted)]">Fill with an invented sample from:</span>
          {WA_HEALTH_FACILITIES.map((fac) => (
            <button key={fac} type="button" onClick={() => handlePrefill(fac)} className={`${floatingControl} text-xs`}>
              <RefreshCw aria-hidden="true" className="size-3" />
              <span>{fac}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Error Notice */}
      {errorMessage && (
        <div
          ref={errorRef}
          role="alert"
          className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-[color:var(--danger)] bg-[color:var(--danger-soft)] p-4 text-xs text-[color:var(--danger-text)]"
        >
          <AlertCircle aria-hidden="true" className="size-5 shrink-0 text-[color:var(--danger)]" />
          <div className="space-y-1">
            <p className="font-semibold">The referral was not saved</p>
            <p>{errorMessage}</p>
          </div>
        </div>
      )}

      {/* Success State Confirmation Card */}
      {verifiedReferral ? (
        <section aria-label="Verified referral summary" className={`${workspacePanelPadded} space-y-4`}>
          <div className="flex items-start gap-3">
            <CheckCircle2 aria-hidden="true" className="size-5 shrink-0 text-[color:var(--success)] mt-0.5" />
            <div className="space-y-1">
              <h2
                ref={outcomeHeadingRef}
                tabIndex={-1}
                className="text-sm font-semibold text-[color:var(--text-heading)] focus:outline-none"
              >
                Referral saved and accepted
              </h2>
              <p className="text-xs text-[color:var(--text-muted)]">
                The referral identifiers and clinical intake payload (including safety alerts) were validated and
                written through the audited intake API. The plan wizard will load those stored fields for care plan
                initiation.
              </p>
            </div>
          </div>

          <div className="rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-4 text-xs space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <span className="font-semibold text-[color:var(--text-muted)]">Patient:</span>{" "}
                <span className="font-medium text-[color:var(--text)]">
                  {verifiedReferral.givenName} {verifiedReferral.familyName}
                </span>
              </div>
              <div>
                <span className="font-semibold text-[color:var(--text-muted)]">Identifier (MRN):</span>{" "}
                <span className="font-medium text-[color:var(--text)]">{verifiedReferral.patientIdentifier}</span>
              </div>
              <div>
                <span className="font-semibold text-[color:var(--text-muted)]">Facility:</span>{" "}
                <span className="font-medium text-[color:var(--text)]">{verifiedReferral.hospitalFacility}</span>
              </div>
              <div>
                <span className="font-semibold text-[color:var(--text-muted)]">Admitting ward:</span>{" "}
                <span className="font-medium text-[color:var(--text)]">{verifiedReferral.admittingWard}</span>
              </div>
              <div>
                <span className="font-semibold text-[color:var(--text-muted)]">Mobile number:</span>{" "}
                <span className="font-medium text-[color:var(--text)]">{verifiedReferral.mobileNumber}</span>
              </div>
              <div>
                <span className="font-semibold text-[color:var(--text-muted)]">Discharged:</span>{" "}
                <span className="font-medium text-[color:var(--text)]">
                  {formatAwstConfirmation(verifiedReferral.dischargeDate)}
                </span>
              </div>
            </div>

            {verifiedReferral.clinicalSummary && (
              <div className="pt-2 border-t border-[color:var(--border)]">
                <span className="font-semibold text-[color:var(--text-muted)]">Summary:</span>
                <p className="mt-1 text-[color:var(--text)]">{verifiedReferral.clinicalSummary}</p>
              </div>
            )}

            {verifiedReferral.safetyAlerts.length > 0 && (
              <div className="pt-2 border-t border-[color:var(--border)]">
                <span className="font-semibold text-[color:var(--text-muted)]">Safety and support alerts:</span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {verifiedReferral.safetyAlerts.map((alert, idx) => (
                    <span
                      key={idx}
                      className="inline-block rounded-[var(--radius-sm)] bg-[color:var(--surface)] border border-[color:var(--border)] px-2 py-0.5 text-2xs font-medium text-[color:var(--text)]"
                    >
                      {alert}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link
              href={stagedReferralId ? newPlanRoute(stagedReferralId) : CARING_CONTACTS_ROUTES.newPlan}
              data-internal-link="true"
              className={primaryControl}
              aria-disabled={!stagedReferralId || undefined}
            >
              <span>Start a plan for this referral</span>
            </Link>
            <Link href={CARING_CONTACTS_ROUTES.patients} data-internal-link="true" className={floatingControl}>
              <span>View patients</span>
            </Link>
            <button type="button" onClick={handleReset} className={floatingControl}>
              <span>Enter another referral</span>
            </button>
          </div>
        </section>
      ) : (
        /* Manual Intake Fallback Form */
        <form onSubmit={handleSubmit} className={`${workspacePanelPadded} space-y-5`}>
          <div className="border-b border-[color:var(--border)] pb-3">
            <h2 className="text-sm font-semibold text-[color:var(--text-heading)]">Referral details</h2>
            <p className="text-xs text-[color:var(--text-muted)]">
              Enter the patient discharge information extracted from the hospital discharge summary.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Hospital Facility */}
            <div className="space-y-1">
              <label htmlFor="hospital-facility" className={labelClass}>
                Hospital
                <Required />
              </label>
              <select
                id="hospital-facility"
                value={facility}
                onChange={(e) => setFacility(e.target.value as WAHealthFacility)}
                required
                className={fieldClass}
              >
                {WA_HEALTH_FACILITIES.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>

            {/* Admitting Ward */}
            <div className="space-y-1">
              <label htmlFor="admitting-ward" className={labelClass}>
                Admitting ward or unit
              </label>
              <input
                id="admitting-ward"
                type="text"
                value={admittingWard}
                onChange={(e) => setAdmittingWard(e.target.value)}
                placeholder="e.g. Ward 4A Acute Mental Health"
                className={fieldClass}
              />
            </div>

            {/* Patient MRN */}
            <div className="space-y-1">
              <label htmlFor="patient-identifier" className={labelClass}>
                Patient identifier (MRN or UMRN)
                <Required />
              </label>
              <input
                id="patient-identifier"
                type="text"
                autoComplete="off"
                value={patientIdentifier}
                onChange={(e) => setPatientIdentifier(e.target.value)}
                placeholder="e.g. RPH-582914 or UMRN"
                required
                className={fieldClass}
              />
            </div>

            {/* Discharge Date & Time */}
            <div className="space-y-1">
              <label htmlFor="discharge-date" className={labelClass}>
                Discharge date and time (AWST)
                <Required />
              </label>
              <input
                id="discharge-date"
                type="datetime-local"
                value={dischargeDate}
                onChange={(e) => setDischargeDate(e.target.value)}
                required
                className={fieldClass}
              />
            </div>

            {/* Given Name */}
            <div className="space-y-1">
              <label htmlFor="given-name" className={labelClass}>
                Given name
                <Required />
              </label>
              <input
                id="given-name"
                type="text"
                autoComplete="off"
                value={givenName}
                onChange={(e) => setGivenName(e.target.value)}
                placeholder="e.g. Mira"
                required
                className={fieldClass}
              />
            </div>

            {/* Family Name */}
            <div className="space-y-1">
              <label htmlFor="family-name" className={labelClass}>
                Family name
                <Required />
              </label>
              <input
                id="family-name"
                type="text"
                autoComplete="off"
                value={familyName}
                onChange={(e) => setFamilyName(e.target.value)}
                placeholder="e.g. Chen"
                required
                className={fieldClass}
              />
            </div>

            {/* Mobile Number */}
            <div className="space-y-1">
              <label htmlFor="mobile-number" className={labelClass}>
                Mobile number
                <Required />
              </label>
              <input
                id="mobile-number"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                aria-describedby="mobile-number-hint"
                value={mobileNumber}
                onChange={(e) => setMobileNumber(e.target.value)}
                placeholder="e.g. +61 491 570 006 or 0491 570 006"
                required
                className={fieldClass}
              />
              <p id="mobile-number-hint" className="text-xs text-[color:var(--text-muted)]">
                Must be an Australian mobile number. Landline numbers cannot receive SMS contacts.
              </p>
            </div>

            {/* Cohort */}
            <div className="space-y-1">
              <label htmlFor="cohort" className={labelClass}>
                Clinical cohort
              </label>
              <select id="cohort" value={cohort} onChange={(e) => setCohort(e.target.value)} className={fieldClass}>
                {INTAKE_COHORTS.map((id) => (
                  <option key={id} value={id}>
                    {COHORT_LABELS[id]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Clinical Summary */}
          <div className="space-y-1">
            <label htmlFor="clinical-summary" className={labelClass}>
              Clinical summary or handover notes
            </label>
            <textarea
              id="clinical-summary"
              rows={3}
              value={clinicalSummary}
              onChange={(e) => setClinicalSummary(e.target.value)}
              placeholder="Key clinical context, discharge reason, and follow-up arrangements..."
              className={fieldClass}
            />
          </div>

          {/* Safety Alerts */}
          <div className="space-y-1">
            <label htmlFor="safety-alerts" className={labelClass}>
              Support notes and safety alerts (separate with commas)
            </label>
            <input
              id="safety-alerts"
              type="text"
              value={safetyAlerts}
              onChange={(e) => setSafetyAlerts(e.target.value)}
              placeholder="e.g. Acute distress, Social isolation, Aftercare support required"
              className={fieldClass}
            />
          </div>

          {/* Submit Actions */}
          <div className="flex flex-wrap-reverse items-center justify-between gap-3 border-t border-[color:var(--border)] pt-3">
            <Link href={CARING_CONTACTS_ROUTES.today} data-internal-link="true" className={floatingControl}>
              <span>Cancel</span>
            </Link>

            <button type="submit" disabled={isSubmitting} className={primaryControl}>
              <Send aria-hidden="true" className="size-4 shrink-0" />
              <span>{isSubmitting ? "Saving…" : "Save referral"}</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
