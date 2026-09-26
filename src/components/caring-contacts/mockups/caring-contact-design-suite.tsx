"use client";

import { ArrowLeft, Plus } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { announce } from "@/components/ui/live-announcer";

import { ActivationWorkflow, type ActivationStage } from "./activation-workflow";
import { CaringContactShellFrame } from "./caring-contact-shell-frame";
import {
  DeliveryExceptionDrawer,
  GuidanceProductPage,
  PatientOverviewProductPage,
  PatientsDirectoryPage,
  PlanDetailProductPage,
  ReportsProductPage,
  ScheduleProductPage,
  TeamProductPage,
  TemplatesProductPage,
  TodayProductPage,
} from "./product-pages";
import type { WorkspaceDestination } from "./types";

type PatientSurface = "directory" | "agreement" | "pathway" | "personalisation" | "review" | "overview" | "plan";

const workflowTitles: Record<ActivationStage, string> = {
  agreement: "Patient and agreement",
  pathway: "Pathway selection",
  personalisation: "Personalisation",
  review: "Review and activation",
};

const workflowStepLabels: Record<ActivationStage, string> = {
  agreement: "Step 1 of 4",
  pathway: "Step 2 of 4",
  personalisation: "Step 3 of 4",
  review: "Step 4 of 4",
};

export function CaringContactDesignSuite() {
  const [activeDestination, setActiveDestination] = useState<WorkspaceDestination>("Today");
  const [patientSurface, setPatientSurface] = useState<PatientSurface>("directory");
  const [deliveryExceptionOpen, setDeliveryExceptionOpen] = useState(false);

  const activationStage =
    patientSurface === "agreement" ||
    patientSurface === "pathway" ||
    patientSurface === "personalisation" ||
    patientSurface === "review"
      ? patientSurface
      : null;

  useEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    const title = document.querySelector<HTMLElement>("[data-caring-contact-page-title]");
    title?.focus({ preventScroll: true });
    announce(`${title?.textContent?.trim() ?? activeDestination} page`, {
      eventId: `caring-contact:surface:${activeDestination}:${patientSurface}`,
    });
  }, [activeDestination, patientSurface]);

  function selectDestination(destination: WorkspaceDestination) {
    setActiveDestination(destination);
    if (destination === "Patients") setPatientSurface("directory");
  }

  function openPatientSurface(surface: PatientSurface) {
    setActiveDestination("Patients");
    setPatientSurface(surface);
  }

  function openScheduleException() {
    setActiveDestination("Schedule");
    setDeliveryExceptionOpen(true);
  }

  let title: string = activeDestination;
  let eyebrow: string | undefined;
  let description: string | undefined;
  let headerAction;
  let content;

  if (activeDestination === "Today") {
    title = "Today";
    eyebrow = "Saturday, 15 August 2026";
    description = "Prioritised referrals, operational work and today’s scheduled contacts.";
    headerAction = (
      <Button variant="primary" icon={Plus} onClick={() => openPatientSurface("agreement")} className="md:hidden">
        New referral
      </Button>
    );
    content = (
      <TodayProductPage
        onReviewReferral={() => openPatientSurface("agreement")}
        onOpenPatients={() => openPatientSurface("directory")}
        onOpenSchedule={() => setActiveDestination("Schedule")}
      />
    );
  } else if (activeDestination === "Patients") {
    if (activationStage) {
      title = workflowTitles[activationStage];
      eyebrow = workflowStepLabels[activationStage];
      description = "Create a governed 10-contact plan for the selected fictional patient.";
      headerAction = (
        <Button variant="ghost" icon={ArrowLeft} onClick={() => setPatientSurface("directory")}>
          Patients
        </Button>
      );
      content = (
        <ActivationWorkflow
          stage={activationStage}
          onStageChange={setPatientSurface}
          onActivated={() => setPatientSurface("overview")}
        />
      );
    } else if (patientSurface === "overview") {
      title = "Patient overview";
      eyebrow = "Rowan Sample · synthetic patient";
      description = "Identity, ownership, continuity and the complete operational history in one place.";
      headerAction = (
        <Button variant="secondary" onClick={() => setPatientSurface("plan")}>
          View active plan
        </Button>
      );
      content = <PatientOverviewProductPage onViewPlan={() => setPatientSurface("plan")} />;
    } else if (patientSurface === "plan") {
      title = "Plan and contact detail";
      eyebrow = "Rowan Sample · active plan";
      description = "The plan, frozen versions, future schedule, audit trail and governed actions.";
      headerAction = (
        <Button variant="secondary" icon={ArrowLeft} onClick={() => setPatientSurface("overview")}>
          View patient
        </Button>
      );
      content = <PlanDetailProductPage onOpenException={() => setDeliveryExceptionOpen(true)} />;
    } else {
      title = "Patients";
      eyebrow = "Example Aftercare Team";
      description = "Team-scoped referrals and caring-contact episodes. No global patient search.";
      headerAction = (
        <Button variant="primary" icon={Plus} onClick={() => setPatientSurface("agreement")}>
          New plan
        </Button>
      );
      content = (
        <PatientsDirectoryPage
          onOpenRowan={() => setPatientSurface("overview")}
          onContinueMira={() => setPatientSurface("agreement")}
        />
      );
    }
  } else if (activeDestination === "Schedule") {
    title = "Schedule";
    eyebrow = "Australia/Perth";
    description = "One-day operational view with routine windows separated from named exceptions.";
    content = <ScheduleProductPage onOpenException={openScheduleException} />;
  } else if (activeDestination === "Templates") {
    title = "Governed templates";
    eyebrow = "Programme administration";
    description = "Approved pathway and message versions with explicit ownership and lifecycle.";
    content = <TemplatesProductPage />;
  } else if (activeDestination === "Team") {
    title = "Team";
    eyebrow = "Ownership and capacity";
    description = "Explicit coordination, unclaimed work and escalation for the active team.";
    content = <TeamProductPage />;
  } else if (activeDestination === "Guidance") {
    title = "Guidance";
    eyebrow = "Programme boundaries";
    description = "Clear operational guidance for one-way caring-contact coordination.";
    content = <GuidanceProductPage />;
  } else {
    title = "Reports";
    eyebrow = "Aggregate operations";
    description = "Quiet service measures without patient-state, engagement or clinical inference.";
    content = <ReportsProductPage />;
  }

  return (
    <CaringContactShellFrame
      activeDestination={activeDestination}
      onDestinationChange={selectDestination}
      onStartReferral={() => openPatientSurface("agreement")}
      title={title}
      eyebrow={eyebrow}
      description={description}
      headerAction={headerAction}
    >
      {content}
      <DeliveryExceptionDrawer open={deliveryExceptionOpen} onClose={() => setDeliveryExceptionOpen(false)} />
    </CaringContactShellFrame>
  );
}
