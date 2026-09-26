// src/app/api/caring-contacts/auth/sign-out/route.ts
//
// Live-mode staff sign-out: clears the session cookie, then ends the identity provider's session
// when it offers that. POST from a form or button (same-origin, checked by src/proxy.ts); GET is
// also answered so a plain "Sign out" link works. See src/lib/caring-contacts-server/oidc.ts.
import { signOut } from "@/lib/caring-contacts-server/oidc";

export const runtime = "nodejs";

export async function POST() {
  return signOut();
}

export async function GET() {
  return signOut();
}
