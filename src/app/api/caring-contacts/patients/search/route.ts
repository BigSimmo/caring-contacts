// src/app/api/caring-contacts/patients/search/route.ts
//
// POST caseload search endpoint (#HDCF2B).
//
// Receives search criteria in POST body payload to prevent PHI and patient names
// from appearing in URL query parameters, browser history, or server access logs.
// Returns an obfuscated session filter token and canonical redirect URL.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { invalidRequestResponse } from "@/lib/caring-contacts-server/handler";
import {
  CaringContactsProductionSessionError,
  isCaringContactsWorkspaceEnabled,
  resolveCaringContactsActor,
} from "@/lib/caring-contacts-server/session";
import { CARING_CONTACTS_ROUTES } from "@/lib/caring-contacts-routes";
import { createSearchFilterToken } from "@/lib/caring-contacts/caseload-search-token";
import {
  PATIENTS_DIRECTORY_FILTER_TOKEN_PARAM,
  PATIENTS_DIRECTORY_STATE_ORDER,
} from "@/lib/caring-contacts/patients-directory-filter";
import { CARING_CONTACTS_STATE_PARAM } from "@/lib/caring-contacts/workspace-address";
import { jsonError, PublicApiError } from "@/lib/http";
import { parseJsonBody } from "@/lib/validation/body";

export const runtime = "nodejs";

const searchRequestSchema = z
  .object({
    query: z.string().default(""),
    state: z
      .enum(["all", ...PATIENTS_DIRECTORY_STATE_ORDER])
      .optional()
      .default("all"),
  })
  .strict();

export async function POST(request: NextRequest): Promise<Response> {
  // Same production lock every other Caring Contacts demo route uses (see
  // `session/route.ts`'s `demoUnavailableResponse`): the actor this route mints a token for comes
  // from the demo role cookie, which does not exist as an authorization boundary outside the demo.
  if (!isCaringContactsWorkspaceEnabled()) return jsonError(new PublicApiError("Not found.", 404), 404, { log: false });

  let body: z.infer<typeof searchRequestSchema>;
  try {
    body = await parseJsonBody(request, searchRequestSchema);
  } catch {
    // The schema-validated helper every sibling Caring Contacts route uses for an unparseable
    // body (see access-trail/route.ts) rather than a route-local `NextResponse.json({ error })`
    // envelope -- `tests/api-validation-contract.test.ts` holds every route under `src/app/api`
    // to that boundary.
    return invalidRequestResponse();
  }

  // A live request with no signed session is the named 401 every other route gives (see
  // `handler.ts`'s `resolveActorOrRefusal`), never an unhandled exception.
  let actor: Awaited<ReturnType<typeof resolveCaringContactsActor>>;
  try {
    actor = await resolveCaringContactsActor();
  } catch (error) {
    if (error instanceof CaringContactsProductionSessionError) {
      return NextResponse.json(
        { refusal: "session-required" },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }
    throw error;
  }
  const query = body.query.trim();
  // Bound to the searching actor (#HDCF2B follow-up): a token minted here can only be redeemed by
  // this same actor later holding `viewPatientRecord` -- see `caseload-search-token.ts`'s module
  // note for why the token itself is not the authorization boundary.
  const filterToken = createSearchFilterToken(query, actor);

  const searchParams = new URLSearchParams();
  if (body.state && body.state !== "all") {
    searchParams.set(CARING_CONTACTS_STATE_PARAM, body.state);
  }
  if (filterToken) {
    searchParams.set(PATIENTS_DIRECTORY_FILTER_TOKEN_PARAM, filterToken);
  }

  const queryString = searchParams.toString();
  const destination =
    queryString === "" ? CARING_CONTACTS_ROUTES.patients : `${CARING_CONTACTS_ROUTES.patients}?${queryString}`;

  return NextResponse.json(
    {
      filterToken,
      destination,
      queryLength: query.length,
      hasFilter: filterToken !== "",
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
