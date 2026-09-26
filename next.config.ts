import type { NextConfig } from "next";

import { buildSecurityHeaders, resolveRuntimeFlags } from "./src/lib/security-headers";

// Standalone extract: PsychSift's next.config.ts also carried Sentry and knowledge-base
// settings that Caring Contacts does not use. The security headers are kept. The per-request
// Content-Security-Policy is emitted from src/proxy.ts, because a nonce cannot be a build-time
// constant.
const securityHeaders = buildSecurityHeaders(resolveRuntimeFlags());

// Only the isolated Playwright build may redirect the output folder (see src/instrumentation.ts).
const requestedDistDir = process.env.NEXT_DIST_DIR?.trim();
if (requestedDistDir && !/^\.next-playwright\/[a-z0-9-]+\/dist$/i.test(requestedDistDir)) {
  throw new Error("NEXT_DIST_DIR must be an owned .next-playwright/<run-id>/dist directory.");
}

const nextConfig: NextConfig = {
  distDir: requestedDistDir || ".next",
  allowedDevOrigins: ["127.0.0.1"],
  devIndicators: false,
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      {
        // The design prototypes must never appear in search results.
        source: "/mockups/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
