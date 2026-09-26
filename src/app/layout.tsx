import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { cookies, headers } from "next/headers";

import { AppAnnouncements } from "@/components/app-announcements";
import { OverlayRoot } from "@/components/ui/overlay-root";
import { PRIVATE_APP_ROBOTS_METADATA } from "@/lib/crawler-policy";
import { APP_THEME_COLORS, THEME_BOOTSTRAP_SCRIPT, THEME_COOKIE_NAME } from "@/lib/theme";
import "./globals.css";

// Standalone extract: a trimmed copy of PsychSift's root layout. It keeps the fonts, the
// light/dark theme bootstrap, screen-reader announcements and the overlay layer. The original
// also mounted sign-in, PWA and analytics providers that Caring Contacts does not use.
const geistSans = localFont({
  src: "../fonts/geist-latin.woff2",
  variable: "--font-geist-sans",
  display: "swap",
  weight: "100 900",
});

const geistMono = localFont({
  src: "../fonts/geist-mono-latin.woff2",
  variable: "--font-geist-mono",
  display: "swap",
  weight: "100 900",
  preload: false,
});

export const metadata: Metadata = {
  title: "Caring Contacts",
  robots: PRIVATE_APP_ROBOTS_METADATA,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: APP_THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: APP_THEME_COLORS.dark },
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Per-request CSP nonce set by src/proxy.ts. The theme bootstrap below is hand-written, so it
  // must carry the nonce or the strict script-src blocks it.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const isDark = (await cookies()).get(THEME_COOKIE_NAME)?.value === "dark";

  return (
    <html
      lang="en-AU"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased ckb-v2 ${isDark ? "dark" : ""}`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {/* Applies the stored or OS light/dark choice before first paint. */}
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
        {children}
        <AppAnnouncements />
        <OverlayRoot />
      </body>
    </html>
  );
}
