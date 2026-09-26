import { z } from "zod";

import { isAccessObjectIdShape } from "@/lib/caring-contacts/access-audit";

/**
 * The body `POST /api/caring-contacts/plans/[planId]/contacts/[contactId]` accepts.
 *
 * ## Why this is a module of its own rather than a `const` in the route
 *
 * THREE CALLERS SHARE ONE DEFINITION, and naming them exactly matters -- an earlier version of this
 * comment claimed the client and the boundary shared it while the client hand-built an object
 * literal and imported nothing at all. A comment that outlives the thing it described is the failure
 * this phase keeps paying for, so here is the list:
 *
 *   * the ROUTE validates a request against `contactMoveRequestSchema` and answers 400 when it does
 *     not parse;
 *   * the CLIENT (`contact-time-adjustment.tsx`) annotates the body it builds with
 *     {@link ContactMoveRequestBody}, so a renamed or dropped field is a COMPILE error at the call
 *     site rather than a round trip;
 *   * the DOM suite's mirror of the route validates with the same schema, so a body-shape regression
 *     reddens where it happens.
 *
 * The first two are the guarantee; the third is what stops a test double from drifting away from the
 * thing it stands in for. Before this module existed the mirror parsed the body by hand and never
 * looked at `action` at all, so a client-side regression was invisible to every suite.
 *
 * WHERE IT CAN LIVE is decided for it rather than chosen. It cannot live in the route: that module
 * reaches `server-only` and `next/headers`, so no jsdom test could load it. It cannot live in
 * `src/lib/caring-contacts/`: nothing under that tree may import anything non-relative, which rules
 * out Zod. This file is the remaining place -- plain validation, no React, no server imports, and one
 * non-relative import of the sealed domain's own id-shape predicate.
 *
 * ## `.strict()`, and the two things it is doing
 *
 * A discriminated union of ONE member, strict. A second kind of reschedule is a new member carrying
 * its own required fields, never an optional field bolted on to this one — `changeContactDate` needs
 * a reason and a recorded team-lead approver, and an optional approval field is precisely the shape
 * that lets an approval be omitted. Strict also means an EXTRA field is a refusal rather than
 * something silently dropped, so a client sending more than the route will act on finds out.
 *
 * Nothing here decides whether a time is acceptable. `toHour` and `toMinute` are checked for being a
 * wall-clock hour and minute AT ALL, which is a fact about the shape of a request;
 * `moveContactWithinDay` in the sealed domain owns both rules that matter — the move must stay on the
 * contact's own AWST calendar day, and the instant must fall inside the approved send window — and
 * refuses each by its own name. A copy of `09:00-18:00` here would be a second copy of a rule the
 * domain already holds, free to drift from it.
 */
export const contactMoveRequestSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("moveWithinDay"),
      toHour: z.number().int().min(0).max(23),
      toMinute: z.number().int().min(0).max(59),
      expectedContactVersion: z.number().int().positive(),
      /**
       * Constrained to the audit trail's own id grammar, the same way `auditableIdentifier` does it
       * at the route boundary: free text is refused here rather than travelling into the audit path,
       * where it would be rejected too late to matter.
       */
      idempotencyKey: z.string().refine(isAccessObjectIdShape, { message: "must be an identifier, not free text" }),
    })
    .strict(),
]);

export type ContactMoveRequestBody = z.infer<typeof contactMoveRequestSchema>;
