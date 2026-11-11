import { formatWholeNumber } from "@/lib/formatNumber";

/**
 * A number with thousands separators that may wrap onto more lines, but only
 * after a comma, never in the middle of a digit group. Primes can have any
 * number of digits (CLAUDE.md, Requirement B), so nothing can assume one line.
 *
 * Each digit group is its own text node, with a <wbr> after every comma. The
 * markup is built as one string rather than as one React element per group:
 * with hundreds of thousands of groups, React took minutes (169 s for a
 * million digits in a production build), and the browser alone takes well under
 * a second. It's safe as markup: it holds only the digits and commas of a BigInt.
 */
export function WrappableNumber({ value }: { value: bigint | null }) {
  if (value === null) return "—";
  return <span dangerouslySetInnerHTML={{ __html: formatWholeNumber(value).replaceAll(",", ",<wbr>") }} />;
}
