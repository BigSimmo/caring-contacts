"use client";

// src/components/caring-contacts/workspace/inbound-reply-follow-up-button.tsx
//
// Incoming text messages (2026-09-26): the one control that marks a patient's reply as followed
// up -- POST /api/caring-contacts/inbound-replies/<replyId>. It changes nothing about the plan.
//
// ONE IDEMPOTENCY KEY PER BUTTON, minted once and reused, as `plan-actions.tsx` keeps one per
// action: a person who presses again after a timeout replays the first write rather than making a
// second, and the service answers both presses the same way. `expectedVersion` is the version this
// screen rendered, so two people marking the same reply cannot both succeed silently: the second
// is told it has already been followed up. `router.refresh()` then re-reads the page either way.
import { CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { floatingControl } from "@/components/ui-primitives";

import { mintIdempotencyKeyLetters } from "./plan-action-rules";

export const INBOUND_REPLY_FOLLOW_UP_REFUSAL_WORDING: Readonly<Record<string, string>> = Object.freeze({
  "inbound-reply-already-followed-up": "Someone has already marked this reply followed up.",
  "stale-version": "This reply changed after the page was opened. The page has been refreshed.",
  "permission-denied": "Marking a reply followed up is not part of the role you are acting in.",
  "action-not-granted": "Marking a reply followed up is not part of the role you are acting in.",
  "not-found": "This reply could not be found for this team.",
});

const FALLBACK_REFUSAL = "The reply was not marked followed up. Nothing was recorded; try again.";

function followUpEndpoint(replyId: string): string {
  return `/api/caring-contacts/inbound-replies/${encodeURIComponent(replyId)}`;
}

/**
 * Letters only, like every other write key in this workspace. A raw UUID -- or the `Date.now()`
 * fallback on an origin without `crypto.randomUUID` -- can hold a run of digits that the audit
 * guard reads as a possible mobile number and refuses (see `mintIdempotencyKeyLetters`).
 */
function mintKey(): string {
  return `REPLY-FOLLOW-UP-${mintIdempotencyKeyLetters()}`;
}

export type InboundReplyFollowUpButtonProps = {
  planId: string;
  replyId: string;
  version: number;
};

export function InboundReplyFollowUpButton({ planId, replyId, version }: InboundReplyFollowUpButtonProps) {
  const router = useRouter();
  const [key] = useState(mintKey);
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function markFollowedUp() {
    setPending(true);
    setRefusal(null);
    let reason: string | null = null;
    try {
      const answer = await fetch(followUpEndpoint(replyId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, expectedVersion: version, idempotencyKey: key }),
      });
      if (!answer.ok) {
        let payload: unknown = null;
        try {
          payload = await answer.json();
        } catch {
          payload = null;
        }
        const named =
          payload !== null &&
          typeof payload === "object" &&
          typeof (payload as { refusal?: unknown }).refusal === "string"
            ? (payload as { refusal: string }).refusal
            : "";
        reason = INBOUND_REPLY_FOLLOW_UP_REFUSAL_WORDING[named] ?? FALLBACK_REFUSAL;
      }
    } catch {
      reason = FALLBACK_REFUSAL;
    }
    setPending(false);
    if (reason === null) setDone(true);
    else setRefusal(reason);
    router.refresh();
  }

  if (done) {
    return (
      <p role="status" className="text-xs text-[color:var(--text-muted)]">
        Marked followed up.
      </p>
    );
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button type="button" className={floatingControl} disabled={pending} onClick={() => void markFollowedUp()}>
        <CheckCircle2 aria-hidden="true" className="size-icon-sm shrink-0" />
        <span>{pending ? "Marking…" : "Mark followed up"}</span>
      </button>
      {refusal !== null ? (
        <p role="alert" className="text-xs text-[color:var(--warning-text)]">
          {refusal}
        </p>
      ) : null}
    </div>
  );
}
