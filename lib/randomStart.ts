// Uniformly random whole numbers of any size, for the random-prime page: a
// random number with the wanted digits, then the first prime after it.

/** Fills `words` with random 32-bit values. */
export type RandomWords = (words: Uint32Array) => void;

/** The most crypto.getRandomValues fills in one call: 65,536 bytes. */
const MOST_WORDS_PER_CALL = 65_536 / 4;

/** Cryptographically random words, in pieces as large as getRandomValues allows. */
export const cryptoRandomWords: RandomWords = (words) => {
  for (let start = 0; start < words.length; start += MOST_WORDS_PER_CALL)
    crypto.getRandomValues(words.subarray(start, start + MOST_WORDS_PER_CALL));
};

/**
 * A uniformly random whole number from 0 to `limit` − 1, for any `limit` above 0.
 * By rejection: draw as many random bits as `limit` − 1 has, and draw again if the
 * value isn't below `limit`. Each draw succeeds with chance above 1/2, so it takes
 * fewer than two on average, and every value is equally likely.
 */
export function randomBelow(limit: bigint, randomWords: RandomWords = cryptoRandomWords): bigint {
  if (limit <= 0n) throw new RangeError(`randomBelow needs a limit above 0, not ${limit}`);
  const bits = limit === 1n ? 0 : (limit - 1n).toString(2).length;
  if (bits === 0) return 0n;
  const words = new Uint32Array(Math.ceil(bits / 32));
  const bitsInTopWord = bits - 32 * (words.length - 1);
  for (;;) {
    randomWords(words);
    // keep only the bits limit − 1 has: the top word's extra bits are cleared
    words[words.length - 1] &= bitsInTopWord === 32 ? 0xffff_ffff : 2 ** bitsInTopWord - 1;
    let hex = "0x";
    for (let index = words.length - 1; index >= 0; index--) hex += words[index].toString(16).padStart(8, "0");
    const value = BigInt(hex);
    if (value < limit) return value;
  }
}

/**
 * A uniformly random number with exactly `digits` digits (from 10^(digits − 1) to
 * 10^digits − 1; 1 to 9 for one digit), for any whole number of digits from 1 up.
 */
export function randomNumberWithDigits(digits: number, randomWords: RandomWords = cryptoRandomWords): bigint {
  if (!Number.isSafeInteger(digits) || digits < 1) throw new RangeError(`A number needs at least 1 digit, not ${digits}`);
  const smallest = 10n ** BigInt(digits - 1);
  return smallest + randomBelow(9n * smallest, randomWords);
}
