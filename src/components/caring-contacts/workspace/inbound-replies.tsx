// src/components/caring-contacts/workspace/inbound-replies.tsx
//
// Incoming text messages (2026-09-26): where a patient's reply to the service's number reaches a
// person. Two surfaces, both Server Components with no hooks of their own:
//
//   * `RepliesToCheck`, on the Today screen beside the team's other review work -- every reply not
//     yet marked followed up, oldest first. It shows WHICH plan and WHAT KIND, never the words: the
//     list read (`listOpenInboundReplies`) does not release them, so a team-wide screen is not a
//     place a patient's text sits on display. "Review patient" opens the plan, where it is read.
//   * `PatientReplies`, on the patient's own page -- this plan's replies with their words, and the
//     "Mark followed up" control (`InboundReplyFollowUpButton`, the only client part).
//
// A STOP-style reply is shown as a stop request, and whether the plan was paused by it is stated
// plainly: the pause is automatic, what happens next is not. Nothing here resumes, withdraws or
// changes a plan -- those stay on the plan's own actions.
//
// Words avoided on purpose (tests/helpers/caring-contacts-prohibited-language.ts): this is not a
// messaging product, so there is no "inbox" and no "conversation", and nothing claims replies are
// watched in real time. They are checked when a person next opens the workspace.
import { ArrowRight, MessageSquareReply, OctagonPause } from "lucide-react";
import Link from "next/link";

import { patientPlanRoute } from "@/lib/caring-contacts-routes";
import type { InboundReplyKind, InboundReplyRecord, InboundReplyWithText } from "@/lib/caring-contacts/inbound-replies";

import { awstDateTimeWording } from "./date-wording";
import { InboundReplyFollowUpButton } from "./inbound-reply-follow-up-button";
import { workspacePanel, workspacePanelPadded } from "./surfaces";

const badgeClass =
  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-sm)] px-2 py-0.5 text-xs font-medium";

export const INBOUND_REPLY_KIND_LABELS: Readonly<Record<InboundReplyKind, string>> = Object.freeze({
  reply: "Reply",
  optOutRequest: "Stop request",
});

/**
 * "10:05 am AWST on 26 September 2026" -- the workspace's own date-time wording, always Perth time.
 * It used to be an `Intl.DateTimeFormat`, whose month abbreviation depends on the runtime's ICU data
 * ("Sep" or "Sept"); `awstDateTimeWording` spells the month out and reads the same everywhere.
 */
export function formatReplyInstant(instant: Date): string {
  return awstDateTimeWording(instant.toISOString());
}

function KindBadge({ reply }: { reply: InboundReplyRecord }) {
  if (reply.kind === "optOutRequest") {
    return (
      <span className={`${badgeClass} bg-[color:var(--warning-bg)] text-[color:var(--warning-text)]`}>
        <OctagonPause aria-hidden="true" className="size-icon-xs" />
        {INBOUND_REPLY_KIND_LABELS.optOutRequest}
        {reply.planPaused ? " · plan paused" : ""}
      </span>
    );
  }
  return (
    <span className={`${badgeClass} bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]`}>
      <MessageSquareReply aria-hidden="true" className="size-icon-xs" />
      {INBOUND_REPLY_KIND_LABELS.reply}
    </span>
  );
}

/** What an opt-out did to the plan, in one sentence. */
function stopRequestNote(reply: InboundReplyRecord): string {
  return reply.planPaused
    ? "This reply looked like a request to stop messages, so the plan was paused automatically. Nothing was withdrawn. A person decides whether to resume, change or withdraw the plan."
    : "This reply looked like a request to stop messages. The plan was not running when it arrived, so nothing was paused. A person decides what happens next.";
}

// ---------------------------------------------------------------------------
// Today screen
// ---------------------------------------------------------------------------

