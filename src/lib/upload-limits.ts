/** Server-side limits and error wording for administrator document uploads. */

/** Hard ceiling for a single uploaded file, in MB. */
export const MAX_UPLOAD_MB_CEILING = 150;

/** The single wording for the API's over-limit response. */
export function uploadSizeLimitMessage(maxUploadMb: number): string {
  return `File exceeds ${maxUploadMb} MB upload limit.`;
}
