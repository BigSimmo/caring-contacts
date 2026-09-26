"use client";

import { CircleAlert, Loader2, OctagonX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";

import { cn } from "@/components/ui-primitives";
import { announce } from "@/components/ui/live-announcer";

import { OVERLAY_TRIGGER_CLASS } from "./overlays/overlay-trigger";
import { StatedReason } from "./plan-wizard/stated-reason";

/**
 * The two writes on the service stop screen: raising the service-wide stop, and recording one
 * restart approval (owner request 2026-09-26: "The emergency safety stop has no button. Stopping
 * all sending during an incident currently needs a developer.").
 *
 * WHAT CROSSES INTO THIS CLIENT BOUNDARY, AND WHAT NEVER DOES. The stop record carries a
 * responder's free-text incident note, which the sealed domain classifies as patient data, and
 * `tests/caring-contacts-explained-automation.dom.test.tsx` holds every client module in this
 * workspace to never naming that record's module or type. So nothing here receives the record. The
 * server screen reads it, narrows it, renders the facts itself, and hands this module only plain
 * strings: the reason categories' wording, the seats this person may take, and the address to post
 * to. The address arrives as a prop for the same reason -- it is the record's own route, and naming
 * it here would put that module's name in a client module's source.
 *
 * WHO SEES THE BUTTON is decided on the server, from the sealed capability map
 * (`triggerServiceSafetyStop`, `approveServiceRestart`), and this module is simply not rendered for
 * anyone else. The route checks the same capability again on every write, because a role can change
 * while a screen is open.
 *
 * ONE KEY PER SUBMISSION. A key is minted when a submission reaches its confirm step and reused if
 * the same submission is sent again after an answer was lost, so a retry is a replay the service
 * recognises rather than a second write. Going back to edit, or a recorded answer, discards it: a
 * different submission always carries a fresh key.
 *
 * EVERY OUTCOME IS ANNOUNCED through the product's one live-region owner (`announce`), and the same
 * words are shown on screen. The visible copy is not itself a live region, so a screen reader hears
 * each outcome once.
 */

/** One reason category, worded on the server from the sealed domain's own wording. */
export type ServiceStopReasonOption = {
  readonly value: string;
  readonly label: string;
  readonly description: string;
};

/** One restart seat this person may record an approval for. */
export type RestartSeatOption = {
  readonly role: string;
  /** "the incident lead", "the privacy and security owner", "the clinical programme lead". */
  readonly wording: string;
};

/** Long enough for any incident account; short enough that the request can never be refused as too large. */
export const INCIDENT_NOTE_MAX_LENGTH = 2000;

const HEX_TO_LETTER = "abcdefghijklmnop";

/**
 * Letters only, never digits: an idempotency key is recorded on the audit trail, whose guard refuses
 * anything that reads as a mobile number, and a run of random digits can. Same construction as
 * `plan-action-rules.ts`.
 */
function mintKey(prefix: string): string {
  const letters = globalThis.crypto
    .randomUUID()
    .replace(/-/g, "")
    .replace(/[0-9a-f]/g, (character) => HEX_TO_LETTER[Number.parseInt(character, 16)]);
  return `${prefix}-${letters}`;
}

// ---------------------------------------------------------------------------
// Refusals, in plain words
// ---------------------------------------------------------------------------

type Refusal = { readonly heading: string; readonly because: string; readonly changedBy: string };

const DID_NOT_REACH = "request-did-not-reach-the-service";
const UNREADABLE_ANSWER = "service-answered-with-something-unreadable";

const NOT_PERMITTED: Refusal = {
  heading: "This role may not do this",
  because: "The service checked this account's role and refused. Nothing was recorded.",
  changedBy: "Only a role that holds this permission can do it. Ask someone who holds it.",
};

/**
 * Every refusal the route behind this screen can answer with. Null-prototype, so an inherited key
 * never reads as a refusal (Ruling 61); an unrecognised name is shown as the service's own word and
 * labelled as one this screen has not been taught, rather than given a plausible invented sentence.
 */
const REFUSALS: Readonly<Record<string, Refusal>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, Refusal>, {
    "service-already-stopped": {
      heading: "Sending was already stopped",
      because:
        "Someone stopped sending before this request arrived. The first record of a stop is kept and never overwritten, so this one was not added.",
      changedBy: "Nothing needs doing to stop sending. This screen is read again to show the stop that stands.",
    },
    "service-stop-note-required": {
      heading: "The incident note is empty",
      because: "A stop must say which message or event it is about, so the incident can be reviewed afterwards.",
      changedBy: "Writing what happened in the incident note, then stopping again.",
    },
    "service-not-stopped": {
      heading: "Sending is already running",
      because: "There is no stop in place, so there is nothing to approve a restart of. Nothing was recorded.",
      changedBy: "Nothing. This screen is read again to show where sending stands.",
    },
    "restart-approval-role-already-recorded": {
      heading: "That seat has already approved",
      because: "An approval for this seat is already on record, and each seat approves once.",
      changedBy: "Nothing on this screen. The remaining seats still need their approvals.",
    },
    "restart-approval-seat-not-held": {
      heading: "You are not named for that seat",
      because:
        "Each restart approval must come from a person the service's configuration names for that seat. This account is not named for it, so nothing was recorded.",
      changedBy: "The person named for that seat approving it, or an operator naming you for it.",
    },
    "restart-approval-actor-already-recorded": {
      heading: "You have already approved the restart",
      because:
        "This account already recorded an approval for another seat. A restart needs three different people, so one person cannot approve twice.",
      changedBy: "The people named for the remaining seats approving them.",
    },
    "action-not-granted": NOT_PERMITTED,
    "permission-denied": NOT_PERMITTED,
    "no-roles": NOT_PERMITTED,
    "cross-team-denied": NOT_PERMITTED,
    "session-required": {
      heading: "Your session has ended",
      because: "The service could not tell who is asking, so it recorded nothing.",
      changedBy: "Signing in again, then repeating this.",
    },
    "idempotency-key-reused-for-a-different-write": {
      heading: "The service could not match this request",
      because:
        "This request was confused with an earlier, different one, so the service refused it. Nothing was recorded.",
      changedBy: "Sending it again, which uses a fresh request.",
    },
    "invalid-request": {
      heading: "The service could not read this request",
      because: "Something in it was not in the form the service accepts. Nothing was recorded.",
      changedBy: "Checking the reason and the note, then sending again.",
    },
    "request-body-too-large": {
      heading: "The incident note is too long",
      because: "The service refused a request this large. Nothing was recorded.",
      changedBy: "Shortening the note, then sending again.",
    },
    "write-failed": {
      heading: "The service could not record this",
      because: "Something went wrong inside the service. Nothing was recorded.",
      changedBy:
        "Trying again now. If it keeps failing, treat that as part of the incident and escalate it through your service's incident process.",
    },
    [DID_NOT_REACH]: {
      heading: "The request may not have reached the service",
      because:
        "The connection failed before an answer came back, so this screen cannot tell whether anything was recorded.",
      changedBy: "This screen is read again to show where things stand. Send again only if nothing changed.",
    },
    [UNREADABLE_ANSWER]: {
      heading: "The service's answer could not be read",
      because:
        "An answer came back that this screen does not understand, so it cannot tell whether anything was recorded.",
      changedBy: "This screen is read again to show where things stand. Send again only if nothing changed.",
    },
  }),
);

