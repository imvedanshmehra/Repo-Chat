/** Header a bring-your-own Anthropic key travels in. */
export const API_KEY_HEADER = "x-anthropic-key";

/**
 * Reads the caller's key off a request. Never log, store or echo the result —
 * it is used for the lifetime of the request and then dropped.
 */
export function apiKeyFromRequest(request: Request): string | undefined {
  const value = request.headers.get(API_KEY_HEADER)?.trim();
  return value ? value : undefined;
}
