import { ArrowRight, CircleAlert, FilePlus } from "lucide-react";
import Link from "next/link";

import { floatingControl } from "@/components/ui-primitives";
import { CARING_CONTACTS_ROUTES, newPlanRoute } from "@/lib/caring-contacts-routes";
import type { ReferralState } from "@/lib/caring-contacts/model";

import { awstDateWording } from "../date-wording";
import { ListEmptyState } from "../list-empty-state";
import { workspacePanelPadded } from "../surfaces";
import { StatedReason } from "./stated-reason";

/**
 * Every reason the activation wizard does not start, said honestly.
 *
 * A Server Component with no hooks, deliberately: none of these states needs the wizard's client
 * boundary, and rendering them on the server means the whole screen still says something useful
 * with JavaScript turned off, exactly as the workspace's other screens do.
 *
 * RULING [111] SETS THE RULE THESE STATES OBEY. A referral this actor may not see is not an error
 * to explain in detail and is never a 404: a 404 would distinguish "no such referral" from
 * "another team's", and the store deliberately answers those two identically so that nobody can
 * find out a record exists by being refused it. So the answer here is one answer for both, and it
 * says so in words rather than leaving a clinician to guess which they hit.
 *
 * THE REMEDIES ARE REAL (Ruling 93). Where nothing on this screen can change the state, that is
 * what the remedy says. Naming a control that does not exist is worse than naming none, because
 * the reader will hunt for it. When no referral is named, the accepted referrals that have no plan
 * yet ARE listed below, because the workspace's "New plan" control lands here and a screen with no
 * way forward from its own primary control is a dead end.
 */
export type PlanStartState =
  /** The acting role cannot start a caring-contact plan at all. Decided from the ACTOR. */
  | { kind: "not-permitted" }
  /**
   * The URL named no referral. `startable` is every accepted referral this team holds that does not
   * yet carry a plan, so the screen can offer a real next step instead of a dead end.
   */
  | { kind: "no-referral-named"; startable: readonly StartableReferral[] }
  /** The URL named one this actor may not see — no such referral, or another team's, indistinguishably. */
  | { kind: "referral-not-visible" }
  /** A referral this actor may see, which has not been accepted. */
  | { kind: "referral-not-accepted"; referralId: string; state: ReferralState };

/**
 * An accepted referral with no plan yet, described as the referral itself holds it. The name,
 * discharge date and hospital come from the referral's intake record, the same record the wizard
 * pre-fills from once the referral is opened, and are null where that record holds none.
 */
export type StartableReferral = {
  referralId: string;
  patientId: string;
  patientName: string | null;
  /** An ISO date or instant; rendered as a Perth calendar date. */
  dischargeDate: string | null;
  hospital: string | null;
};

/**
 * Plain words for a referral's state.
 *
 * A `Record<ReferralState, string>` rather than a switch with a fallback: a state added to the
 * union and left unlabelled stops this file compiling, instead of rendering a clinician the raw
 * identifier or, worse, a stale label belonging to a different state.
 */
const REFERRAL_STATE_LABELS: Record<ReferralState, string> = {
  awaitingHandover: "waiting to be handed over",
  accepted: "accepted",
  returnedForClarification: "returned for clarification",
  declined: "declined",
};

const backClass =
  "inline-flex min-h-tap min-w-0 items-center justify-center rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-4 text-sm font-semibold text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] forced-colors:border-[CanvasText]";

function BackToCaseload() {
  return (
    <Link href={CARING_CONTACTS_ROUTES.patients} data-internal-link="true" className={backClass}>
      Back to this team&rsquo;s patients
    </Link>
  );
}

