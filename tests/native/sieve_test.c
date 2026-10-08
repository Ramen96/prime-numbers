// Native tests for wasm/sieve.c (the fast suite, part of `npm test`).
// Every result is checked against an independent Miller–Rabin test (see
// sieve_test_support.h). Built with SIEVE_TEST_HOOKS so the multi-limb window
// path can be forced below 2^64 and checked against the fast path. The slow
// suite (sieve_slow_test.c) covers 2^64 itself.
//
// Run with: npm run test:native

#include "sieve_test_support.h"

#define BOOTSTRAP_LIMIT 65536
#define SEGMENT_SPAN 65536

static void check_around(const char *label, u128 center);

// ── base primes ───────────────────────────────────────────────────────────

// Runs first, while the base primes are still small.
static void test_extending_base_primes(void) {
  const char *name = "extending base primes";
  expect(name, "nothing built before any call", 0, base_prime_limit());

  const uint64_t needed_limit = 20000000; // √(4 × 10^14)
  expect(name, "extend succeeds", 1, (u128)extend_base_primes(needed_limit));
  checks_run++;
  if (base_prime_limit() <= needed_limit)
    fail(name, "limit after extending", needed_limit + 1, base_prime_limit());

  // A batch whose base primes are already there doesn't extend them again.
  uint64_t limit_after_extending = base_prime_limit();
  check_next("next after 4 × 10^14 (base primes already built)", 400000000000000ULL, BATCH_SIZE);
  check_prev("prev before 4 × 10^14 (base primes already built)", 400000000000000ULL, BATCH_SIZE);
  expect(name, "sieving didn't extend them again", limit_after_extending, base_prime_limit());

  expect(name, "ascending, below the limit, checkpoints where they belong", 1, (u128)sieve_test_base_primes_consistent());

  // Asking for less than what's there is a no-op.
  expect(name, "extending to less succeeds", 1, (u128)extend_base_primes(1000));
  expect(name, "and changes nothing", limit_after_extending, base_prime_limit());
}

// How base primes are stored: as gaps, one byte for gaps up to 510 and a
// 9-byte escape above that. Real base primes don't need the escape until
// after 304,599,508,537, so these are synthetic: odd numbers starting at 3
// (the storage assumes it), not primes. The escape must hold any gap below
// 2^64, so the last case spans almost all of it.
static void test_gap_encoding(void) {
  const char *name = "gap encoding round trip";
  static const uint64_t small_gaps[] = {3, 5, 7, 11, 13, 17, 19, 23, 29, 31};
  static const uint64_t largest_one_byte_gap[] = {3, 513, 1023};        // gaps of 510
  static const uint64_t smallest_escaped_gap[] = {3, 515, 517, 1029};    // 512, then 2, then 512
  static const uint64_t gap_past_32_bits[] = {3, 5 + ((uint64_t)1 << 33), 7 + ((uint64_t)1 << 33)};
  static const uint64_t gap_past_56_bits[] = {3, 3 + ((uint64_t)1 << 57), 5 + ((uint64_t)1 << 57)};
  static const uint64_t gap_across_almost_2_to_the_64[] = {3, 5, UINT64_MAX};
  expect(name, "small gaps", 1, (u128)sieve_test_gap_encoding_round_trip(small_gaps, 10));
  expect(name, "largest one-byte gap", 1, (u128)sieve_test_gap_encoding_round_trip(largest_one_byte_gap, 3));
  expect(name, "smallest escaped gap", 1, (u128)sieve_test_gap_encoding_round_trip(smallest_escaped_gap, 4));
  expect(name, "gap past 32 bits", 1, (u128)sieve_test_gap_encoding_round_trip(gap_past_32_bits, 3));
  expect(name, "gap past 56 bits", 1, (u128)sieve_test_gap_encoding_round_trip(gap_past_56_bits, 3));
  expect(name, "gap across almost all of 2^64", 1,
         (u128)sieve_test_gap_encoding_round_trip(gap_across_almost_2_to_the_64, 3));
  // the hook itself can say no: storage always starts at 3
  static const uint64_t not_starting_at_3[] = {5, 7};
  expect(name, "rejects a list not starting at 3", 0, (u128)sieve_test_gap_encoding_round_trip(not_starting_at_3, 2));
  // and it puts the real base primes back
  check_next("next after 10^12 (after the gap hook)", 1000000000000ULL, BATCH_SIZE);
}

