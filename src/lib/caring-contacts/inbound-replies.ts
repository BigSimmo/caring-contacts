// src/lib/caring-contacts/inbound-replies.ts
//
// Incoming text messages: what a reply to this service's number MEANS, and nothing about how it
// arrived. The carrier's format lives in ./transport/inbound.ts, the orchestration in
// ./inbound-receiver.ts, and the storage in the two stores. This module holds the rules both
// stores and the receiver consult, so none of them answers a rule its own way.
//
// THE OWNER'S REQUEST (2026-09-26), in his words: "Incoming texts vanish. Add an automatic 'this
// number isn't monitored, call 000, Lifeline or the Mental Health Emergency Response Line' reply.
// Treat STOP as a pause for a person to review, because 'stop, I can't do this anymore' is
// ambiguous." Four rulings follow from it, and each is written down beside the code that holds it:
//
//   1. EVERY REPLY FROM A KNOWN PATIENT IS A "REPLY TO CHECK" FOR A PERSON, not only STOP. A reply
//      is the one moment this one-way programme hears from the person it exists for, and whether it
//      carries risk is a clinical judgement nobody can make without reading it. So the words are
//      stored (readable only by the roles that may read the patient's record) and shown to staff
//      until someone marks the item followed up.
//   2. AN OPT-OUT PAUSES; IT NEVER WITHDRAWS OR CANCELS. "STOP" from a person in suicide aftercare
//      can mean "unsubscribe" or "I can't go on". A pause stops further caring messages at once and
//      keeps the schedule intact; a person then calls the patient and either resumes the plan or
//      withdraws it WITH the patient's agreement. Nothing here, and no system actor anywhere, may
//      withdraw or cancel a plan because of a text message.
//   3. THE AUTOMATIC REPLY GOES TO EVERYONE, INCLUDING NUMBERS THIS SERVICE HAS NEVER HELD. It is a
//      safety message, and whether a sender is a patient is not something the sender should be able
//      to learn from the reply -- so the wording is the same for all of them
//      (`INBOUND_AUTO_REPLY_MESSAGE` in ./message-copy.ts). For an unknown number NOTHING is kept
//      except what the loop guard needs: a keyed hash of the number and the instant it was last
//      answered, dropped once the window has passed.
//   4. AT MOST ONE AUTOMATIC REPLY PER SENDING NUMBER PER WINDOW. Two automatic responders texting
//      each other would otherwise loop for ever, at this service's expense and in its name. The
//      limit is held by the STORE, not in process memory, so it holds across instances.
import { createHash, createHmac, randomUUID } from "node:crypto";

import { actorId, type ActorId, type PatientId, type PlanId, type TeamId } from "./ids";
import { TERMINAL_PLAN_STATES, type PlanState, type TransitionResult } from "./model";
import type { Actor, SystemActor } from "./permissions";

/** What a reply is, for the person reviewing it. Never more than these two. */
export const INBOUND_REPLY_KINDS = Object.freeze(["reply", "optOutRequest"] as const);
export type InboundReplyKind = (typeof INBOUND_REPLY_KINDS)[number];

/**
 * The opt-out keywords, as the owner listed them. Matched case-insensitively against the whole
 * message after trimming, collapsing inner whitespace and dropping trailing punctuation; "OPT-OUT"
 * and "OPTOUT" are read as "OPT OUT".
 */
export const OPT_OUT_KEYWORDS: readonly string[] = Object.freeze([
  "STOP",
  "STOP ALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
  "OPT OUT",
]);

/** Zero-width and byte-order characters a phone keyboard or a carrier can leave in a message. */
const INVISIBLE_CHARACTERS = /[​-‍⁠﻿]/g;