function StartableReferrals({ startable }: { startable: readonly StartableReferral[] }) {
  return (
    <section
      aria-labelledby="caring-contacts-startable-referrals-heading"
      data-testid="caring-contacts-startable-referrals"
      className="flex min-w-0 flex-col gap-4"
    >
      <div className="min-w-0">
        <h2
          id="caring-contacts-startable-referrals-heading"
          className="text-base font-semibold text-[color:var(--text-heading)]"
        >
          Choose a referral to start from
        </h2>
        <p className="mt-1 max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
          A caring-contact plan is always started for a referral this team has accepted. These accepted referrals do not
          have a plan yet. A patient whose plan is still running is not listed, and where one patient has several
          referrals only the most recent is shown.
        </p>
      </div>
      <ul className="grid min-w-0 gap-3 sm:grid-cols-2">
        {startable.map(({ referralId, patientId, patientName, dischargeDate, hospital }) => (
          <li key={referralId} className={`${workspacePanelPadded} flex flex-col gap-3`}>
            <div className="min-w-0">
              <p className="break-words text-base font-semibold text-[color:var(--text-heading)]">
                {patientName ?? "Name not held on this referral"}
              </p>
              <dl className="mt-1 grid min-w-0 gap-1 text-sm">
                <div className="flex min-w-0 flex-wrap gap-x-2">
                  <dt className="text-[color:var(--text-muted)]">Discharged</dt>
                  <dd className="min-w-0 text-[color:var(--text)]">
                    {dischargeDate === null ? (
                      "Not held on this referral"
                    ) : (
                      <time dateTime={dischargeDate}>{awstDateWording(dischargeDate)}</time>
                    )}
                  </dd>
                </div>
                <div className="flex min-w-0 flex-wrap gap-x-2">
                  <dt className="text-[color:var(--text-muted)]">Hospital</dt>
                  <dd className="min-w-0 break-words text-[color:var(--text)]">
                    {hospital ?? "Not held on this referral"}
                  </dd>
                </div>
              </dl>
            </div>
            <dl className="grid min-w-0 gap-1 text-xs leading-5 text-[color:var(--text-muted)]">
              <div className="flex min-w-0 flex-wrap gap-x-2">
                <dt>Referral</dt>
                <dd className="min-w-0 break-all font-mono">{referralId}</dd>
              </div>
              <div className="flex min-w-0 flex-wrap gap-x-2">
                <dt>Synthetic patient identifier</dt>
                <dd className="min-w-0 break-all font-mono">{patientId}</dd>
              </div>
            </dl>
            <Link
              href={newPlanRoute(referralId)}
              data-internal-link="true"
              className={`${floatingControl} self-start`}
              aria-label={
                patientName === null
                  ? `Start a plan for referral ${referralId}`
                  : `Start a plan for ${patientName}, referral ${referralId}`
              }
            >
              <span>Start a plan</span>
              <ArrowRight aria-hidden="true" className="size-icon-sm shrink-0" />
            </Link>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Link href={CARING_CONTACTS_ROUTES.intake} data-internal-link="true" className={floatingControl}>
          <FilePlus aria-hidden="true" className="size-icon-sm shrink-0" />
          <span>Register a new referral</span>
        </Link>
        <BackToCaseload />
      </div>
    </section>
  );
}

export function PlanStartStateNotice({ state }: { state: PlanStartState }) {
  switch (state.kind) {
    case "not-permitted":
      return (
        <ListEmptyState
          kind="not-permitted"
          heading="Starting a plan is not part of this role"
          because="Putting a patient onto a caring-contact plan needs a role that may both read the referral it starts from and claim a plan for it. The role you are acting in holds neither, or only one of them, so this screen cannot begin."
          changedBy="Nothing on this screen changes it, and there is no control for it anywhere in this workspace. The role this demonstration acts in is set outside the interface; a coordinator can start a plan."
          action={<BackToCaseload />}
        />
      );
    case "no-referral-named":
      return state.startable.length > 0 ? (
        <StartableReferrals startable={state.startable} />
      ) : (
        <ListEmptyState
          kind="no-data"
          heading="No referral named"
          explanation="A caring-contact plan is always started for a referral this team has accepted. There is no accepted referral waiting for a plan right now. Registering a referral through referral intake is how a new one reaches this screen."
          action={
            <div className="flex flex-wrap items-center gap-3">
              <Link href={CARING_CONTACTS_ROUTES.intake} data-internal-link="true" className={floatingControl}>
                <FilePlus aria-hidden="true" className="size-icon-sm shrink-0" />
                <span>Referral intake</span>
              </Link>
              <BackToCaseload />
            </div>
          }
        />
      );
    case "referral-not-visible":
      return (
        <ListEmptyState
          kind="not-permitted"
          heading="That referral is not one you can open"
          because="The referral named in the link is not among the ones this team holds. A referral that does not exist and a referral belonging to another team give the same answer here, on purpose, so that nobody can find out a record exists by being refused it."
          changedBy="Opening this screen from a referral this team has accepted starts a plan for it. Nothing on this page can reach the one that was named."
          action={<BackToCaseload />}
        />
      );
    case "referral-not-accepted":
      return (
        <div className="flex min-w-0 flex-col gap-4">
          <StatedReason
            heading="This referral has not been accepted"
            because={`${state.referralId} is ${REFERRAL_STATE_LABELS[state.state]}. A plan is created for a referral a team has taken responsibility for, and accepting it is also where the pathway can first be named, so a plan cannot be started before that.`}
            changedBy="Accepting the referral. That is done where referrals are handled, which is not built in this workspace yet, so nothing on this page changes it."
            icon={<CircleAlert aria-hidden="true" className="size-icon-md shrink-0" />}
          />
          <div>
            <BackToCaseload />
          </div>
        </div>
      );
    default: {
      const unstated: never = state;
      return unstated;
    }
  }
}