// The memory budget, and the rollback when base primes don't fit in it. Runs
// after test_extending_base_primes, so there are base primes to protect.
static void test_memory_budget(void) {
  const char *name = "memory budget";
  uint64_t limit_before = base_prime_limit();

  // reserving: within the budget it allocates exactly that; less is a no-op;
  // over the budget it fails and changes nothing
  size_t reserved = base_prime_memory_bytes() + 100000;
  expect(name, "reserve more", 1, (u128)reserve_base_prime_storage(reserved));
  expect(name, "reserved exactly", reserved, base_prime_memory_bytes());
  expect(name, "reserve less", 1, (u128)reserve_base_prime_storage(1000));
  expect(name, "still reserved", reserved, base_prime_memory_bytes());
  set_base_prime_memory_budget(reserved);
  expect(name, "reserve past the budget", 0, (u128)reserve_base_prime_storage(reserved + 1));
  expect(name, "unchanged after refusing", reserved, base_prime_memory_bytes());

  // a far extension fills what's left, then fails, and must roll back
  expect(name, "extension past the budget fails", 0, (u128)extend_base_primes(limit_before * 100));
  expect(name, "limit unchanged", limit_before, base_prime_limit());
  expect(name, "memory unchanged", reserved, base_prime_memory_bytes());
  expect(name, "rolled back whole, checkpoints too", 1, (u128)sieve_test_base_primes_consistent());
  // the space the failed extension used is free again: a small extension
  // (about 3,000 primes; 100,000 bytes are free) still fits
  expect(name, "small extension fits after rollback", 1, (u128)extend_base_primes(limit_before + 50000));
  checks_run++;
  if (base_prime_limit() <= limit_before + 50000)
    fail(name, "limit after the small extension", limit_before + 50001, base_prime_limit());

  // a batch that needs more base primes than the budget allows stops, says
  // so, and reports nothing it couldn't prove
  static u128 batch[MAX_PRIMES];
  u128 far = (u128)(limit_before * 100) * (limit_before * 100);
  expect(name, "batch past the budget finds nothing", 0, (u128)sieve_primes(1, far, BATCH_SIZE, batch));
  expect(name, "and reports the memory limit", 1, (u128)batch_reached_memory_limit());

  // with the budget lifted, everything works, including where the failed
  // extension had been
  set_base_prime_memory_budget(SIZE_MAX);
  check_next("next past the old budget", far, BATCH_SIZE);
  expect(name, "memory limit cleared", 0, (u128)batch_reached_memory_limit());
  check_around("10^12 after a rolled-back extension", 1000000000000ULL);
}

// ── the start of the list ─────────────────────────────────────────────────

static void test_near_zero(void) {
  char name[64];
  for (unsigned after = 0; after <= 12; after++) {
    snprintf(name, sizeof name, "next after %u", after);
    check_next(name, after, 10);
  }
  for (unsigned before = 0; before <= 14; before++) {
    snprintf(name, sizeof name, "prev before %u", before);
    check_prev(name, before, 10);
  }
  check_next("first 8192 primes", 0, 8192);
  check_prev("everything below 1,000 (stops at 2)", 1000, BATCH_SIZE);
}

// next and prev, each with a small batch and one spanning several segments.
static void check_around(const char *label, u128 center) {
  char name[160];
  snprintf(name, sizeof name, "next after %s", label);
  check_next(name, center, BATCH_SIZE);
  snprintf(name, sizeof name, "prev before %s", label);
  check_prev(name, center, BATCH_SIZE);
  snprintf(name, sizeof name, "next after %s, 8192 primes (several segments)", label);
  check_next(name, center, 8192);
  snprintf(name, sizeof name, "prev before %s, 8192 primes (several segments)", label);
  check_prev(name, center, 8192);
}

// ── coverage at boundaries (Requirement A2) ───────────────────────────────