function refusalFor(name: string): Refusal {
  const known = REFUSALS[name];
  if (known !== undefined) return known;
  return {
    heading: "The service refused this",
    because: `It gave a reason this screen has not been taught to put into words: "${name}". Nothing is assumed about whether anything was recorded.`,
    changedBy: "This screen is read again to show where things stand.",
  };
}

/** One write; null when it was recorded, otherwise the named refusal. Never throws. */
async function post(endpoint: string, body: Record<string, string>): Promise<string | null> {
  let answer: Response;
  try {
    answer = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return DID_NOT_REACH;
  }
  let payload: unknown;
  try {
    payload = await answer.json();
  } catch {
    return UNREADABLE_ANSWER;
  }
  if (answer.ok) return null;
  if (typeof payload === "object" && payload !== null && "refusal" in payload) {
    const named = (payload as { refusal: unknown }).refusal;
    if (typeof named === "string" && named !== "") return named;
  }
  return UNREADABLE_ANSWER;
}

// ---------------------------------------------------------------------------
// Shared presentation
// ---------------------------------------------------------------------------

const mutedTextClass = "max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]";
const fieldClass =
  "min-h-tap w-full min-w-0 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-sm text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] forced-colors:border-[CanvasText]";

/**
 * The one strongly styled control on this screen. Solid danger tokens, never a hex value, and a
 * forced-colours border so it still reads as a button when the palette is replaced.
 */
