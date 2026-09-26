// Standalone extract: only the Caring Contacts part of PsychSift's src/instrumentation.ts.
// Next.js calls register() once when the server starts. In live (non-demo) mode it refuses to
// start unless the dedicated database, session secret, staff sign-in (OpenID Connect) settings
// and signed governance attestation are all configured.
export async function register() {
  // The comparison is written out in full so the Edge bundle drops the branch, and with it every
  // Node-only import in ./instrumentation-node (the build warning about `node:crypto`).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNode } = await import("./instrumentation-node");
    await registerNode();
  }
}
