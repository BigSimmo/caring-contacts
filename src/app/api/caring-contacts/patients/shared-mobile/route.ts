// src/app/api/caring-contacts/patients/shared-mobile/route.ts
//
// POST: how many of this team's open plans already hold a mobile number -- the guard against a
// mistyped number that happens to be another patient's.
//
// A READ that uses POST so the number stays in the body, out of URLs, browser history and access
// logs (the same reason `patients/search` is a POST). It goes through `readHandler`, so it is on
// the access trail like every other read, recorded as a search of the patient directory with a
// fixed object id -- never the number.
//
// Body: { mobile: string, excludePlanId?: string }. Response: { sharedWith: number } -- a count and
// nothing else: no plan id, no name. A value that is not an Australian mobile answers 0.
import type { NextRequest } from "next/server";
import { z } from "zod";

import { auditableIdentifier, invalidRequestResponse, readHandler } from "@/lib/caring-contacts-server/handler";
import { isCaringContactsWorkspaceEnabled } from "@/lib/caring-contacts-server/session";
import { planId } from "@/lib/caring-contacts/ids";
import { parseJsonBody } from "@/lib/validation/body";

export const runtime = "nodejs";

/** The access trail's object id for this read. Fixed, so the number can never become one. */
const OBJECT_ID = "shared-mobile";

const sharedMobileSchema = z
  .object({
    mobile: z.string().max(32),
    excludePlanId: auditableIdentifier.optional(),
  })
  .strict();

function sharedMobileRead(body: z.infer<typeof sharedMobileSchema>) {
  return readHandler({
    access: { kind: "search", objectType: "patientDirectory", objectId: () => OBJECT_ID },
    read: async (store, actor) => ({
      sharedWith: await store.countPlansSharingMobile(
        {
          mobile: body.mobile,
          excludePlanId: body.excludePlanId === undefined ? undefined : planId(body.excludePlanId),
        },
        { actor },
      ),
    }),
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  // The workspace gate comes BEFORE the body is looked at, so a closed workspace answers exactly
  // as every other route does (readHandler's 404) whatever was sent.
  if (!isCaringContactsWorkspaceEnabled()) return sharedMobileRead({ mobile: "" })(request);
  let body: z.infer<typeof sharedMobileSchema>;
  try {
    body = await parseJsonBody(request, sharedMobileSchema);
  } catch {
    return invalidRequestResponse();
  }
  return sharedMobileRead(body)(request);
}
