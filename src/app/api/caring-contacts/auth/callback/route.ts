// src/app/api/caring-contacts/auth/callback/route.ts
//
// Live-mode staff sign-in, step 2: the identity provider sends the browser back here. The ID token
// is verified and the person's groups mapped to a role and team before the signed session cookie
// is minted; any failure refuses and mints nothing. See src/lib/caring-contacts-server/oidc.ts.
import type { NextRequest } from "next/server";

import { completeSignIn } from "@/lib/caring-contacts-server/oidc";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return completeSignIn(request);
}
