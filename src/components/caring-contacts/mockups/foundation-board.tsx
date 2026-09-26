"use client";

import { ArrowRight, Check, Clock3, Layers3, Palette, Type } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { syntheticReferrals } from "./fixtures";
import { DefinitionRow, OperationalStatus, SpecimenLabel, SpecimenPanel } from "./prototype-primitives";

export function FoundationBoard() {
  const referral = syntheticReferrals[0];
  const [selectedExample, setSelectedExample] = useState<"referral" | "schedule" | null>(null);

  return (
    <div className="space-y-[var(--gap-section)]" data-testid="caring-contact-foundation-board">
      <div className="grid min-w-0 gap-[var(--gap-block)] lg:grid-cols-2">
        <SpecimenPanel
          title="Surface and type roles"
          description="PsychSift v2 roles stay quiet, legible and consistent across every workspace state."
          icon={Palette}
        >
          <div className="grid gap-[var(--gap-stack)] sm:grid-cols-3">
            {[
              ["Canvas", "Primary working surface", "bg-[color:var(--surface)]"],
              ["Raised", "Focused content region", "bg-[color:var(--surface-raised)]"],
              ["Inset", "Supporting context", "bg-[color:var(--surface-inset)]"],
            ].map(([name, description, colour]) => (
              <div key={name} className="min-w-0">
                <div
                  aria-hidden="true"
                  className={`mb-2 h-12 rounded-[var(--radius-md)] border border-[color:var(--border)] ${colour}`}
                />
                <p className="font-medium text-[color:var(--text)]">{name}</p>
                <p className="mt-1 text-xs text-[color:var(--text-muted)]">{description}</p>
              </div>
            ))}
          </div>
          <div className="mt-[var(--gap-block)] border-t border-[color:var(--border)] pt-[var(--gap-block)]">
            <SpecimenLabel>Type hierarchy</SpecimenLabel>
            <div className="mt-[var(--gap-stack)] flex flex-col items-start gap-[var(--gap-stack)] sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-[var(--gap-block)]">
              <span className="text-2xl font-semibold tracking-tight text-[color:var(--text)]">Workspace</span>
              <span className="text-base font-semibold text-[color:var(--text)]">Panel heading</span>
              <span className="text-sm text-[color:var(--text-muted)]">Supporting detail</span>
              <Type aria-hidden="true" className="size-icon-lg text-[color:var(--clinical-accent)]" />
            </div>
          </div>
        </SpecimenPanel>

        <SpecimenPanel
          title="Action hierarchy"
          description="One filled command leads a region. Secondary actions remain explicit and object-specific."
          icon={Layers3}
        >
          <SpecimenLabel>Available actions</SpecimenLabel>
          <div className="mt-[var(--gap-stack)] flex flex-wrap gap-[var(--gap-inline)]">
            <Button variant="primary" trailingIcon={ArrowRight} onClick={() => setSelectedExample("referral")}>
              Inspect referral action specimen
            </Button>
            <Button variant="secondary" icon={Clock3} onClick={() => setSelectedExample("schedule")}>
              Inspect sending windows
            </Button>
          </div>
          {selectedExample ? (
            <p className="mt-[var(--gap-stack)] text-sm font-medium text-[color:var(--clinical-accent)]" role="status">
              {selectedExample === "referral"
                ? "Fictional referral assurance selected for review."
                : "Approved AWST sending-window specimen selected."}
            </p>
          ) : null}
          <div className="mt-[var(--gap-block)] rounded-[var(--radius-lg)] bg-[color:var(--surface-inset)] p-[var(--pad-card)]">
            <p className="font-medium text-[color:var(--text)]">Named unavailable state</p>
            <p className="mt-1 text-sm text-[color:var(--text-muted)]">
              Activation remains unavailable until every source assurance is complete. The prototype does not perform
              activation.
            </p>
          </div>
        </SpecimenPanel>
      </div>

      <div className="grid min-w-0 gap-[var(--gap-block)] lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <SpecimenPanel
          title="Operational vocabulary"
          description="Words name system state and next work. Colour and marks only reinforce the visible label."
          icon={Check}
        >
          <div className="flex flex-wrap gap-[var(--gap-tight)]">
            <OperationalStatus tone="neutral">Scheduled</OperationalStatus>
            <OperationalStatus tone="info">Processing</OperationalStatus>
            <OperationalStatus tone="success">Delivered</OperationalStatus>
            <OperationalStatus tone="warning">Status unavailable</OperationalStatus>
            <OperationalStatus tone="danger">Not delivered</OperationalStatus>
          </div>
          <dl className="mt-[var(--gap-block)] text-sm">
            <DefinitionRow term="Delivered">
              Transport receipt recorded. It does not show that the contact was read.
            </DefinitionRow>
            <DefinitionRow term="Not delivered">
              Create the named operational task and keep patient state unstated.
            </DefinitionRow>
            <DefinitionRow term="Awaiting handover">
              The referring team remains responsible until explicit acceptance.
            </DefinitionRow>
          </dl>
        </SpecimenPanel>

        <SpecimenPanel
          title="Action-first language"
          description="Conditions, remedies and owners remain concrete without inferred priority labels."
          icon={Clock3}
        >
          <div className="rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--surface)] p-[var(--pad-card)] shadow-[var(--rule-warning)]">
            <div className="flex flex-wrap items-center justify-between gap-[var(--gap-inline)]">
              <p className="font-semibold text-[color:var(--text)]">Patient-controlled mobile flag missing</p>
              <OperationalStatus tone="warning">Needs action</OperationalStatus>
            </div>
            <p className="mt-2 text-sm text-[color:var(--text-muted)]">
              Request source clarification from {referral.referringTeam}.
            </p>
            <p className="mt-1 text-sm font-medium text-[color:var(--text)]">Owner: referring team</p>
          </div>
          <p className="mt-[var(--gap-stack)] text-xs text-[color:var(--text-muted)]">
            Fictional reference {referral.id}; agreement is recorded as Yes and is not represented as legal or treatment
            consent.
          </p>
        </SpecimenPanel>
      </div>
    </div>
  );
}
