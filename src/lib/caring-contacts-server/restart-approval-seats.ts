// src/lib/caring-contacts-server/restart-approval-seats.ts
//
// The governance configuration that names who holds each service-restart approval seat (owner
// decision 2026-09-26: each seat -- incident lead, privacy and security owner, clinical programme
// lead -- must be held by a named staff member listed for it, and all approvers must be different
// people). The sealed domain defines the rule and the roster's shape
// (`RestartApprovalSeatRoster` in ../caring-contacts/service-state); this server seam supplies the
// roster, because the sealed domain may not read environment variables.
//
//   * DEMO: the synthetic roster below, naming the demo actors.
//   * LIVE: `CARING_CONTACTS_RESTART_APPROVAL_SEATS`, a JSON object mapping each seat to a list of
//     staff identifiers (the same identifiers the signed session carries). Unset, blank or
//     malformed means NOBODY holds any seat, so a stopped service stays stopped until an operator
//     configures the seats -- failing closed, never open.
import "server-only";

import { actorId } from "@/lib/caring-contacts/ids";
import {
  NO_RESTART_APPROVAL_SEATS,
  REQUIRED_RESTART_APPROVAL_ROLES,
  type RestartApprovalSeatRoster,
} from "@/lib/caring-contacts/service-state";

import { caringContactsDatabaseUrl } from "./config";
import { demoActorForRole } from "./session";

export const RESTART_APPROVAL_SEATS_VAR = "CARING_CONTACTS_RESTART_APPROVAL_SEATS";

/**
 * The demo's seat holders. Only two demo people hold the `approveServiceRestart` grant at all (the
 * team lead and the clinical programme lead), and no demo person is named privacy and security
 * owner, so -- exactly as before this rule -- a stop raised in the demo cannot be restarted in the
 * same process. That is deliberate: inventing a third demo person to make the restart completable
 * would demonstrate a governance path the configuration does not actually have.
 */
export const DEMO_RESTART_APPROVAL_SEATS: RestartApprovalSeatRoster = Object.freeze({
  incidentLead: Object.freeze([demoActorForRole("teamLead").id]),
  privacySecurityOwner: Object.freeze([]),
  clinicalProgrammeLead: Object.freeze([demoActorForRole("clinicalProgrammeLead").id]),
});

/**
 * Parses the live roster. Returns `NO_RESTART_APPROVAL_SEATS` for anything that is not an object
 * whose every seat, where present, is a list of non-blank strings -- a partly valid value is
 * refused whole rather than half-applied. Never echoes the value.
 */
export function parseRestartApprovalSeats(raw: string | undefined): RestartApprovalSeatRoster {
  if (raw === undefined || raw.trim() === "") return NO_RESTART_APPROVAL_SEATS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NO_RESTART_APPROVAL_SEATS;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NO_RESTART_APPROVAL_SEATS;
  const record = parsed as Record<string, unknown>;
  const roster: Record<string, readonly ReturnType<typeof actorId>[]> = {};
  for (const role of REQUIRED_RESTART_APPROVAL_ROLES) {
    const holders = Object.hasOwn(record, role) ? record[role] : [];
    if (!Array.isArray(holders)) return NO_RESTART_APPROVAL_SEATS;
    if (!holders.every((holder) => typeof holder === "string" && holder.trim() !== "")) {
      return NO_RESTART_APPROVAL_SEATS;
    }
    roster[role] = Object.freeze(holders.map((holder: string) => actorId(holder.trim())));
  }
  return Object.freeze(roster) as RestartApprovalSeatRoster;
}

export function liveRestartApprovalSeats(): RestartApprovalSeatRoster {
  return parseRestartApprovalSeats(process.env[RESTART_APPROVAL_SEATS_VAR]);
}

/**
 * The roster the running store was built with, for a screen that has to say which seats the acting
 * person holds (the service stop screen).
 *
 * The SAME choice `./store.ts` and `./demo-seed.ts` make: the live roster when a database is
 * configured, the demo roster otherwise. It only decides which approval controls are OFFERED; the
 * store still decides every approval against its own roster, so a disagreement here could at worst
 * offer a control the store then refuses by name -- never record an approval it should not.
 */
export function restartApprovalSeatsInForce(): RestartApprovalSeatRoster {
  return caringContactsDatabaseUrl() ? liveRestartApprovalSeats() : DEMO_RESTART_APPROVAL_SEATS;
}
