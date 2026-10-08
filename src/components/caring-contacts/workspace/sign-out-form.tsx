"use client";

import type { ReactNode } from "react";

import { signOutBrowserSession } from "@/lib/caring-contacts-browser-session";

export function SignOutForm({ children }: { children: ReactNode }) {
  // The form is outside the wizard's gate, so revoking readers leaves its native POST mounted.
  return (
    <form action="/api/caring-contacts/auth/sign-out" method="post" onSubmit={signOutBrowserSession}>
      {children}
    </form>
  );
}
