// src/app/api/caring-contacts/plans/[planId]/contacts/[contactId]/route.ts
//
// One contact of one plan. POST moves it to a different time on the day it is already scheduled
// for -- Phase 2B Task 14's `adjust-date-time`, given somewhere to write.
//
// Next 16: `params` is a Promise and must be awaited. Both segments are synthetic identifiers,
// never a name or a number, so they are safe in the path -- and each is held to the audit trail's
// own id grammar before it goes anywhere near the trail, exactly as `plans/[planId]` holds its own.
//
// THE BODY SHAPE IS NOT DECLARED HERE EITHER, and that is the point of the module it comes from.
// `contactMoveRequestSchema` lives in `src/lib/caring-contacts-contact-move-request.ts` so that the
// client that BUILDS a body and the boundary that REFUSES one are held to a single definition. A
// mirror of this route in a DOM suite that parsed the body by hand made a client-side body-shape
// regression invisible to every suite; see that module's note.
//
// THE DATE CHANGE IS DELIBERATELY NOT OFFERED HERE. `rescheduleContact` accepts either change, but
// `changeContactDate` requires a non-blank reason AND a recorded team-lead approver, and neither is
// something this route could invent for a caller that did not send one: an approval nobody gave is
// the one field on a clinical write that must never be defaulted. A screen that collects both can
// have its own action added to the union below; until one does, the shape simply does not admit it.
//
// NOTHING ABOUT THE WINDOW IS DECIDED HERE. `moveContactWithinDay` in the sealed domain owns both
// rules -- the move must stay on the contact's own AWST calendar day, and the resulting instant
// must fall inside the approved send window -- and refuses each by its own name. The schema below
// checks that the two fields are a wall-clock hour and minute at all, which is a check about the
// SHAPE of a request; a route that also checked 09:00-18:00 would be a second copy of a rule the
// domain already holds, free to drift from it.
import type { NextRequest } from "next/server";

import { contactMoveRequestSchema } from "@/lib/caring-contacts-contact-move-request";
import { invalidRequestResponse, writeContextFor, writeHandler } from "@/lib/caring-contacts-server/handler";
import { isAccessObjectIdShape } from "@/lib/caring-contacts/access-audit";
import { contactId, planId } from "@/lib/caring-contacts/ids";
import { REPOSITORY_REFUSALS } from "@/lib/caring-contacts/repository";

export const runtime = "nodejs";

type ContactRouteContext = { params: Promise<{ planId: string; contactId: string }> };

export async function POST(request: NextRequest, context: ContactRouteContext): Promise<Response> {
  const { planId: plan, contactId: contact } = await context.params;
  // Path segments are caller input like any other, and the contact id becomes this write's audit
  // `objectId`.
  if (!isAccessObjectIdShape(plan) || !isAccessObjectIdShape(contact)) return invalidRequestResponse();

  return writeHandler({
    schema: contactMoveRequestSchema,
    // The capability the store itself checks for a within-day move, not a broader stand-in: a
    // date change needs `changeContactDate`, which this route does not offer.
    action: "moveContactWithinDay",
    access: { objectType: "contact", objectId: () => contact },
    write: async (store, actor, body) => {
      /*
        WHY THIS ROUTE LOOKS THE CONTACT UP, AND WHY THAT LOOKUP IS NOT AN ACCESS EVENT.

        `RescheduleContactInput.change` is a `ContactMoveRequest`, which carries the
        `PlannedContact` being moved -- and BOTH STORES DISCARD IT. Each re-reads the contact it
        holds and hands that to `moveContactWithinDay`, deliberately, so a caller cannot smuggle a
        different calendar day or send instant past the two rules. The field is therefore an input
        no implementation reads, and a route cannot omit it. Fabricating a placeholder for it would
        put a value in the request that says something untrue about the contact; reading the real
        one says nothing untrue and costs a map lookup.

        `handler.ts` states the rule this follows: a read is observable, and so recordable, WHERE IT
        CROSSES A BOUNDARY. Nothing from this lookup is released to the caller -- it goes into an
        argument the store throws away -- so there is no access to record. The write it feeds is
        audited by the store in the ordinary way.

        That the field is dead input is a finding about the repository contract, recorded in the
        Task 14 report rather than fixed here: narrowing it touches both stores and the shared
        contract suite.
      */
      const record = await store.getPlan(planId(plan), { actor });
      const stored = record?.contacts.find((candidate) => candidate.contact.id === contact) ?? null;
      // `not-found` covers "no such contact" and "not this team's" together, which is the same
      // indistinguishability every other refusal in this domain keeps.
      if (stored === null) return { ok: false, reason: REPOSITORY_REFUSALS.notFound };

      return store.rescheduleContact(
        {
          planId: planId(plan),
          contactId: contactId(contact),
          expectedContactVersion: body.expectedContactVersion,
          change: { contact: stored.planned, toHour: body.toHour, toMinute: body.toMinute },
        },
        writeContextFor(actor, body.idempotencyKey),
      );
    },
  })(request);
}
