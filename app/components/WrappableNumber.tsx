import { Fragment } from "react";

const numberFormatter = new Intl.NumberFormat("en-US");

/**
 * A number with thousands separators that may wrap onto more lines, but only
 * after a comma, never in the middle of a digit group. Primes can have any
 * number of digits (CLAUDE.md, Requirement B), so nothing can assume one line.
 */
export function WrappableNumber({ value }: { value: bigint | null }) {
  if (value === null) return "—";
  const digitGroups = numberFormatter.format(value).split(",");
  return digitGroups.map((digitGroup, index) => (
    <Fragment key={index}>
      {index > 0 && (
        <>
          ,<wbr />
        </>
      )}
      {digitGroup}
    </Fragment>
  ));
}
