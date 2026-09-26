// src/app/api/caring-contacts/auth/sign-in/route.ts
//
// Live-mode staff sign-in, step 1: sends the browser to the organisation's identity provider.
// `?returnTo=/caring-contacts/...` says where to land afterwards (workspace paths only). Answers
// 404 outside live mode, so demo mode is unchanged. See src/lib/caring-contacts-server/oidc.ts.
import type { NextRequest } from "next/server";

import { startSignIn } from "@/lib/caring-contacts-server/oidc";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return startSignIn(request);
}
