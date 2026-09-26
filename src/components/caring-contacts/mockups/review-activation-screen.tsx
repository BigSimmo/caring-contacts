"use client";

import { ArrowLeft, CheckCircle2, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { announce } from "@/components/ui/live-announcer";

import {
  ROWAN_SELECTED_SENDING_PREFERENCE,
  syntheticPatients,
  syntheticPathways,
  syntheticPlannedContacts,
  syntheticTemplates,
} from "./fixtures";
import { DefinitionRow, OperationalStatus } from "./prototype-primitives";
import {
  CompactMessagePreview,
  EXACT_MESSAGE_GSM7,
  EXACT_PATIENT_VISIBLE_MESSAGE,
  MessagePreview,
  PATIENT_VISIBLE_NO_REPLY_NOTICE,
  canActivateGovernedVersions,
  getActivationBlockers,
} from "./personalisation-screen";
import type { SyntheticPathway, SyntheticTemplate } from "./types";

const dateFormatter = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Australia/Perth",
});

type ReviewActivationScreenProps = {
  onBack: () => void;
  onOverview: () => void;
  pathway?: SyntheticPathway;
  template?: SyntheticTemplate;
};

export function ReviewActivationScreen({
  onBack,
  onOverview,
  pathway = syntheticPathways[0],
  template = syntheticTemplates[0],
}: ReviewActivationScreenProps) {
  const patient = syntheticPatients[1];
  const [activationNotice, setActivationNotice] = useState("");
  const selectedGovernance = { pathway, template };
  const activationBlockers = getActivationBlockers(selectedGovernance);
  const activationAllowed = canActivateGovernedVersions(selectedGovernance);
  const activationGateDescriptionId = activationAllowed ? undefined : "review-activation-unavailable";

  function reviewPrototypeActivation() {
    if (!activationAllowed) {
      announce(
        `Activation unavailable. ${activationBlockers.map(({ reason, remedy }) => `${reason} Remedy: ${remedy}`).join(" ")}`,
        { eventId: "caring-contact:activation-unavailable" },
      );
      return;
    }
    const outcome = "Prototype activation reviewed. No plan was created and no message was sent.";
    setActivationNotice(outcome);
    announce(outcome, { eventId: "caring-contact:activation-review" });
  }

  return (
    <section className="min-w-0 pb-24 md:pb-0" data-testid="caring-contact-screen-review-activation">
      <div className="mb-[var(--gap-block)] rounded-[var(--radius-lg)] border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] p-[var(--pad-card)] forced-colors:border-[CanvasText]">
        <p className="text-xs font-semibold uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--clinical-accent)]">
          Patient identity remains in flow
        </p>
        <p className="mt-1 break-words font-semibold">
          {patient.fullName} · {patient.id} · 3 Nov 1987
        </p>
      </div>

      <div className="grid min-w-0 gap-[var(--gap-block)] lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.72fr)]">
        <div className="min-w-0 rounded-[var(--radius-xl)] border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-[var(--pad-panel)]">
          <div className="flex flex-wrap items-start justify-between gap-[var(--gap-stack)]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--clinical-accent)]">
                Stage 4 of 4
              </p>
              <h2
                className="mt-2 text-2xl font-semibold tracking-tight"
                data-caring-contact-stage-heading
                tabIndex={-1}
              >
                Review and activation
              </h2>
              <p className="mt-2 max-w-[var(--measure)] text-sm text-[color:var(--text-muted)]">
                Review every source, owner, version, word and AWST time before the final prototype action.
              </p>
            </div>
            <OperationalStatus tone={activationAllowed ? "success" : "warning"}>
              {activationAllowed ? "Ready for prototype review" : "Action blocked"}
            </OperationalStatus>
          </div>

          <div className="mt-[var(--gap-block)] space-y-[var(--gap-block)]">
            <section aria-labelledby="review-identity-heading">
              <h3 id="review-identity-heading" className="font-semibold">
                Identity and source
              </h3>
              <dl className="mt-[var(--gap-stack)] text-sm">
                <DefinitionRow term="Patient">
                  {patient.fullName} · {patient.id} · 3 Nov 1987
                </DefinitionRow>
                <DefinitionRow term="Imported mobile">
                  <span className="break-words">
                    {patient.mobile} · Imported from {patient.mobileSource}
                  </span>
                </DefinitionRow>
                <DefinitionRow term="Suitability">Patient-controlled and suitable for discreet SMS</DefinitionRow>
                <DefinitionRow term="Agreement">
                  <span className="font-medium text-[color:var(--text)]">Agreement confirmed: Yes</span> · imported
                  evidence
                </DefinitionRow>
              </dl>
            </section>

            <section aria-labelledby="review-ownership-heading">
              <h3 id="review-ownership-heading" className="font-semibold">
                Ownership and versions
              </h3>
              <dl className="mt-[var(--gap-stack)] text-sm">
                <DefinitionRow term="Ownership">
                  <span className="font-medium text-[color:var(--text)]">Owning team: Example Aftercare Team</span>
                </DefinitionRow>
                <DefinitionRow term="Coordination">
                  <span className="font-medium text-[color:var(--text)]">Coordinator: Alex Example</span>
                </DefinitionRow>
                <DefinitionRow term="Pathway">
                  {pathway.name} · {pathway.version} · {pathway.approvalState} · {pathway.lifecycle}
                </DefinitionRow>
                <DefinitionRow term="Message">
                  {template.name} · {template.version} · {template.variant} · {template.approvalState} ·{" "}
                  {template.lifecycle}
                </DefinitionRow>
                <DefinitionRow term="Approval evidence">
                  <span className="font-medium text-[color:var(--text)]">
                    {activationAllowed ? "Two-person approval complete" : "Selected version unavailable for activation"}
                  </span>
                  <span className="mt-1 block">
                    Pathway record: {pathway.approvalEvidence?.clinicalProgrammeLead ?? "Approval evidence unavailable"}
                  </span>
                  <span className="mt-1 block">
                    Pathway record:{" "}
                    {pathway.approvalEvidence?.livedExperienceContentReviewer ?? "Approval evidence unavailable"}
                  </span>
                  <span className="mt-1 block">
                    Message record:{" "}
                    {template.approvalEvidence?.clinicalProgrammeLead ?? "Approval evidence unavailable"}
                  </span>
                  <span className="mt-1 block">
                    Message record:{" "}
                    {template.approvalEvidence?.livedExperienceContentReviewer ?? "Approval evidence unavailable"}
                  </span>
                </DefinitionRow>
              </dl>
            </section>

            {!activationAllowed ? (
              <section
                id="review-activation-unavailable"
                className="rounded-[var(--radius-lg)] border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] p-[var(--pad-card)] text-sm"
                aria-labelledby="review-activation-unavailable-heading"
              >
                <h3 id="review-activation-unavailable-heading" className="font-semibold text-[color:var(--warning)]">
                  Activation unavailable
                </h3>
                <ul className="mt-2 space-y-2">
                  {activationBlockers.map(({ reason, remedy }) => (
                    <li key={`${reason}-${remedy}`}>
                      <p className="font-medium">{reason}</p>
                      <p className="text-[color:var(--text-muted)]">
                        <span className="font-medium text-[color:var(--text)]">Remedy:</span> {remedy}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section aria-labelledby="review-message-heading">
              <h3 id="review-message-heading" className="font-semibold">
                Exact message and schedule
              </h3>
              <blockquote className="mt-[var(--gap-stack)] break-words rounded-[var(--radius-lg)] bg-[color:var(--surface-inset)] p-[var(--pad-card)] text-sm leading-6">
                {EXACT_PATIENT_VISIBLE_MESSAGE}
              </blockquote>
              <p className="mt-2 text-sm font-medium">
                {EXACT_MESSAGE_GSM7.septets} septets · {EXACT_MESSAGE_GSM7.segments} of 2 SMS segments · GSM-7 encoding
              </p>
              <p className="mt-1 text-sm text-[color:var(--text-muted)]">
                10 contacts use the selected {ROWAN_SELECTED_SENDING_PREFERENCE.windowLabel} preference across the exact
                dated schedule.
              </p>
              <ol
                aria-label="Activation exact schedule"
                className="mt-[var(--gap-stack)] divide-y divide-[color:var(--border)] rounded-[var(--radius-lg)] border border-[color:var(--border)] px-[var(--pad-card)]"
              >
                {syntheticPlannedContacts.map((contact) => (
                  <li
                    key={contact.id}
                    className="grid min-w-0 gap-1 py-[var(--gap-stack)] sm:grid-cols-[minmax(5rem,0.55fr)_minmax(7rem,0.8fr)_minmax(10rem,1fr)_auto] sm:items-baseline sm:gap-[var(--gap-inline)]"
                  >
                    <span className="font-semibold">{contact.cadenceLabel}</span>
                    <time dateTime={contact.scheduledAt} className="text-sm tabular-nums">
                      {dateFormatter.format(new Date(contact.scheduledAt))}
                    </time>
                    <span className="text-sm text-[color:var(--text-muted)]">{contact.windowLabel}</span>
                    <OperationalStatus tone={contact.transportState === "Delivered" ? "success" : "neutral"}>
                      {contact.transportState}
                    </OperationalStatus>
                  </li>
                ))}
              </ol>
            </section>

            <section
              className="rounded-[var(--radius-lg)] border border-[color:var(--border)] p-[var(--pad-card)]"
              aria-labelledby="review-boundary-heading"
            >
              <h3 id="review-boundary-heading" className="flex items-start gap-2 font-semibold">
                <ShieldCheck
                  aria-hidden="true"
                  className="mt-0.5 size-icon-md shrink-0 text-[color:var(--clinical-accent)]"
                />
                One-way boundary
              </h3>
              <p className="mt-2 text-sm text-[color:var(--text-muted)]">
                {PATIENT_VISIBLE_NO_REPLY_NOTICE}. Caring contacts do not monitor safety, wellbeing or response and
                supplement usual care.
              </p>
            </section>
          </div>

          <div className="mt-[var(--gap-block)] flex flex-col-reverse gap-[var(--gap-inline)] sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <Button variant="secondary" icon={ArrowLeft} onClick={onBack}>
              Back to personalisation
            </Button>
            <div className="flex flex-col gap-[var(--gap-inline)] sm:flex-row">
              <CompactMessagePreview stageName="Review and activation" />
              <Button variant="secondary" onClick={onOverview}>
                View patient overview
              </Button>
              <Button
                variant="primary"
                icon={CheckCircle2}
                aria-disabled={!activationAllowed}
                aria-describedby={activationGateDescriptionId}
                title={activationAllowed ? undefined : "Activation unavailable — resolve the named remedies above"}
                onClick={reviewPrototypeActivation}
              >
                Activate 10-contact plan
              </Button>
            </div>
          </div>
          {activationNotice ? (
            <p className="mt-[var(--gap-stack)] text-sm font-medium text-[color:var(--clinical-accent)]">
              {activationNotice}
            </p>
          ) : null}
        </div>

        <aside aria-label="Wide exact message preview" className="hidden min-w-0 lg:block">
          <MessagePreview />
        </aside>
      </div>
    </section>
  );
}
