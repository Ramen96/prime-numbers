// Shareable jump links: /?jump=1000000000000 opens the list at that number.

import { shortestWriting } from "./wholeNumberExpression.ts";

export const JUMP_PARAMETER = "jump";

/**
 * A parameter's value in a query string, or null if it isn't there. Decoded
 * without URLSearchParams' “+ means space”: a hand-typed ?jump=10^100+7 must
 * keep its plus, or with spaces ignored it would read as 10^1007. (Addresses
 * this site writes encode “+” as %2B and spaces as %20, so they read the same.)
 */
export function queryParameterFrom(queryString: string, name: string): string | null {
  for (const pair of queryString.replace(/^\?/, "").split("&")) {
    const separator = pair.indexOf("=");
    const key = separator === -1 ? pair : pair.slice(0, separator);
    if (key !== name) continue;
    const value = separator === -1 ? "" : pair.slice(separator + 1);
    try {
      return decodeURIComponent(value);
    } catch {
      return value; // a stray “%”: the box shows it, and says it isn't a number
    }
  }
  return null;
}

/** What's after ?jump= in a URL's query string, or null if it isn't there. */
export function jumpParameterFrom(queryString: string): string | null {
  return queryParameterFrom(queryString, JUMP_PARAMETER);
}

/**
 * The name of the jump box and the prime checker's box in a form the browser
 * sent itself, before the page's script ran: /?number=2%5E127+-+1. Form encoding
 * writes a space as “+” (and a plus as %2B), so it's read that way, unlike
 * ?jump= and ?n=, where a typed “+” is a plus. The page then writes the usual address.
 */
export const FORM_NUMBER_PARAMETER = "number";

/** The number a form sent itself (?number=), read with form encoding, or null. */
export function formNumberFrom(queryString: string): string | null {
  return new URLSearchParams(queryString).get(FORM_NUMBER_PARAMETER);
}

/** What to jump to from the address: ?jump=, or else a form's ?number=, or null. */
export function typedJumpFrom(queryString: string): string | null {
  return jumpParameterFrom(queryString) ?? formNumberFrom(queryString);
}

/**
 * The current URL with ?jump= set to `target`, or removed when the jump goes
 * back to the start of the list (anything up to 2, the first prime). `written`
 * is how it was typed, if not as a plain number (“1e100”): it's used when it's
 * shorter than the digits, so a link to 10^1000000 stays short.
 */
export function urlForJump(currentUrl: string, target: bigint, written: string | null = null): string {
  const url = new URL(currentUrl);
  url.searchParams.delete(FORM_NUMBER_PARAMETER); // a form's ?number= becomes ?jump=
  if (target <= 2n) url.searchParams.delete(JUMP_PARAMETER);
  else url.searchParams.set(JUMP_PARAMETER, shortestWriting(target, written));
  return url.pathname + url.search + url.hash;
}