export function RepliesToCheck({ replies }: { replies: readonly InboundReplyRecord[] }) {
  const stopRequests = replies.filter((reply) => reply.kind === "optOutRequest").length;
  return (
    <section
      aria-labelledby="replies-to-check-heading"
      data-testid="caring-contacts-replies-to-check"
      className="space-y-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="replies-to-check-heading" className="text-base font-semibold text-[color:var(--text-heading)]">
          Replies to check
        </h2>
        <span className="text-xs text-[color:var(--text-muted)]">
          {replies.length} waiting · {stopRequests} {stopRequests === 1 ? "stop request" : "stop requests"}
        </span>
      </div>
      {replies.length === 0 ? (
        <div className={`${workspacePanelPadded} text-sm text-[color:var(--text-muted)]`}>
          No patient replies are waiting for a person.
        </div>
      ) : (
        <ul className={`${workspacePanel} divide-y divide-[color:var(--border)] overflow-hidden`}>
          {replies.map((reply) => (
            <li
              key={reply.id}
              data-testid="caring-contacts-reply-to-check"
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono text-xs font-medium text-[color:var(--text-heading)]">
                  {reply.patientId}
                </span>
                <KindBadge reply={reply} />
                <span className="text-xs text-[color:var(--text-muted)]">
                  Received {formatReplyInstant(reply.receivedAt)}
                </span>
              </div>
              <Link
                href={patientPlanRoute(reply.patientId, reply.planId)}
                data-internal-link="true"
                className="inline-flex min-h-tap items-center gap-1 whitespace-nowrap text-xs font-medium text-[color:var(--command)] hover:underline"
              >
                Review patient <ArrowRight aria-hidden="true" className="size-icon-xs" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Patient page
// ---------------------------------------------------------------------------

export type PatientRepliesProps = {
  replies: readonly InboundReplyWithText[];
  /** Whether the acting role holds `followUpInboundReply`. Decided by the page, never here. */
  mayFollowUp: boolean;
};

export function PatientReplies({ replies, mayFollowUp }: PatientRepliesProps) {
  if (replies.length === 0) return null;
  const open = replies.filter((reply) => reply.followedUpAt === null).length;
  return (
    <section
      aria-labelledby="caring-contacts-patient-replies-heading"
      data-testid="caring-contacts-patient-replies"
      className={workspacePanelPadded}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2
          id="caring-contacts-patient-replies-heading"
          className="text-base font-semibold text-[color:var(--text-heading)]"
        >
          Replies from the patient
        </h2>
        <span className="text-xs text-[color:var(--text-muted)]">{open} not yet followed up</span>
      </div>
      <p className="mt-1 text-sm text-[color:var(--text-muted)]">
        Texts this patient sent to the service&rsquo;s number. Each sender was sent the automatic reply naming 000,
        Lifeline and the Mental Health Emergency Response Line.
      </p>
      <ul className="mt-4 space-y-3">
        {replies.map((reply) => (
          <li
            key={reply.id}
            data-testid="caring-contacts-patient-reply"
            className="rounded-[var(--radius-md)] border border-[color:var(--border)] px-4 py-3 forced-colors:border-[CanvasText]"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <KindBadge reply={reply} />
              <span className="text-xs text-[color:var(--text-muted)]">
                Received {formatReplyInstant(reply.receivedAt)}
              </span>
            </div>
            {reply.text === "" ? (
              <p className="mt-2 text-sm italic text-[color:var(--text-muted)]">
                The words of this reply were removed when the patient&rsquo;s details were cleared.
              </p>
            ) : (
              <blockquote className="mt-2 whitespace-pre-wrap break-words border-l-2 border-[color:var(--border)] pl-3 text-sm text-[color:var(--text)]">
                {reply.text}
              </blockquote>
            )}
            {reply.kind === "optOutRequest" ? (
              <p className="mt-2 text-xs text-[color:var(--text-muted)]">{stopRequestNote(reply)}</p>
            ) : null}
            <div className="mt-3">
              {reply.followedUpAt !== null ? (
                <p className="text-xs text-[color:var(--text-muted)]">
                  Followed up {formatReplyInstant(reply.followedUpAt)}
                </p>
              ) : mayFollowUp ? (
                <InboundReplyFollowUpButton planId={reply.planId} replyId={reply.id} version={reply.version} />
              ) : (
                <p className="text-xs text-[color:var(--text-muted)]">
                  Not yet followed up. Marking a reply followed up is not part of the role you are acting in.
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
