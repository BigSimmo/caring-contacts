"use client";

import { CircleAlert, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { cn } from "@/components/ui-primitives";
import { formatMinutesDuration } from "@/lib/caring-contacts/duration-display";

import { OVERLAY_TRIGGER_CLASS } from "./overlays/overlay-trigger";
import {
  claimRequestBody,
  mintPlanActionIdempotencyKey,
  planActionRefusalNameFrom,
  planActionRefusalWording,
  planAssignmentEndpoint,
  PLAN_ACTION_TRANSPORT_REFUSALS,
  type PlanActionRefusal,
} from "./plan-action-rules";
import { StatedReason } from "./plan-wizard/stated-reason";

/**
 * The Team screen's list of plans nobody has claimed, each with "Claim this plan" (owner decision
 * 2026-09-26: unclaimed work must be takeable from the screen that shows it).
 *
 * WHAT A ROW SAYS, AND WHAT IT DELIBERATELY DOES NOT. The Team screen names no patient and puts no
 * plan, patient or contact identifier in the words on it -- a roster must not be a route to a
 * patient. So a row is described by how long the plan has waited and whether it is running; the
 * plan's synthetic identifier is carried only in the write, never rendered. Once claimed, the plan
 * is in the claimer's caseload, where it is opened in the ordinary way.
 *
 * THE WRITE IS THE EXISTING CLAIM. It goes to the assignment route with `{ type: "claim", actorId }`,
 * which the service already audits, gates on `claimPlan` for the plan's own team, and refuses when
 * the claim names anybody but the caller or the plan already has a coordinator.
 *
 * ONE KEY PER PLAN, reused on a retry, for the same reason `plan-actions.tsx` keeps one: a press
 * repeated after a lost answer is then a replay the service recognises, not a second write.
 */
/**
 * One unclaimed plan, as this list needs it. Declared here rather than imported from
 * `team-workload.ts` on purpose: that module reaches the repository, and a client component's module
 * graph must never reach the service-state module (see the client allowlist test). The domain's
 * `UnclaimedPlanEntry` is assignable to this shape, so the page hands it straight across.
 */
export type TeamClaimEntry = {
  readonly planId: string;
  readonly minutesUnclaimed: number;
  readonly escalated: boolean;
  readonly hold: "planNotStarted" | "planPaused" | null;
};

export type TeamClaimListProps = {
  entries: readonly TeamClaimEntry[];
  /** The caller's own identifier, which a claim must name. Compared by the service; never rendered. */
  actingActorId: string;
};

type RowOutcome =
  | { readonly kind: "sending" }
  | { readonly kind: "claimed" }
  | { readonly kind: "refused"; readonly refusal: PlanActionRefusal };

const noteClass = "max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]";

function holdWording(hold: TeamClaimEntry["hold"]): string {
  if (hold === "planNotStarted") return "not started yet";
  if (hold === "planPaused") return "being held";
  return "running";
}

export function TeamClaimList({ entries, actingActorId }: TeamClaimListProps) {
  const router = useRouter();
  const [outcomes, setOutcomes] = useState<Readonly<Record<string, RowOutcome>>>({});
  const keys = useRef<Record<string, string>>({});

  const claim = async (plan: string) => {
    setOutcomes((current) => ({ ...current, [plan]: { kind: "sending" } }));
    const key = (keys.current[plan] ??= mintPlanActionIdempotencyKey("claim"));
    const refusalName = await send(plan, key, actingActorId);
    if (refusalName === null) {
      delete keys.current[plan];
      setOutcomes((current) => ({ ...current, [plan]: { kind: "claimed" } }));
    } else {
      setOutcomes((current) => ({
        ...current,
        [plan]: { kind: "refused", refusal: planActionRefusalWording(refusalName) },
      }));
    }
    // Either way the figures above were read before this, so the screen is read again.
    router.refresh();
  };

  return (
    <div className="min-w-0" data-testid="caring-contacts-team-claim-list">
      <h3 className="text-sm font-semibold text-[color:var(--text-heading)]">Take on unclaimed work</h3>
      <p className={cn(noteClass, "mt-1")}>
        Claiming a plan makes you its coordinator and takes it off this list. Plans are listed longest-waiting first; no
        patient is named here, and a claimed plan is opened from your caseload.
      </p>
      <ul className="mt-2 flex min-w-0 flex-col gap-2">
        {entries.map((entry, index) => {
          const outcome = outcomes[entry.planId];
          return (
            <li
              key={entry.planId}
              data-testid="caring-contacts-team-claim-row"
              className="flex min-w-0 flex-col gap-2 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-3 forced-colors:border-[CanvasText] sm:flex-row sm:items-center sm:justify-between"
            >
              <p className="min-w-0 text-sm text-[color:var(--text)]">
                <span className="font-medium">Unclaimed plan {index + 1}</span>
                {` — waiting ${formatMinutesDuration(entry.minutesUnclaimed)}${
                  entry.escalated ? ", past the escalation threshold" : ""
                }; ${holdWording(entry.hold)}.`}
              </p>
              {outcome?.kind === "claimed" ? (
                <p className="text-sm font-medium text-[color:var(--text)]" role="status">
                  Claimed — you are now carrying this plan.
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (outcome?.kind === "sending") return;
                    void claim(entry.planId);
                  }}
                  aria-disabled={outcome?.kind === "sending" ? "true" : undefined}
                  className={cn(OVERLAY_TRIGGER_CLASS, "w-full shrink-0 sm:w-auto")}
                >
                  {outcome?.kind === "sending" ? (
                    <Loader2 aria-hidden="true" className="size-icon-md animate-spin motion-reduce:animate-none" />
                  ) : null}
                  Claim this plan
                </button>
              )}
              {outcome?.kind === "refused" ? (
                <div className="min-w-0 sm:basis-full" role="status">
                  <StatedReason
                    heading={outcome.refusal.heading}
                    because={outcome.refusal.because}
                    changedBy={outcome.refusal.changedBy}
                    icon={<CircleAlert aria-hidden="true" className="size-icon-md shrink-0" />}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** One claim; null when it was recorded, otherwise the named refusal. Never throws. */
async function send(plan: string, idempotencyKey: string, actorId: string): Promise<string | null> {
  let answer: Response;
  try {
    answer = await fetch(planAssignmentEndpoint(plan), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(claimRequestBody({ actorId, idempotencyKey })),
    });
  } catch {
    return PLAN_ACTION_TRANSPORT_REFUSALS.didNotReach;
  }
  let payload: unknown;
  try {
    payload = await answer.json();
  } catch {
    return PLAN_ACTION_TRANSPORT_REFUSALS.unreadableAnswer;
  }
  return answer.ok ? null : planActionRefusalNameFrom(payload);
}
