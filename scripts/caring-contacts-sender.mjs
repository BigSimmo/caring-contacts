#!/usr/bin/env node
// scripts/caring-contacts-sender.mjs -- `npm run sender`
//
// Runs the Caring Contacts scheduled sender on a timer by calling the app's own protected route,
// POST /api/caring-contacts/dispatch-run, every CARING_CONTACTS_SENDER_INTERVAL_SECONDS (default
// 300). The sending itself happens inside the app, so this works the same whether the app keeps
// its data in memory (the demo) or in Postgres. Running two of these at once is safe: each contact
// is claimed by exactly one run.
//
//   CARING_CONTACTS_SENDER_URL                 the app's address, e.g. https://caring.example.gov.au
//                                              (http is allowed only for 127.0.0.1 / localhost)
//   CARING_CONTACTS_SENDER_SECRET              the same secret the app has
//   CARING_CONTACTS_SENDER_INTERVAL_SECONDS    optional, default 300, minimum 30
//
//   npm run sender                      loop until stopped (Ctrl+C)
//   npm run sender -- --once            one run, then exit (for cron)
//   npm run sender -- --test-to 04xx…   send ONE staff connection-test message to that number, then exit
//
// It prints counts and reason codes only -- never a name, a phone number or message text.

const args = process.argv.slice(2);
const once = args.includes("--once");
const testIndex = args.indexOf("--test-to");
const testTo = testIndex >= 0 ? args[testIndex + 1] : undefined;

function fail(message) {
  console.error(`caring-contacts sender: ${message}`);
  process.exit(1);
}

const baseRaw = process.env.CARING_CONTACTS_SENDER_URL?.trim();
const secret = process.env.CARING_CONTACTS_SENDER_SECRET?.trim();
if (!baseRaw) fail("set CARING_CONTACTS_SENDER_URL to the app's address.");
if (!secret || secret.length < 32) fail("set CARING_CONTACTS_SENDER_SECRET (at least 32 characters, same as the app).");
if (testIndex >= 0 && !testTo) fail("--test-to needs a mobile number.");

let base;
try {
  base = new URL(baseRaw);
} catch {
  fail("CARING_CONTACTS_SENDER_URL is not a valid address.");
}
const loopback = base.hostname === "127.0.0.1" || base.hostname === "localhost";
if (base.protocol !== "https:" && !(base.protocol === "http:" && loopback)) {
  fail(
    "CARING_CONTACTS_SENDER_URL must be https (http only for 127.0.0.1 or localhost), so the secret is never sent in the clear.",
  );
}
const endpoint = new URL("/api/caring-contacts/dispatch-run", base);

const intervalSeconds = Math.max(30, Number(process.env.CARING_CONTACTS_SENDER_INTERVAL_SECONDS ?? 300) || 300);

async function call(body) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5 * 60 * 1000),
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

async function runOnce() {
  const stamp = new Date().toISOString();
  try {
    const { status, payload } = await call({ mode: "run" });
    if (status !== 200) {
      console.error(`${stamp} run refused: HTTP ${status} ${payload.refusal ?? ""} ${payload.error ?? ""}`.trim());
      return false;
    }
    const counts = Object.entries(payload.counts ?? {})
      .map(([kind, count]) => `${kind}=${count}`)
      .join(" ");
    console.log(
      `${stamp} transport=${payload.transport} ${payload.serviceStopped ? "SERVICE STOPPED: nothing sent" : counts || "nothing due"}`,
    );
    return true;
  } catch (error) {
    console.error(`${stamp} run failed: ${error?.name ?? "error"}`);
    return false;
  }
}

if (testTo) {
  const { status, payload } = await call({ mode: "connectionTest", to: testTo });
  console.log(
    `connection test: HTTP ${status} transport=${payload.transport ?? "?"} outcome=${payload.outcome ?? payload.refusal ?? "?"}${payload.reason ? ` reason=${payload.reason}` : ""}`,
  );
  process.exit(status === 200 && payload.outcome === "accepted" ? 0 : 1);
}

if (once) process.exit((await runOnce()) ? 0 : 1);

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    console.log("caring-contacts sender: stopping after the current run.");
  });
}
console.log(`caring-contacts sender: calling ${endpoint.origin} every ${intervalSeconds} seconds.`);
while (!stopping) {
  await runOnce();
  for (let waited = 0; waited < intervalSeconds && !stopping; waited += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
