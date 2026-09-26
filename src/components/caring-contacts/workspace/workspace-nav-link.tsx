"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { CARING_CONTACTS_ROUTES } from "@/lib/caring-contacts-routes";

/**
 * Whether `href` is the destination the reader is on. Today is the workspace root, so it matches
 * only exactly; every other destination also owns the screens nested beneath it (a patient's
 * overview is still "Patients", a template's detail is still "Templates").
 */
export function isCurrentWorkspaceDestination(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (href === CARING_CONTACTS_ROUTES.today) return path === href;
  return path === href || path.startsWith(`${href}/`);
}

/**
 * A workspace navigation link that says which destination is open. The shell is a Server Component
 * and cannot read the path, so this one small client leaf does: it sets `aria-current="page"` for
 * assistive technology and a `data-current` hook the shell's classes style, so the rail, the phone
 * dock and the More panel all show where the reader is.
 */
export function WorkspaceNavLink({
  href,
  className,
  children,
}: {
  href: string;
  className: string;
  children: ReactNode;
}) {
  const current = isCurrentWorkspaceDestination(usePathname(), href);
  return (
    <Link
      href={href}
      data-internal-link="true"
      aria-current={current ? "page" : undefined}
      data-current={current ? "true" : undefined}
      className={className}
    >
      {children}
    </Link>
  );
}
