"use client";

import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  FileCheck2,
  IdCard,
  Info,
  MessageSquareText,
  Phone,
  ShieldCheck,
  Sun,
  Sunset,
  UserRoundCheck,
  Users,
} from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { announce } from "@/components/ui/live-announcer";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/components/ui-primitives";

import {
  ROWAN_SELECTED_SENDING_PREFERENCE,
  syntheticPathways,
  syntheticPatients,
  syntheticTeamMembers,
} from "./fixtures";
import {
  AssuranceRow,
  MessagePreviewCard,
  OneWayBoundary,
  PatientIdentityStrip,
  ProductSection,
  ScheduleList,
  SectionHeading,
  StatusChip,
  VerifiedSummary,
  WorkflowStepper,
  productSectionHeadingPad,
  productSurface,
} from "./product-ui";

export type ActivationStage = "agreement" | "pathway" | "personalisation" | "review";

const stageNumber: Record<ActivationStage, 1 | 2 | 3 | 4> = {
  agreement: 1,
  pathway: 2,
  personalisation: 3,
  review: 4,
};

export function ActivationWorkflow({
  stage,
  onStageChange,
  onActivated,
  onOpenOverlay,
}: {
  stage: ActivationStage;
  onStageChange: (stage: ActivationStage) => void;
  onActivated: () => void;
  onOpenOverlay?: (overlayId: string) => void;
}) {
  return (
    <div className="space-y-5">
      <PatientIdentityStrip compact />
      <WorkflowStepper activeStep={stageNumber[stage]} />
      {stage === "agreement" ? (
        <AgreementStage onContinue={() => onStageChange("pathway")} onOpenOverlay={onOpenOverlay} />
      ) : null}
      {stage === "pathway" ? (
        <PathwayStage
          onBack={() => onStageChange("agreement")}
          onContinue={() => onStageChange("personalisation")}
          onOpenOverlay={onOpenOverlay}
        />
      ) : null}
      {stage === "personalisation" ? (
        <PersonalisationStage
          onBack={() => onStageChange("pathway")}
          onContinue={() => onStageChange("review")}
          onOpenOverlay={onOpenOverlay}
        />
      ) : null}
      {stage === "review" ? (
        <ReviewStage
          onBack={() => onStageChange("personalisation")}
          onActivated={onActivated}
          onOpenOverlay={onOpenOverlay}
        />
      ) : null}
    </div>
  );
}