static void test_boundaries(void) {
  // The bootstrap table's end, and where base primes first grow past it (√2^32).
  check_around("65,536 (bootstrap limit)", BOOTSTRAP_LIMIT);
  check_around("2^32 (one limb to two; base primes extend past the bootstrap)", TWO_TO_THE_32);
  // Segments start wherever a request starts; shift the start across one span.
  for (unsigned offset = 0; offset <= 4; offset++) {
    char label[96];
    snprintf(label, sizeof label, "10^6 + 65,536 + %u", offset);
    check_around(label, 1000000 + SEGMENT_SPAN + offset);
  }
  check_around("10^9", 1000000000ULL);
  check_around("10^12", 1000000000000ULL);
  check_around("10^15", 1000000000000000ULL);
  // 2^53 used to be the sieve's limit; now it's just another number.
  check_around("2^53", TWO_TO_THE_53);
  check_around("2^53 − 3,000", TWO_TO_THE_53 - 3000);
  check_around("2^53 + 3,000", TWO_TO_THE_53 + 3000);
  check_around("10^17", (u128)100000000000000000ULL);
}

// The squares of the largest base primes below √(2^53) are the composites
// that need those base primes most; if they were missing, the squares would
// be reported as prime.
static void test_squares_of_large_base_primes(void) {
  int squares_checked = 0;
  for (u128 base_prime = 94906265; squares_checked < 5; base_prime--) {
    if (!is_prime_reference(base_prime))
      continue;
    u128 square = base_prime * base_prime;
    check_next("next across the square of a large base prime", square - 600, 50);
    check_prev("prev across the square of a large base prime", square + 600, 50);
    squares_checked++;
  }
}

// ── fast path and multi-limb path agree ───────────────────────────────────

// Below 2^64 the sieve normally uses uint64_t windows. Forcing the multi-limb
// window code there must give identical primes (Requirement B).
static void test_multi_limb_path_matches_fast_path(void) {
  static const u128 starts[] = {1000003ULL, 4294967296ULL - 70000, 1000000000000ULL,
                                TWO_TO_THE_53 - 40000, 1000000000000000ULL};
  static u128 fast[MAX_PRIMES], multi_limb[MAX_PRIMES];
  for (size_t index = 0; index < sizeof starts / sizeof *starts; index++) {
    for (int next = 0; next <= 1; next++) {
      sieve_force_multi_limb_windows(0);
      int fast_count = sieve_primes(next, starts[index], 3000, fast);
      sieve_force_multi_limb_windows(1);
      int multi_limb_count = sieve_primes(next, starts[index], 3000, multi_limb);
      sieve_force_multi_limb_windows(0);

      const char *name = next ? "multi-limb next matches fast path" : "multi-limb prev matches fast path";
      expect(name, "count", (u128)fast_count, (u128)multi_limb_count);
      checks_run++;
      if (memcmp(fast, multi_limb, sizeof(u128) * (size_t)fast_count) != 0)
        fail(name, "primes differ from", starts[index], 0);
      check_batch(name, next, starts[index], 3000); // and both match the reference
    }
  }
}

// ── published values (Requirement A4) ─────────────────────────────────────

// Counts the primes up to `limit` by walking the sieve's batches from 0.
static u128 count_primes_up_to(u128 limit) {
  static u128 batch[MAX_PRIMES];
  u128 count = 0, after = 0;
  for (;;) {
    int written = sieve_primes(1, after, MAX_PRIMES, batch);
    for (int i = 0; i < written; i++) {
      if (batch[i] > limit)
        return count;
      count++;
    }
    after = batch[written - 1];
  }
}

static void test_prime_counts(void) {
  // π(10^n) for n = 1..9. Source: OEIS A006880, https://oeis.org/A006880/b006880.txt
  static const u128 primes_below_powers_of_ten[] = {4, 25, 168, 1229, 9592, 78498, 664579, 5761455, 50847534};
  u128 power = 1;
  for (int exponent = 1; exponent <= 9; exponent++) {
    power *= 10;
    expect("π(10^n) matches OEIS A006880", "count", primes_below_powers_of_ten[exponent - 1],
           count_primes_up_to(power));
  }
  // π(2^n) for n = 20, 25, 30. Source: OEIS A007053, https://oeis.org/A007053/b007053.txt
  expect("π(2^20) matches OEIS A007053", "count", 82025, count_primes_up_to((u128)1 << 20));
  expect("π(2^25) matches OEIS A007053", "count", 2063689, count_primes_up_to((u128)1 << 25));
  expect("π(2^30) matches OEIS A007053", "count", 54400028, count_primes_up_to((u128)1 << 30));
}