function normaliseForKeywordMatch(text: string): string {
  return text
    .normalize("NFKC")
    .replace(INVISIBLE_CHARACTERS, "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[\s.!,;:]+$/u, "")
    .toUpperCase()
    .replace(/^OPT[- ]?OUT$/u, "OPT OUT");
}

/**
 * Whether a reply is an opt-out request.
 *
 * TWO RULES, BOTH THE OWNER'S. The whole message is one of `OPT_OUT_KEYWORDS`; or it STARTS with
 * the word "stop" -- "Stop, I can't do this anymore", "STOP texting me", "stop please". The second
 * rule is deliberately generous: a pause is the conservative direction, because a paused plan
 * costs one phone call to resume and a message sent to someone who asked it to stop cannot be
 * unsent. It is still a WORD match ("stopped", "stopping" and "unstoppable" are ordinary replies),
 * and a message that merely CONTAINS "stop" later on ("I can't stop crying") is an ordinary reply --
 * it still becomes a reply to check, and a person reads it, which is what it needs.
 */
export function classifyInboundReply(text: string): InboundReplyKind {
  const normalised = normaliseForKeywordMatch(text);
  if (OPT_OUT_KEYWORDS.includes(normalised)) return "optOutRequest";
  if (/^STOP\b/u.test(normalised)) return "optOutRequest";
  return "reply";
}

/**
 * The longest reply text kept, in characters. A concatenated SMS rarely exceeds a few hundred;
 * Telstra caps an outgoing message at 1600. Anything longer is kept to this length rather than
 * refused -- losing a patient's words entirely would be worse than losing the end of them. The
 * Postgres column carries the same number as a backstop (migration 0021).
 */
export const INBOUND_REPLY_TEXT_MAX_LENGTH = 2000;

/**
 * The text a reply is stored as: trimmed, and cut to `INBOUND_REPLY_TEXT_MAX_LENGTH` characters
 * (whole code points, so an emoji is never split). Null for a blank message -- a carrier callback
 * with no words in it is nothing a person can read, and the receiver records nothing for it.
 */
export function admitInboundReplyText(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const characters = [...trimmed];
  return characters.length <= INBOUND_REPLY_TEXT_MAX_LENGTH
    ? trimmed
    : // Trimmed again after the cut, so admitting an admitted text changes nothing: both stores
      // re-admit the text they are handed and refuse it if that changes it.
      characters.slice(0, INBOUND_REPLY_TEXT_MAX_LENGTH).join("").trimEnd();
}

/** A reply's identifier: `reply-` and a URL-safe token. Never derived from the number or the text. */
export const INBOUND_REPLY_ID_PATTERN = /^reply-[A-Za-z0-9_-]{8,64}$/;

export function isInboundReplyId(value: string): boolean {
  return INBOUND_REPLY_ID_PATTERN.test(value);
}

/**
 * The identifier one incoming message gets on one plan.
 *
 * DETERMINISTIC WHEN THE CARRIER NAMES THE MESSAGE, so a carrier that posts the same message twice
 * (a retry after a timeout) lands on the same reply and the store's idempotency returns the first
 * answer instead of creating a second item. RANDOM WHEN IT DOES NOT: a key derived from the number
 * and the words would make a second, genuine "STOP" a week later a replay of the first, and it
 * would vanish. A duplicate reply-to-check is the conservative failure; a missing one is not.
 */
export function inboundReplyIdFor(plan: PlanId, carrierMessageId: string | null): string {
  if (carrierMessageId === null) return `reply-${randomUUID()}`;
  const digest = createHash("sha256").update(`inbound-reply-v1\n${plan}\n${carrierMessageId}`).digest("base64url");
  return `reply-${digest.slice(0, 32)}`;
}

/**
 * One reply as a list read releases it: WITHOUT the words. This is also what every write returns,
 * and so what every replay record holds -- the words reach neither (see repository.ts, "what the
 * replay record may hold"). `INBOUND_REPLY_RECORD_HOLDS_NO_TEXT` in ./repository pins it.
 */
export type InboundReplyRecord = {
  id: string;
  planId: PlanId;
  patientId: PatientId;
  teamId: TeamId;
  kind: InboundReplyKind;
  /** When this service received it -- the store's clock, never a time the carrier claimed. */
  receivedAt: Date;
  /** True when THIS reply paused the plan (an opt-out on an active plan). */
  planPaused: boolean;
  /** Null until a person marks it followed up. */
  followedUpAt: Date | null;
  followedUpBy: ActorId | null;
  version: number;
};

/** One reply WITH the patient's words -- released only by the per-plan read on the patient screen. */
export type InboundReplyWithText = InboundReplyRecord & { text: string };

/** A plan a number matched, and only what choosing between matches needs. */
export type InboundReplyPlanMatch = {
  planId: PlanId;
  patientId: PatientId;
  planState: PlanState;
  createdAt: Date;
};

/**
 * Which of a team's matching plans a reply is filed against: ONE per patient.
 *
 * A patient holds at most one open plan (the store contract's own rule), so that one is chosen
 * when it exists -- it is the plan whose messages the person is replying to. A patient with no open
 * plan gets their most recently created one: a reply to the closing message arrives after the plan
 * has completed, and it must still reach a person. Two DIFFERENT patients sharing a number (a
 * family phone) each get their own item, and an opt-out pauses each one's plan: nothing here can
 * tell which of them wrote it, and a person has to ask.
 */
export function choosePlansForInboundReply(matches: readonly InboundReplyPlanMatch[]): InboundReplyPlanMatch[] {
  const byPatient = new Map<string, InboundReplyPlanMatch>();
  for (const match of matches) {
    const current = byPatient.get(match.patientId);
    if (current === undefined || prefer(match, current)) byPatient.set(match.patientId, match);
  }
  return [...byPatient.values()].sort((a, b) => (a.planId < b.planId ? -1 : a.planId > b.planId ? 1 : 0));
}

function prefer(candidate: InboundReplyPlanMatch, current: InboundReplyPlanMatch): boolean {
  const candidateOpen = !TERMINAL_PLAN_STATES.includes(candidate.planState);
  const currentOpen = !TERMINAL_PLAN_STATES.includes(current.planState);
  if (candidateOpen !== currentOpen) return candidateOpen;
  return candidate.createdAt.getTime() > current.createdAt.getTime();
}

/**
 * Whether recording this reply also pauses the plan. Only an opt-out, and only on an ACTIVE plan:
 * a paused plan is already held, a draft has sent nothing (and has no pause transition), and an
 * ended plan sends nothing more. In every other case the item is still recorded and still says it
 * was an opt-out request, so the person reviewing it knows what was asked.
 */
export function optOutPausesPlan(kind: InboundReplyKind, planState: PlanState): boolean {
  return kind === "optOutRequest" && planState === "active";
}

export type RecordInboundReplyInput = {
  planId: PlanId;
  replyId: string;
  /** Already through `admitInboundReplyText`. */
  text: string;
  kind: InboundReplyKind;
};

export type FollowUpInboundReplyInput = { planId: PlanId; replyId: string; expectedVersion: number };

export const INBOUND_REPLY_REFUSALS = Object.freeze({
  alreadyFollowedUp: "inbound-reply-already-followed-up",
  invalidReply: "inbound-reply-invalid",
  /** The reply id is already taken by a DIFFERENT write (a true retry replays instead). */
  alreadyRecorded: "inbound-reply-already-recorded",
} as const);

/**
 * The shape check both stores run on a `recordInboundReply` before touching storage, so neither
 * accepts what the other refuses. The column constraints in migration 0021 are the backstop.
 */
export function admitRecordInboundReplyInput(input: RecordInboundReplyInput): TransitionResult<null> {
  if (!isInboundReplyId(input.replyId)) return { ok: false, reason: INBOUND_REPLY_REFUSALS.invalidReply };
  if (!INBOUND_REPLY_KINDS.includes(input.kind)) return { ok: false, reason: INBOUND_REPLY_REFUSALS.invalidReply };
  if (typeof input.text !== "string" || admitInboundReplyText(input.text) !== input.text) {
    return { ok: false, reason: INBOUND_REPLY_REFUSALS.invalidReply };
  }
  return { ok: true, value: null };
}

/**
 * Marks one reply followed up. Once only: a second mark would overwrite who followed it up and
 * when, which is the one fact this item exists to record.
 */
export function applyInboundReplyFollowUp(
  record: InboundReplyRecord,
  by: ActorId,
  at: Date,
): TransitionResult<InboundReplyRecord> {
  if (record.followedUpAt !== null) return { ok: false, reason: INBOUND_REPLY_REFUSALS.alreadyFollowedUp };
  return {
    ok: true,
    value: { ...record, followedUpAt: new Date(at.getTime()), followedUpBy: by, version: record.version + 1 },
  };
}

// ---------------------------------------------------------------------------------------------
// The automatic-reply loop guard
// ---------------------------------------------------------------------------------------------

/** At most one automatic reply per sending number in this window. */
export const INBOUND_AUTO_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * What the loop guard stores instead of a phone number: an HMAC-SHA256 of the E.164 number, keyed
 * with the inbound webhook's own secret, as unpadded base64url (43 characters).
 *
 * KEYED, NOT A PLAIN HASH. Australian mobile numbers are a space of about a hundred million, so a
 * plain SHA-256 of one is reversed by trying them all in minutes; without the key, this value
 * names nobody. Rotating the secret simply forgets every window, which errs toward one extra
 * automatic reply rather than a missing one.
 */
export function inboundSenderKey(mobileE164: string, secret: string): string {
  return createHmac("sha256", secret).update(`inbound-auto-reply-v1\n${mobileE164}`).digest("base64url");
}

export const INBOUND_SENDER_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

// ---------------------------------------------------------------------------------------------
// The system identities that act on an incoming message
// ---------------------------------------------------------------------------------------------

export const INBOUND_REPLY_ACTOR_ID = actorId("system-inbound-reply-recorder");

/**
 * The two identities the receiver acts as, for one team -- the same split `senderActorsForTeam` in
 * ./sender.ts makes, for the same reason.
 *
 * The RECORDER is the `inboundReplyRecorder` system role, which holds exactly one write,
 * `recordInboundReply` -- the reply item and, for an opt-out on an active plan, the pause, in one
 * atomic, audited write. It cannot resume, withdraw, cancel, reassign or read anything. The
 * READER carries the coordinator's read grants under a system id that names the receiver, because
 * every read in this domain is granted to human roles only; it is used for the number match and
 * nothing else.
 *
 * TEAM BY TEAM. Each identity is scoped to ONE team, so a number is matched against one team's
 * plans at a time, under that team's row-level security, and a reply is only ever filed on a plan
 * of the team whose read found it. Nothing about one team's match is visible to another's.
 */
export function inboundReplyActorsForTeam(team: TeamId): { reader: Actor; recorder: SystemActor } {
  return {
    reader: { id: INBOUND_REPLY_ACTOR_ID, teamId: team, roles: ["coordinator"] },
    recorder: { id: INBOUND_REPLY_ACTOR_ID, teamId: team, systemRole: "inboundReplyRecorder" },
  };
}
