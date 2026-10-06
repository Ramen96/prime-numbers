// Shareable jump links: /?jump=1000000000000 opens the list at that number.

export const JUMP_PARAMETER = "jump";

/** What's after ?jump= in a URL's query string, or null if it isn't there. */
export function jumpParameterFrom(queryString: string): string | null {
  return new URLSearchParams(queryString).get(JUMP_PARAMETER);
}

/**
 * The current URL with ?jump= set to `target`, or removed when the jump goes
 * back to the start of the list (anything up to 2, the first prime).
 */
export function urlForJump(currentUrl: string, target: number): string {
  const url = new URL(currentUrl);
  if (target <= 2) url.searchParams.delete(JUMP_PARAMETER);
  else url.searchParams.set(JUMP_PARAMETER, String(target));
  return url.pathname + url.search + url.hash;
}
