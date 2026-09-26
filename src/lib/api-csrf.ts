/**
 * CSRF guard for state-changing `/api/*` requests, shared with `src/proxy.ts`.
 *
 * Pure functions with no imports, no side effects and no module state, so this is
 * safe to import from a Proxy file (see `src/lib/developer-area/headers.ts` for the
 * same constraint).
 *
 * Fetch Metadata is the primary signal: a browser that sends
 * `Sec-Fetch-Site: cross-site` is rejected outright. It is not the only signal,
 * because two shapes slip past it (audit 2026-09-02, L28):
 *
 *   - `same-site` covers every sibling subdomain of the registrable domain, so a
 *     hostile host under the same domain is vouched for by the browser.
 *   - user agents without Fetch Metadata send no `Sec-Fetch-Site` at all, so the
 *     header check simply does not run.
 *
 * In both cases the browser still sends `Origin` on a cross-origin state-changing
 * request, so an `Origin` host that does not match the host the request was
 * addressed to is rejected. `Referer` is consulted only when there is neither
 * Fetch Metadata nor an `Origin` — the shape an old browser produces. A request
 * carrying none of the three is a non-browser client (curl, a server-to-server
 * call, the ingestion worker) and passes: CSRF needs a browser to be tricked, and
 * blocking here would break every API client instead.
 *
 * This is defence in depth. The session cookies @supabase/ssr writes are
 * `SameSite=Lax`, so a cross-site POST does not carry the session in the first
 * place.
 */

const CSRF_GUARDED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Whether a request is a state-changing API call the guard covers.
 *
 * `/api/webhooks/**` is excluded: those callers are third-party services that
 * authenticate with a signed payload and never send browser headers.
 */
export function isCsrfGuardedApiRequest(method: string, pathname: string): boolean {
  if (!CSRF_GUARDED_METHODS.has(method.toUpperCase())) return false;
  return pathname.startsWith("/api/") && !pathname.startsWith("/api/webhooks/");
}

export type ApiMutationCsrfVerdict =
  { allowed: true } | { allowed: false; reason: "cross_site" | "origin_mismatch" | "referer_mismatch" };

const ALLOWED: ApiMutationCsrfVerdict = { allowed: true };

/** The host of an absolute URL, lowercased, or null when it is not parsable. */
function hostOfUrl(value: string): string | null {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Every host this request may legitimately have been addressed to.
 *
 * `requestHost` is the proxy's own view of the URL. `Host` and `X-Forwarded-Host`
 * are included because Railway terminates TLS in front of the app, so the URL the
 * browser used (and therefore the Origin it sends) is the forwarded host rather
 * than the internal one. `X-Forwarded-Host` may be a comma-separated chain; the
 * first entry is the original client-facing host.
 */
function addressedHosts(headers: Headers, requestHost: string): Set<string> {
  const hosts = new Set<string>();
  const add = (value: string | null | undefined) => {
    const normalized = value?.split(",")[0]?.trim().toLowerCase();
    if (normalized) hosts.add(normalized);
  };
  add(requestHost);
  add(headers.get("host"));
  add(headers.get("x-forwarded-host"));
  return hosts;
}

/**
 * Whether a state-changing API request may proceed.
 *
 * `requestHost` is the host from the request URL; `Host` / `X-Forwarded-Host` are
 * read from `headers` and count too.
 */
export function apiMutationCsrfVerdict(headers: Headers, requestHost: string): ApiMutationCsrfVerdict {
  const secFetchSite = headers.get("sec-fetch-site");
  if (secFetchSite === "cross-site") return { allowed: false, reason: "cross_site" };

  const hosts = addressedHosts(headers, requestHost);

  // Present on every cross-origin state-changing browser request, including the
  // `same-site` ones Fetch Metadata vouches for. An opaque `null` Origin (sandboxed
  // iframe, some redirect chains) does not parse and is therefore rejected.
  const origin = headers.get("origin");
  if (origin !== null) {
    const originHost = hostOfUrl(origin);
    return originHost && hosts.has(originHost) ? ALLOWED : { allowed: false, reason: "origin_mismatch" };
  }

  // Fetch Metadata already said same-origin/same-site/none and there is no Origin
  // to contradict it. Referer is deliberately not consulted here: it is the weaker
  // signal and is routinely stripped by privacy settings.
  if (secFetchSite !== null) return ALLOWED;

  const referer = headers.get("referer");
  if (referer !== null) {
    const refererHost = hostOfUrl(referer);
    return refererHost && hosts.has(refererHost) ? ALLOWED : { allowed: false, reason: "referer_mismatch" };
  }

  // No Fetch Metadata, no Origin, no Referer: not a browser.
  return ALLOWED;
}