export const STOP_CONTROL_CLASS =
  "inline-flex min-h-tap min-w-0 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--danger-solid)] bg-[color:var(--danger-solid)] px-4 text-sm font-semibold text-[color:var(--danger-solid-contrast)] transition-colors hover:bg-[color:var(--danger-solid-hover)] active:bg-[color:var(--danger-solid-active)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] motion-reduce:transition-none forced-colors:border-[ButtonText]";

function RefusalStatement({ refusal }: { refusal: Refusal }) {
  return (
    <StatedReason
      heading={refusal.heading}
      because={refusal.because}
      changedBy={refusal.changedBy}
      icon={<CircleAlert aria-hidden="true" className="size-icon-md shrink-0" />}
    />
  );
}

// ---------------------------------------------------------------------------
// Stopping all sending
// ---------------------------------------------------------------------------

export type ServiceStopFormProps = {
  endpoint: string;
  reasons: readonly ServiceStopReasonOption[];
  /**
   * The three restart seats, worded on the server from the sealed domain ("the incident lead, the
   * privacy and security owner and the clinical programme lead"), so the confirm step names them in
   * the same words as the banner rather than in a second copy.
   */
  restartSeatsWording: string;
};

type StopPhase = "closed" | "form" | "confirm" | "sending";

export function ServiceStopForm({ endpoint, reasons, restartSeatsWording }: ServiceStopFormProps) {
  const router = useRouter();
  const id = useId();
  const [phase, setPhase] = useState<StopPhase>("closed");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const key = useRef<string | null>(null);
  const confirmHeading = useRef<HTMLHeadingElement>(null);
  const formHeading = useRef<HTMLHeadingElement>(null);

  const chosen = reasons.find((option) => option.value === reason) ?? null;

  const open = () => {
    setPhase("form");
    setRefusal(null);
    requestAnimationFrame(() => formHeading.current?.focus());
  };

  const cancel = () => {
    key.current = null;
    setPhase("closed");
    setProblem(null);
    setRefusal(null);
  };

  const toConfirm = () => {
    const missing =
      chosen === null
        ? "Choose what kind of incident this is."
        : note.trim() === ""
          ? "Write what happened in the incident note."
          : null;
    if (missing !== null) {
      setProblem(missing);
      announce(missing, { priority: "assertive" });
      return;
    }
    setProblem(null);
    setRefusal(null);
    key.current ??= mintKey("SERVICE-STOP");
    setPhase("confirm");
    requestAnimationFrame(() => confirmHeading.current?.focus());
  };

  const back = () => {
    // A different submission from here on, so a different key.
    key.current = null;
    setPhase("form");
    requestAnimationFrame(() => formHeading.current?.focus());
  };

  const stop = async () => {
    if (phase === "sending" || chosen === null) return;
    setPhase("sending");
    setRefusal(null);
    announce("Stopping all sending…", { priority: "polite" });
    const idempotencyKey = (key.current ??= mintKey("SERVICE-STOP"));
    const refused = await post(endpoint, { type: "stop", reason: chosen.value, note, idempotencyKey });
    if (refused === null) {
      key.current = null;
      setPhase("closed");
      setReason("");
      setNote("");
      announce("All sending is stopped for the whole service. It stays stopped until the restart is approved.", {
        priority: "assertive",
      });
    } else {
      const worded = refusalFor(refused);
      setRefusal(worded);
      setPhase("confirm");
      announce(`${worded.heading}. ${worded.because}`, { priority: "assertive" });
    }
    // Either way the state above was read before this, so the screen is read again.
    router.refresh();
  };

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="caring-contacts-service-stop-form">
      {phase === "closed" ? (
        <div>
          <button type="button" onClick={open} className={cn(STOP_CONTROL_CLASS, "w-full sm:w-auto")}>
            <OctagonX aria-hidden="true" className="size-icon-md shrink-0" />
            Stop all sending
          </button>
        </div>
      ) : null}

      {phase === "form" ? (
        <div className="flex min-w-0 flex-col gap-4">
          <h3
            ref={formHeading}
            tabIndex={-1}
            className="text-base font-semibold text-[color:var(--text-heading)] focus-visible:outline-none"
          >
            Record the incident
          </h3>
          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="text-sm font-medium text-[color:var(--text-heading)]">
              What kind of incident is this?
            </legend>
            {reasons.map((option) => {
              const optionId = `${id}-reason-${option.value}`;
              return (
                <label
                  key={option.value}
                  htmlFor={optionId}
                  className="flex min-h-tap min-w-0 cursor-pointer items-start gap-3 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 has-[:checked]:border-[color:var(--danger-border)] has-[:checked]:bg-[color:var(--danger-bg)] forced-colors:border-[CanvasText]"
                >
                  <input
                    id={optionId}
                    type="radio"
                    name={`${id}-reason`}
                    value={option.value}
                    checked={reason === option.value}
                    onChange={() => setReason(option.value)}
                    className="mt-1 size-icon-md shrink-0 accent-[color:var(--danger-solid)]"
                  />
                  <span className="min-w-0 text-sm font-medium text-[color:var(--text)]">
                    {option.label}
                    <span className="block font-normal leading-6 text-[color:var(--text-muted)]">
                      {option.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor={`${id}-note`} className="text-sm font-medium text-[color:var(--text-heading)]">
              Incident note (required)
            </label>
            <p
              id={`${id}-note-hint`}
              className="max-w-[var(--measure)] text-xs leading-5 text-[color:var(--text-muted)]"
            >
              Which message or event this is about, and what was seen. Only staff who may see the reporting team&apos;s
              patient records can read it back; every other team sees only the kind of incident.
            </p>
            <textarea
              id={`${id}-note`}
              aria-describedby={`${id}-note-hint`}
              required
              rows={4}
              maxLength={INCIDENT_NOTE_MAX_LENGTH}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className={fieldClass}
            />
          </div>
          {problem !== null ? (
            <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-[color:var(--danger-text)]">
              <CircleAlert aria-hidden="true" className="size-icon-md shrink-0" />
              <span className="min-w-0">{problem}</span>
            </p>
          ) : null}
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row">
            <button type="button" onClick={toConfirm} className={cn(STOP_CONTROL_CLASS, "w-full sm:w-auto")}>
              Continue
            </button>
            <button type="button" onClick={cancel} className={cn(OVERLAY_TRIGGER_CLASS, "w-full sm:w-auto")}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {(phase === "confirm" || phase === "sending") && chosen !== null ? (
        <div
          className="flex min-w-0 flex-col gap-3 rounded-[var(--radius-md)] border border-[color:var(--danger-border)] bg-[color:var(--danger-bg)] px-4 py-3 forced-colors:border-[CanvasText]"
          data-testid="caring-contacts-service-stop-confirm"
        >
          <h3
            ref={confirmHeading}
            tabIndex={-1}
            className="text-base font-semibold text-[color:var(--danger-text)] focus-visible:outline-none forced-colors:text-[CanvasText]"
          >
            Stop all sending now?
          </h3>
          <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text)]">
            Every scheduled message stops, for every patient and every team, not only yours. Nothing is sent again until
            the restart is approved by three different people: {restartSeatsWording}.
          </p>
          <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text)]">
            <span className="font-medium">Kind of incident: </span>
            {chosen.label}
          </p>
          {refusal !== null ? <RefusalStatement refusal={refusal} /> : null}
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => void stop()}
              aria-disabled={phase === "sending" ? "true" : undefined}
              className={cn(STOP_CONTROL_CLASS, "w-full sm:w-auto")}
            >
              {phase === "sending" ? (
                <Loader2 aria-hidden="true" className="size-icon-md shrink-0 animate-spin motion-reduce:animate-none" />
              ) : (
                <OctagonX aria-hidden="true" className="size-icon-md shrink-0" />
              )}
              {phase === "sending" ? "Stopping all sending…" : "Stop all sending now"}
            </button>
            <button
              type="button"
              onClick={back}
              disabled={phase === "sending"}
              className={cn(OVERLAY_TRIGGER_CLASS, "w-full sm:w-auto")}
            >
              Go back
            </button>
          </div>
        </div>
      ) : null}

      {phase === "closed" && refusal !== null ? <RefusalStatement refusal={refusal} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recording a restart approval
// ---------------------------------------------------------------------------

export type RestartApprovalControlsProps = {
  endpoint: string;
  seats: readonly RestartSeatOption[];
  /** How many seats are still outstanding. When it is one, recording it restarts sending. */
  outstanding: number;
};

type ApprovalPhase =
  | { readonly kind: "idle" }
  | { readonly kind: "confirm"; readonly seat: RestartSeatOption }
  | { readonly kind: "sending"; readonly seat: RestartSeatOption };

export function RestartApprovalControls({ endpoint, seats, outstanding }: RestartApprovalControlsProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<ApprovalPhase>({ kind: "idle" });
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [recorded, setRecorded] = useState<string | null>(null);
  const keys = useRef<Record<string, string>>({});
  const confirmHeading = useRef<HTMLHeadingElement>(null);

  const finalApproval = outstanding === 1;

  const choose = (seat: RestartSeatOption) => {
    setRefusal(null);
    setRecorded(null);
    setPhase({ kind: "confirm", seat });
    requestAnimationFrame(() => confirmHeading.current?.focus());
  };

  const cancel = (seat: RestartSeatOption) => {
    delete keys.current[seat.role];
    setPhase({ kind: "idle" });
  };

  const approve = async (seat: RestartSeatOption) => {
    if (phase.kind === "sending") return;
    setPhase({ kind: "sending", seat });
    setRefusal(null);
    const idempotencyKey = (keys.current[seat.role] ??= mintKey("SERVICE-RESTART"));
    const refused = await post(endpoint, { type: "approveRestart", role: seat.role, idempotencyKey });
    if (refused === null) {
      delete keys.current[seat.role];
      const words = finalApproval
        ? `Your approval as ${seat.wording} is recorded. It was the last one needed, so sending has restarted.`
        : `Your approval as ${seat.wording} is recorded. Sending stays stopped until every seat has approved.`;
      setRecorded(words);
      setPhase({ kind: "idle" });
      announce(words, { priority: "assertive" });
    } else {
      const worded = refusalFor(refused);
      setRefusal(worded);
      setPhase({ kind: "confirm", seat });
      announce(`${worded.heading}. ${worded.because}`, { priority: "assertive" });
    }
    router.refresh();
  };

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="caring-contacts-restart-approval-controls">
      {phase.kind === "idle" ? (
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap">
          {seats.map((seat) => (
            <button
              key={seat.role}
              type="button"
              onClick={() => choose(seat)}
              className={cn(OVERLAY_TRIGGER_CLASS, "w-full sm:w-auto")}
            >
              Approve the restart as {seat.wording}
            </button>
          ))}
        </div>
      ) : (
        <div
          className="flex min-w-0 flex-col gap-3 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-4 py-3 forced-colors:border-[CanvasText]"
          data-testid="caring-contacts-restart-approval-confirm"
        >
          <h3
            ref={confirmHeading}
            tabIndex={-1}
            className="text-base font-semibold text-[color:var(--text-heading)] focus-visible:outline-none"
          >
            Approve the restart as {phase.seat.wording}?
          </h3>
          <p className={mutedTextClass}>
            {finalApproval
              ? "This is the last approval needed. Recording it restarts sending for every team straight away."
              : "Sending stays stopped after this. It restarts only when every seat has approved, each from a different person."}
          </p>
          {refusal !== null ? <RefusalStatement refusal={refusal} /> : null}
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => void approve(phase.seat)}
              aria-disabled={phase.kind === "sending" ? "true" : undefined}
              className={cn(OVERLAY_TRIGGER_CLASS, "w-full sm:w-auto")}
            >
              {phase.kind === "sending" ? (
                <Loader2 aria-hidden="true" className="size-icon-md shrink-0 animate-spin motion-reduce:animate-none" />
              ) : null}
              {phase.kind === "sending" ? "Recording your approval…" : "Record my approval"}
            </button>
            <button
              type="button"
              onClick={() => cancel(phase.seat)}
              disabled={phase.kind === "sending"}
              className={cn(OVERLAY_TRIGGER_CLASS, "w-full sm:w-auto")}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {recorded !== null ? <p className="text-sm font-medium text-[color:var(--text)]">{recorded}</p> : null}
    </div>
  );
}
