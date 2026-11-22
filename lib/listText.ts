// Lists of numbers written out in captions (the sieve demos on /how-it-works).

/** "4, 6, 8, 10, 12, …, 120": every value when there are at most eight, else the first five and the last. */
export function shortList(values: readonly number[]): string {
  if (values.length <= 8) return values.join(", ");
  return `${values.slice(0, 5).join(", ")}, …, ${values[values.length - 1]}`;
}

/** "2", "2 and 3", "2, 3 and 5". */
export function andList(values: readonly number[]): string {
  return values.length <= 1 ? values.join("") : `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}
