export type MetadataBaseOptions = {
  configuredSiteUrl?: string;
  trustedDeploymentDomain?: string;
  allowRequestOrigin?: boolean;
};

/**
 * Parses a value as an HTTP or HTTPS URL.
 *
 * @param value - The URL value to parse.
 * @returns The parsed URL when it uses HTTP or HTTPS; `undefined` otherwise.
 */
function httpUrl(value: string | undefined) {
  const candidate = value?.trim();
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolves the base URL used for metadata generation.
 *
 * Sources are considered in order: configured site URL, trusted deployment domain,
 * and the request origin when explicitly enabled.
 *
 * @param requestHeaders - Headers used to derive the request origin.
 * @param options - Configuration controlling the fallback sources.
 * @returns A valid HTTP or HTTPS metadata base URL, or `undefined` when none can be resolved.
 */
export function resolveMetadataBase(requestHeaders: Headers, options: MetadataBaseOptions = {}) {
  const configuredUrl = httpUrl(options.configuredSiteUrl);
  if (configuredUrl) return configuredUrl;

  const deploymentDomain = options.trustedDeploymentDomain?.trim();
  const deploymentUrl = httpUrl(
    deploymentDomain?.includes("://") ? deploymentDomain : deploymentDomain ? `https://${deploymentDomain}` : undefined,
  );
  if (deploymentUrl) return deploymentUrl;

  if (!options.allowRequestOrigin) return undefined;
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || requestHeaders.get("host")?.trim();
  if (!host) return undefined;
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "https" ? forwardedProtocol : "https";
  return httpUrl(`${protocol}://${host}`);
}