function AgreementStage({
  onContinue,
  onOpenOverlay,
}: {
  onContinue: () => void;
  onOpenOverlay?: (overlayId: string) => void;
}) {
  const patient = syntheticPatients[1];
  const coordinator = syntheticTeamMembers[0];
  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-2" data-testid="caring-contact-screen-patient-agreement">
      <ProductSection labelledBy="agreement-assurance-heading" className="overflow-hidden">
        <SectionHeading
          id="agreement-assurance-heading"
          title="Required assurances"
          description="Confirm imported evidence and explicit ownership before choosing a pathway."
          action={<StatusChip tone="success">All assurances present</StatusChip>}
          className={productSectionHeadingPad}
        />
        <div className="border-t border-[color:var(--border)]">
          <AssuranceRow
            icon={IdCard}
            label="Identity"
            value={`${patient.fullName} · ${patient.id}`}
            source="Imported referral record"
          />
          <AssuranceRow
            icon={Phone}
            label="Mobile suitability"
            value="Patient-controlled and suitable for discreet SMS"
            source={patient.mobileSource}
          />
          <AssuranceRow
            icon={ClipboardCheck}
            label="Agreement"
            value="Agreement confirmed: Yes"
            source="Imported source record—not legal or treatment consent"
          />
          <AssuranceRow
            icon={ShieldCheck}
            label="Ownership"
            value="Example Aftercare Team"
            source="Referral explicitly accepted"
          />
          <AssuranceRow
            icon={UserRoundCheck}
            label="Coordinator"
            value={coordinator.displayName}
            source="Care team directory"
          />
        </div>
      </ProductSection>

      <aside className="space-y-4">
        <div className={cn(productSurface, "overflow-hidden border-[color:var(--clinical-accent-border)]")}>
          <SectionHeading id="pathway-gate-heading" title="Pathway gate" icon={ShieldCheck} compact />
          <div className="space-y-4 border-t border-[color:var(--border)] p-4">
            <VerifiedSummary>
              <p className="font-semibold text-[color:var(--text-heading)]">Ready for pathway selection</p>
              <p className="mt-1">All assurances are present. Continue to pathway selection.</p>
            </VerifiedSummary>
            <ul className="space-y-3 text-sm text-[color:var(--text-muted)]">
              {[
                "Imported referral record",
                "Patient-controlled mobile",
                "Agreement confirmed: Yes",
                "Accepted owning team",
                "Named coordinator",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <CheckCircle2
                    aria-hidden="true"
                    className="mt-0.5 size-icon-sm shrink-0 text-[color:var(--success)] forced-colors:text-[CanvasText]"
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            {onOpenOverlay ? (
              <div className="grid gap-2 border-t border-[color:var(--border)] pt-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <Button variant="secondary" size="sm" onClick={() => onOpenOverlay("verify-identity")}>
                  Review identity
                </Button>
                <Button variant="secondary" size="sm" onClick={() => onOpenOverlay("change-patient")}>
                  Change patient
                </Button>
              </div>
            ) : null}
          </div>
        </div>
        <Button variant="primary" block trailingIcon={ArrowRight} onClick={onContinue}>
          Continue to pathway selection
        </Button>
      </aside>
    </div>
  );
}

function PathwayStage({
  onBack,
  onContinue,
  onOpenOverlay,
}: {
  onBack: () => void;
  onContinue: () => void;
  onOpenOverlay?: (overlayId: string) => void;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewTriggerRef = useRef<HTMLButtonElement>(null);
  const pathway = syntheticPathways[0];
  return (
    <div className="space-y-5" data-testid="caring-contact-screen-pathway-selection">
      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <ProductSection labelledBy="pathway-options-heading" className="overflow-hidden">
          <SectionHeading
            id="pathway-options-heading"
            title="Choose a governed pathway"
            description="No clinical ranking or recommendation is applied."
            icon={CalendarDays}
            className={productSectionHeadingPad}
          />
          <div className="divide-y divide-[color:var(--border)] border-t border-[color:var(--border)]">
            <button
              type="button"
              aria-pressed="true"
              onClick={() =>
                announce("Current twelve-month pathway selected", { eventId: "caring-contact:pathway-current" })
              }
              className="flex min-h-tap w-full items-start gap-3 bg-[color:var(--clinical-accent-soft)] px-5 py-4 text-left shadow-[var(--rule-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-0.125rem] focus-visible:outline-[color:var(--focus)]"
            >
              <span className="mt-1 size-4 shrink-0 rounded-full border-[5px] border-[color:var(--clinical-accent)] bg-[color:var(--surface)] forced-colors:border-[Highlight]" />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-[color:var(--text-heading)]">
                  Twelve-month caring contact
                </span>
                <span className="mt-1 block text-sm text-[color:var(--text-muted)]">
                  10 contacts · current locally approved version
                </span>
              </span>
              <StatusChip tone="success">Current</StatusChip>
            </button>
            <button
              type="button"
              aria-disabled="true"
              onClick={(event) => event.preventDefault()}
              title="Previous version—retired and unavailable"
              className="flex min-h-tap w-full cursor-not-allowed items-start gap-3 px-5 py-4 text-left text-[color:var(--text-muted)] opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-0.125rem] focus-visible:outline-[color:var(--focus)]"
            >
              <span className="mt-1 size-4 shrink-0 rounded-full border border-[color:var(--border-strong)]" />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">Previous version</span>
                <span className="mt-1 block text-sm">Retired · retained for history</span>
              </span>
              <StatusChip tone="neutral">Unavailable</StatusChip>
            </button>
          </div>
        </ProductSection>

        <ProductSection labelledBy="pathway-detail-heading" className="overflow-hidden">
          <SectionHeading
            id="pathway-detail-heading"
            title={pathway.name}
            description={`Version ${pathway.version}`}
            icon={FileCheck2}
            action={<StatusChip tone="success">Two-person approved</StatusChip>}
            className={productSectionHeadingPad}
          />
          <dl className="grid gap-px border-t border-[color:var(--border)] bg-[color:var(--border)] sm:grid-cols-2">
            {[
              ["Duration", "12 months · 10 contacts"],
              ["Cadence", "Day 1, week 1, months 1, 2, 3, 4, 6, 8, 10 and 12"],
              ["Sender", "Example Aftercare Team · non-receiving"],
              ["Approval", "Taylor Fiction and Jordan Example"],
            ].map(([term, value]) => (
              <div key={term} className="bg-[color:var(--surface)] px-5 py-4">
                <dt className="text-xs font-medium text-[color:var(--text-muted)]">{term}</dt>
                <dd className="mt-1 text-sm font-semibold leading-5 text-[color:var(--text-heading)]">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="border-t border-[color:var(--border)] p-5">
            <OneWayBoundary compact />
          </div>
          <div className="flex justify-end border-t border-[color:var(--border)] px-5 py-3">
            <Button
              ref={previewTriggerRef}
              variant="secondary"
              icon={Eye}
              onClick={() => (onOpenOverlay ? onOpenOverlay("pathway-preview") : setPreviewOpen(true))}
            >
              Preview pathway
            </Button>
          </div>
        </ProductSection>
      </div>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <Button variant="secondary" icon={ArrowLeft} onClick={onBack}>
          Back to patient and agreement
        </Button>
        <Button variant="primary" trailingIcon={ArrowRight} onClick={onContinue}>
          Continue to personalisation
        </Button>
      </div>

      <Sheet
        open={!onOpenOverlay && previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Preview governed pathway"
        description="Current locally approved synthetic version"
        closeLabel="Close pathway preview"
        returnFocusRef={previewTriggerRef}
        mobilePlacement="fullscreen"
        contentStyle={{
          position: "fixed",
          inset: "0 0 0 auto",
          width: "min(100%, 38rem)",
          maxWidth: "38rem",
          height: "100%",
          maxHeight: "100%",
        }}
        contentClassName="md:rounded-none"
        desktopBackdropClassName="md:items-stretch md:justify-end md:p-0"
      >
        <div className="space-y-5">
          <OneWayBoundary />
          <ProductSection className="overflow-hidden">
            <ScheduleList />
          </ProductSection>
        </div>
      </Sheet>
    </div>
  );
}

const preferenceOptions = [
  { label: "Morning", time: "10:00 am AWST", icon: Sun },
  { label: "Afternoon", time: "2:00 pm AWST", icon: Sun },
  { label: "Early evening", time: "5:00 pm AWST", icon: Sunset },
] as const;

function PersonalisationStage({
  onBack,
  onContinue,
  onOpenOverlay,
}: {
  onBack: () => void;
  onContinue: () => void;
  onOpenOverlay?: (overlayId: string) => void;
}) {
  return (
    <div className="space-y-5" data-testid="caring-contact-screen-personalisation">
      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <ProductSection labelledBy="personalisation-options-heading" className="overflow-hidden">
          <SectionHeading
            id="personalisation-options-heading"
            title="Governed personalisation"
            description="Only approved substitutions are available. Free text and generated authoring are absent."
            icon={MessageSquareText}
            className={productSectionHeadingPad}
          />
          <dl className="divide-y divide-[color:var(--border)] border-t border-[color:var(--border)]">
            {[
              ["Preferred name", "Rowan", "Imported from the synthetic referral"],
              ["Message variant", "Warm neutral A", "Locally approved current version"],
              ["Team identity", "Example Aftercare Team", "Neutral, non-receiving sender"],
              ["Coordinator signature", "Alex Example", "Explicitly assigned coordinator"],
            ].map(([label, value, note]) => (
              <div key={label} className="grid min-h-tap w-full gap-1 px-5 py-4 sm:flex sm:items-center sm:gap-3">
                <dt className="font-semibold text-[color:var(--text-heading)] sm:w-40 sm:shrink-0">{label}</dt>
                <dd className="min-w-0 sm:flex-1">
                  <span className="block text-sm font-medium text-[color:var(--text)]">{value}</span>
                  <span className="mt-0.5 block text-xs text-[color:var(--text-muted)]">{note}</span>
                </dd>
                <CheckCircle2
                  aria-label="Governed value present"
                  className="size-icon-md text-[color:var(--success)] forced-colors:text-[CanvasText]"
                />
              </div>
            ))}
          </dl>
          <fieldset className="border-t border-[color:var(--border)] px-5 py-5">
            <legend className="font-semibold text-[color:var(--text-heading)]">Sending preference</legend>
            <p className="mt-1 text-sm text-[color:var(--text-muted)]">One preference applies to all 10 contacts.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {preferenceOptions.map(({ label, time, icon: Icon }, index) => (
                <label
                  key={label}
                  className={cn(
                    "relative flex cursor-pointer items-start gap-3 rounded-[var(--radius-lg)] border p-4",
                    index === 0
                      ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)]"
                      : "border-[color:var(--border)] bg-[color:var(--surface)] hover:border-[color:var(--border-strong)]",
                  )}
                >
                  <input
                    type="radio"
                    name="sending-preference"
                    value={label}
                    defaultChecked={index === 0}
                    className="mt-1 accent-[color:var(--clinical-accent)]"
                  />
                  <span className="min-w-0">
                    <Icon aria-hidden="true" className="size-icon-md text-[color:var(--clinical-accent)]" />
                    <span className="mt-2 block font-semibold text-[color:var(--text-heading)]">{label}</span>
                    <span className="mt-1 block text-xs text-[color:var(--text-muted)]">{time}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </ProductSection>
        <MessagePreviewCard onPreview={onOpenOverlay ? () => onOpenOverlay("message-preview") : undefined} />
      </div>

      {onOpenOverlay ? (
        <div className="flex flex-wrap gap-2 rounded-[var(--radius-xl)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-3">
          <Button variant="secondary" size="sm" onClick={() => onOpenOverlay("communication-preference")}>
            Communication preference
          </Button>
          <Button variant="secondary" size="sm" onClick={() => onOpenOverlay("adjust-date-time")}>
            Adjust schedule
          </Button>
          <Button variant="secondary" size="sm" onClick={() => onOpenOverlay("save-draft")}>
            Save draft
          </Button>
          <Button variant="secondary" size="sm" onClick={() => onOpenOverlay("discard-changes")}>
            Discard changes
          </Button>
        </div>
      ) : null}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <Button variant="secondary" icon={ArrowLeft} onClick={onBack}>
          Back to pathway selection
        </Button>
        <Button variant="primary" trailingIcon={ArrowRight} onClick={onContinue}>
          Continue to review and activation
        </Button>
      </div>
    </div>
  );
}

function ReviewStage({
  onBack,
  onActivated,
  onOpenOverlay,
}: {
  onBack: () => void;
  onActivated: () => void;
  onOpenOverlay?: (overlayId: string) => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const patient = syntheticPatients[1];
  const pathway = syntheticPathways[0];

  function confirmActivation() {
    setConfirmOpen(false);
    announce("Prototype activation reviewed. No plan was created and no message was sent.", {
      eventId: "caring-contact:activation-review",
    });
    onActivated();
  }

  return (
    <div className="space-y-5" data-testid="caring-contact-screen-review-activation">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          [IdCard, "Identity and agreement", `${patient.fullName} · Agreement confirmed: Yes`],
          [Users, "Ownership", "Example Aftercare Team · Alex Example"],
          [FileCheck2, "Approved pathway", `${pathway.name} · ${pathway.version}`],
          [Info, "About this service", "One-way scheduled SMS that supplements usual care"],
        ].map(([Icon, title, detail]) => {
          const CardIcon = Icon as typeof IdCard;
          return (
            <div key={title as string} className={cn(productSurface, "px-4 py-4 sm:px-5")}>
              <span className="grid size-9 place-items-center rounded-[var(--radius-md)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
                <CardIcon aria-hidden="true" className="size-icon-md" />
              </span>
              <p className="mt-4 font-semibold text-[color:var(--text-heading)]">{title as string}</p>
              <p className="mt-2 text-sm leading-5 text-[color:var(--text-muted)]">{detail as string}</p>
            </div>
          );
        })}
      </div>

      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <MessagePreviewCard onPreview={onOpenOverlay ? () => onOpenOverlay("message-preview") : undefined} />
        <ProductSection labelledBy="activation-schedule-heading" className="overflow-hidden">
          <SectionHeading
            id="activation-schedule-heading"
            title="10-contact schedule"
            description={ROWAN_SELECTED_SENDING_PREFERENCE.windowLabel}
            icon={CalendarDays}
            className={productSectionHeadingPad}
          />
          <div className="border-t border-[color:var(--border)]">
            <ScheduleList />
          </div>
        </ProductSection>
      </div>

      <OneWayBoundary />

      <div className="flex flex-col-reverse gap-3 border-t border-[color:var(--border)] pt-5 sm:flex-row sm:justify-between">
        <Button variant="secondary" icon={ArrowLeft} onClick={onBack}>
          Back to personalisation
        </Button>
        <Button
          variant="primary"
          icon={CheckCircle2}
          onClick={() => (onOpenOverlay ? onOpenOverlay("final-activation") : setConfirmOpen(true))}
        >
          Activate 10-contact plan
        </Button>
      </div>

      <ConfirmDialog
        open={!onOpenOverlay && confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={confirmActivation}
        title="Final activation assurance"
        description="Review the selected identity, agreement, ownership, pathway, exact message and every AWST schedule time. This synthetic action creates no plan and sends no message."
        confirmLabel="Confirm activation review"
        tone="primary"
      />
    </div>
  );
}