static void test_record_gaps(void) {
  // Maximal prime gaps: the gap (OEIS A005250, https://oeis.org/A005250/b005250.txt)
  // and the prime that starts it (OEIS A002386, https://oeis.org/A002386/b002386.txt), entries 64 and 65.
  check_record_gap("record gap 1132 (below 2^53)", 1693182318746371ULL, 1132);
  check_record_gap("record gap 1184 (above 2^53)", 43841547845541059ULL, 1184);
}

// ── sweeps ────────────────────────────────────────────────────────────────

#define SWEEP_LIMIT 3000000

static void test_sweeps_against_a_plain_sieve(void) {
  uint8_t *is_prime = malloc(SWEEP_LIMIT + 1);
  memset(is_prime, 1, SWEEP_LIMIT + 1);
  is_prime[0] = is_prime[1] = 0;
  for (uint64_t candidate = 2; candidate * candidate <= SWEEP_LIMIT; candidate++)
    if (is_prime[candidate])
      for (uint64_t multiple = candidate * candidate; multiple <= SWEEP_LIMIT; multiple += candidate)
        is_prime[multiple] = 0;

  static u128 batch[MAX_PRIMES];
  // Forward from 0 in batches of 500: every batch starts where the last ended.
  uint64_t expected = 2;
  u128 after = 0;
  while (expected < SWEEP_LIMIT - 100000) {
    int written = sieve_primes(1, after, BATCH_SIZE, batch);
    for (int i = 0; i < written; i++) {
      checks_run++;
      if (batch[i] != expected) {
        fail("forward sweep", "prime", expected, batch[i]);
        free(is_prime);
        return;
      }
      do expected++; while (!is_prime[expected]);
    }
    after = batch[written - 1];
  }
  // Backward down to 2.
  expected = SWEEP_LIMIT - 100000;
  while (!is_prime[expected]) expected--;
  u128 before = expected + 1;
  int reached_two = 0;
  while (!reached_two) {
    int written = sieve_primes(0, before, BATCH_SIZE, batch);
    if (written == 0)
      break;
    for (int i = written - 1; i >= 0; i--) {
      checks_run++;
      if (batch[i] != expected) {
        fail("backward sweep", "prime", expected, batch[i]);
        free(is_prime);
        return;
      }
      if (expected == 2) {
        reached_two = 1;
        break;
      }
      do expected--; while (!is_prime[expected]);
    }
    before = batch[0];
  }
  expect("backward sweep", "reached 2", 1, (u128)reached_two);
  expect("prev before 2", "finds nothing", 0, (u128)sieve_primes(0, 2, BATCH_SIZE, batch));
  free(is_prime);
}

int main(void) {
  start_test_threads();
  test_extending_base_primes();
  test_gap_encoding();
  test_memory_budget();
  test_near_zero();
  test_boundaries();
  test_squares_of_large_base_primes();
  test_multi_limb_path_matches_fast_path();
  test_prime_counts();
  test_record_gaps();
  test_sweeps_against_a_plain_sieve();
  // after everything, including the rolled-back extensions
  expect("base prime storage", "ascending, below the limit, checkpoints where they belong", 1, (u128)sieve_test_base_primes_consistent());
#ifdef SIEVE_THREADS
  // left to be measured, it must have settled on splitting somewhere: these
  // tests sieve windows needing up to about 2,700 checkpoints (near 2^64 / 4)
  if (getenv("SIEVE_TEST_MEASURE") && getenv("SIEVE_TEST_HELPERS")) {
    printf("measured parallel threshold: %zu checkpoints\n", measured_parallel_threshold());
    checks_run++;
    if (measured_parallel_threshold() == 0)
      fail("measured parallel threshold", "settled on a threshold", 1, 0);
  }
#endif
  return report("native sieve tests");
}
