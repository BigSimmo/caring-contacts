import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { PlanState } from "@/lib/caring-contacts/model";

import {
  planActionRefusalNameFrom,
  planActionRefusalWording,
  PLAN_ACTION_TRANSPORT_REFUSALS,
  type PlanActionRefusal,
} from "../plan-action-rules";
import {
  mintPatientUpdateIdempotencyKey,
  recordFromUpdateAnswer,
  type MobileCheckView,
  type PatientUpdateId,
} from "./patient-update-rules";

/** What a surface here last did, held so it is stated where the coordinator is looking. */
export type PatientUpdateOutcome =
  | { readonly kind: "recorded"; readonly update: PatientUpdateId; readonly announcement: string }
  | { readonly kind: "refused"; readonly update: PatientUpdateId; readonly refusal: PlanActionRefusal };

type HeldPlan = { state: PlanState; version: number; mobileCheck: MobileCheckView };

export type PlanUpdateSent = { ok: true; payload: unknown } | { ok: false };

/**
 * The plan-write mechanics the plan actions already use, for the writes in this folder.
 *
 * The same four things, for the same reasons `plan-actions.tsx` gives at length:
 *
 *   * THE VERSION IS HELD HERE, updated from each answer, and reconciled with the page's props when
 *     a server render brings a newer one -- so a second change in a row is not refused as
 *     `stale-version` when nobody else touched the plan;
 *   * ONE IDEMPOTENCY KEY PER SUBMISSION, kept for a retry of the same body and replaced for a
 *     different one, so a press repeated after a lost connection replays rather than records twice;
 *   * ONE WRITE AT A TIME from each surface;
 *   * `router.refresh()` after every answer, so the rest of the screen is read again.
 */
export function usePlanUpdate(initial: HeldPlan) {
  const router = useRouter();
  const [plan, setPlan] = useState<HeldPlan | null>(initial);
  const [pending, setPending] = useState<PatientUpdateId | null>(null);
  const [outcome, setOutcome] = useState<PatientUpdateOutcome | null>(null);

  // A newer server render wins over what this surface holds; an older one never does.
  const [fromServer, setFromServer] = useState(initial);
  if (
    fromServer.state !== initial.state ||
    fromServer.version !== initial.version ||
    fromServer.mobileCheck.state !== initial.mobileCheck.state ||
    fromServer.mobileCheck.sentAt !== initial.mobileCheck.sentAt
  ) {
    setFromServer(initial);
    setPlan((current) => (current !== null && current.version > initial.version ? current : initial));
  }

  const keys = useRef<Partial<Record<PatientUpdateId, { fingerprint: string; key: string }>>>({});
  const live = useRef({ plan, pending });
  useEffect(() => {
    live.current = { plan, pending };
  }, [plan, pending]);

  const send = useCallback(
    async (
      update: PatientUpdateId,
      url: string,
      bodyWith: (expectedVersion: number, idempotencyKey: string) => object,
      announcement: (payload: unknown) => string,
    ): Promise<PlanUpdateSent> => {
      const held = live.current.plan;
      if (live.current.pending !== null) {
        setOutcome({ kind: "refused", update, refusal: ANOTHER_CHANGE_ON_ITS_WAY });
        return { ok: false };
      }
      if (held === null) {
        setOutcome({ kind: "refused", update, refusal: PLAN_NOT_KNOWN });
        router.refresh();
        return { ok: false };
      }

      const fingerprint = JSON.stringify(bodyWith(held.version, ""));
      const remembered = keys.current[update];
      const key =
        remembered !== undefined && remembered.fingerprint === fingerprint
          ? remembered.key
          : mintPatientUpdateIdempotencyKey(update);
      keys.current[update] = { fingerprint, key };

      live.current = { ...live.current, pending: update };
      setPending(update);
      try {
        const sent = await post(url, bodyWith(held.version, key));
        if (!sent.ok) {
          setOutcome({ kind: "refused", update, refusal: planActionRefusalWording(sent.refusal) });
          return { ok: false };
        }
        delete keys.current[update];
        const answered = recordFromUpdateAnswer(sent.payload);
        setPlan(
          answered === null
            ? null
            : {
                state: answered.state,
                version: answered.version,
                mobileCheck: answered.mobileCheck ?? held.mobileCheck,
              },
        );
        const landed = announcement(sent.payload);
        setOutcome({
          kind: "recorded",
          update,
          announcement:
            answered === null
              ? `${landed} The answer itself could not be read here, so read this screen again before making another change.`
              : landed,
        });
        return { ok: true, payload: sent.payload };
      } finally {
        live.current = { ...live.current, pending: null };
        setPending(null);
        router.refresh();
      }
    },
    [router],
  );

  return { plan, pending, outcome, setOutcome, send };
}

const ANOTHER_CHANGE_ON_ITS_WAY: PlanActionRefusal = Object.freeze({
  heading: "Another change to this plan is still on its way to the service",
  because:
    "A change made a moment ago has not been answered yet, and this one would be worked out against the plan as it stood before it. Nothing was changed on this plan and nothing was sent to anybody.",
  changedBy: "Waiting for the answer to the change already on its way.",
});

const PLAN_NOT_KNOWN: PlanActionRefusal = Object.freeze({
  heading: "This screen no longer knows the plan as the service sees it",
  because:
    "A change made from here was carried out and its answer could not be read, so this screen cannot say which version of the plan it would be acting on. Nothing was changed on this plan and nothing was sent to anybody.",
  changedBy: "Reading this screen again so it holds the plan as it now stands.",
});

export async function post(
  url: string,
  requestBody: unknown,
): Promise<{ ok: true; payload: unknown } | { ok: false; refusal: string }> {
  let answer: Response;
  try {
    answer = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
  } catch {
    return { ok: false, refusal: PLAN_ACTION_TRANSPORT_REFUSALS.didNotReach };
  }
  let payload: unknown;
  try {
    payload = await answer.json();
  } catch {
    return { ok: false, refusal: PLAN_ACTION_TRANSPORT_REFUSALS.unreadableAnswer };
  }
  if (!answer.ok) return { ok: false, refusal: planActionRefusalNameFrom(payload) };
  return { ok: true, payload };
}
