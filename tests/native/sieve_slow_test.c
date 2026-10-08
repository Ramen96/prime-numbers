// Slow native tests for wasm/sieve.c: around 2^64, where windows go from two
// limbs to three and the multi-limb path takes over. Sieving there needs every
// base prime up to 2^32 (about 203 million of them, ~200 MB), so this suite
// takes a while and isn't part of `npm test`.
//
// Run with: npm run test:native:slow

#include "sieve_test_support.h"

static void test_crossing_two_to_the_64(void) {
  // Up across 2^64, starting where only the multi-limb path is used...
  check_next("next across 2^64", TWO_TO_THE_64 - 30000, 1500);
  // ...and where the uint64_t fast path runs right up to 2^64 first.
  check_next("next up to and across 2^64 (fast path near the top)", TWO_TO_THE_64 - 200000, 6000);
  // Down across 2^64, and from exactly 2^64.
  check_prev("prev across 2^64", TWO_TO_THE_64 + 30000, 1500);
  check_prev("prev before 2^64", TWO_TO_THE_64, 3000);
  // Just above 2^64: three-limb windows only.
  check_next("next after 2^64 + 1", TWO_TO_THE_64 + 1, 1000);
  check_prev("prev before 2^64 + 70,000", TWO_TO_THE_64 + 70000, 1000);
}

static void test_record_gaps_near_two_to_the_64(void) {
  // Maximal prime gaps: the gap (OEIS A005250, https://oeis.org/A005250/b005250.txt)
  // and the prime that starts it (OEIS A002386, https://oeis.org/A002386/b002386.txt).
  // Entry 80, below 2^64:
  check_record_gap("record gap 1550 (below 2^64)", (u128)18361375334787046697ULL, 1550);
  // Entry 83, above 2^64 (20,733,746,510,561,442,863 = 2^64 + 2,287,002,436,851,891,247):
  check_record_gap("record gap 1676 (above 2^64)", TWO_TO_THE_64 + (u128)2287002436851891247ULL, 1676);
}

static void test_prime_count_up_to_two_to_the_32(void) {
  // π(2^32). Source: OEIS A007053, https://oeis.org/A007053/b007053.txt
  static u128 batch[MAX_PRIMES];
  u128 count = 0, after = 0;
  for (;;) {
    int written = sieve_primes(1, after, MAX_PRIMES, batch);
    int done = 0;
    for (int i = 0; i < written; i++) {
      if (batch[i] > TWO_TO_THE_32) {
        done = 1;
        break;
      }
      count++;
    }
    if (done)
      break;
    after = batch[written - 1];
  }
  expect("π(2^32) matches OEIS A007053", "count", 203280221, count);
}

int main(void) {
  start_test_threads();
  test_crossing_two_to_the_64();
  test_record_gaps_near_two_to_the_64();
  test_prime_count_up_to_two_to_the_32();
  return report("native sieve slow tests");
}
