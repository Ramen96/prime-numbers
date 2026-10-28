// Shared helpers for the native sieve tests (sieve_test.c, sieve_slow_test.c).
//
// The independent reference is a Miller–Rabin test in unsigned __int128,
// sharing no code with the sieve. With the first 13 primes (2 to 41) as bases
// it has no false "prime" below 3,317,044,064,679,887,385,961,981 (OEIS
// A014233, a(13); J. Sorenson and J. Webster, "Strong Pseudoprimes to Twelve
// Prime Bases", Math. Comp. 86 (2017), https://arxiv.org/abs/1509.00864),
// far above anything these tests reach (about 2^65).

#ifndef SIEVE_TEST_SUPPORT_H
#define SIEVE_TEST_SUPPORT_H

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef unsigned __int128 u128;

// ── wasm/sieve.c, as the tests see it ────────────────────────────────────

uint32_t *request_buffer(size_t limb_count);
int sieve_next(size_t request_limb_count, int count);
int sieve_prev(size_t request_limb_count, int count);
uint32_t *batch_base_limbs(void);
size_t batch_base_limb_count(void);
uint64_t *batch_offset_buffer(void);
int batch_reached_memory_limit(void);
int batch_reached_proven_bound(void);
size_t batch_rejected_count(void);
uint64_t *batch_rejected_distances(void);
uint32_t *batch_rejected_evidence(void);
void set_sieve_prime_cap(uint64_t cap);
uint64_t base_prime_limit(void);
int extend_base_primes(uint64_t limit);
void set_base_prime_memory_budget(size_t bytes);
size_t base_prime_memory_bytes(void);
int reserve_base_prime_storage(size_t bytes);
uint64_t base_prime_limit(void);
void set_parallel_threshold(size_t checkpoints);
int sieve_start_helpers(int count); // SIEVE_THREADS builds only
// SIEVE_TEST_HOOKS only
void sieve_force_multi_limb_windows(int force);
int sieve_test_gap_encoding_round_trip(const uint64_t *primes, size_t count);
int sieve_test_base_primes_consistent(void);
size_t measured_parallel_threshold(void);

#define BATCH_SIZE 500
#define MAX_PRIMES 8192
#define TWO_TO_THE_32 ((u128)1 << 32)
#define TWO_TO_THE_53 ((u128)1 << 53)
#define TWO_TO_THE_64 ((u128)1 << 64)

static int checks_run = 0;
static int checks_failed = 0;

static void print_u128(FILE *stream, u128 value) {
  char digits[50];
  int length = 0;
  do {
    digits[length++] = (char)('0' + (int)(value % 10));
    value /= 10;
  } while (value);
  while (length)
    fputc(digits[--length], stream);
}

static void fail(const char *test_name, const char *what, u128 expected, u128 actual) {
  checks_failed++;
  if (checks_failed > 20)
    return;
  fprintf(stderr, "FAIL %s: %s, expected ", test_name, what);
  print_u128(stderr, expected);
  fprintf(stderr, ", got ");
  print_u128(stderr, actual);
  fprintf(stderr, "\n");
}

static void expect(const char *test_name, const char *what, u128 expected, u128 actual) {
  checks_run++;
  if (expected != actual)
    fail(test_name, what, expected, actual);
}

// ── reference: Miller–Rabin in unsigned __int128 ─────────────────────────

// (a · b) mod m without overflowing 128 bits, by doubling. Slow, but simple
// and obviously right; only needed for moduli of 2^64 or more.
static u128 multiply_mod(u128 a, u128 b, u128 m) {
  if (m <= UINT64_MAX)
    return (a % m) * (b % m) % m;
  u128 result = 0;
  a %= m;
  while (b) {
    if (b & 1) {
      result = result >= m - a ? result - (m - a) : result + a;
    }
    a = a >= m - a ? a - (m - a) : a + a;
    b >>= 1;
  }
  return result;
}

static u128 power_mod(u128 base, u128 exponent, u128 modulus) {
  u128 result = 1;
  base %= modulus;
  while (exponent) {
    if (exponent & 1)
      result = multiply_mod(result, base, modulus);
    base = multiply_mod(base, base, modulus);
    exponent >>= 1;
  }
  return result;
}

static int is_prime_reference(u128 candidate) {
  static const u128 witnesses[] = {2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41};
  if (candidate < 2)
    return 0;
  for (size_t i = 0; i < sizeof witnesses / sizeof *witnesses; i++) {
    if (candidate % witnesses[i] == 0)
      return candidate == witnesses[i];
  }
  u128 odd_part = candidate - 1;
  int powers_of_two = 0;
  while ((odd_part & 1) == 0) {
    odd_part >>= 1;
    powers_of_two++;
  }
  for (size_t i = 0; i < sizeof witnesses / sizeof *witnesses; i++) {
    u128 value = power_mod(witnesses[i], odd_part, candidate);
    if (value == 1 || value == candidate - 1)
      continue;
    int composite = 1;
    for (int round = 1; round < powers_of_two; round++) {
      value = multiply_mod(value, value, candidate);
      if (value == candidate - 1) {
        composite = 0;
        break;
      }
    }
    if (composite)
      return 0;
  }
  return 1;
}

// Up to `count` primes after (or before) `from`, ascending, by checking every
// number in turn. Returns how many.
static int reference_primes(int next, u128 from, int count, u128 *primes) {
  int found = 0;
  if (next) {
    for (u128 candidate = from + 1; found < count; candidate++)
      if (is_prime_reference(candidate))
        primes[found++] = candidate;
    return found;
  }
  u128 descending[MAX_PRIMES];
  for (u128 candidate = from; found < count && candidate > 2;) {
    candidate--;
    if (is_prime_reference(candidate))
      descending[found++] = candidate;
  }
  for (int i = 0; i < found; i++)
    primes[i] = descending[found - 1 - i];
  return found;
}

// ── calling the sieve ────────────────────────────────────────────────────

// Asks the sieve for primes after (or before) `from`, as limbs, and rebuilds
// each prime as batch base + offset. Returns how many.
static int sieve_primes(int next, u128 from, int count, u128 *primes) {
  uint32_t *limbs = request_buffer(4);
  for (int i = 0; i < 4; i++)
    limbs[i] = (uint32_t)(from >> (32 * i));
  int written = next ? sieve_next(4, count) : sieve_prev(4, count);
  u128 base = 0;
  for (size_t i = batch_base_limb_count(); i-- > 0;)
    base = (base << 32) | batch_base_limbs()[i];
  const uint64_t *offsets = batch_offset_buffer();
  for (int i = 0; i < written; i++)
    primes[i] = base + offsets[i];
  return written;
}

// The sieve's batch must equal the reference's, prime for prime.
static void check_batch(const char *test_name, int next, u128 from, int count) {
  static u128 expected[MAX_PRIMES], actual[MAX_PRIMES];
  int expected_count = reference_primes(next, from, count, expected);
  int actual_count = sieve_primes(next, from, count, actual);
  expect(test_name, "how many primes", (u128)expected_count, (u128)actual_count);
  expect(test_name, "no memory limit", 0, (u128)batch_reached_memory_limit());
  for (int i = 0; i < expected_count && i < actual_count; i++) {
    checks_run++;
    if (expected[i] != actual[i]) {
      fail(test_name, "prime", expected[i], actual[i]);
      return;
    }
  }
}

static void check_next(const char *test_name, u128 after, int count) { check_batch(test_name, 1, after, count); }
static void check_prev(const char *test_name, u128 before, int count) { check_batch(test_name, 0, before, count); }

// A published record gap (prime, then the next prime `gap` later): the sieve
// must find exactly that next prime, in both directions.
static void check_record_gap(const char *test_name, u128 prime, unsigned gap) {
  u128 found[2];
  expect(test_name, "the record's first prime is prime", 1, (u128)is_prime_reference(prime));
  int written = sieve_primes(1, prime, 1, found);
  expect(test_name, "next prime after it", prime + gap, written == 1 ? found[0] : 0);
  written = sieve_primes(0, prime + gap, 1, found);
  expect(test_name, "previous prime before the gap's end", prime, written == 1 ? found[0] : 0);
}

// ── partial sieving (Phase 4) ─────────────────────────────────────────────

// a(13) (OEIS A014233): from here up, Miller–Rabin proves nothing
#define PROVEN_BOUND (((u128)0x2be69 << 64) | ((u128)0x51adc5b2 << 32) | 0x2410a5fd)

// The smallest prime factor of odd n, if it's at most `limit` (else 0).
static u128 small_factor(u128 n, uint64_t limit) {
  for (uint64_t divisor = 3; divisor <= limit && (u128)divisor * divisor <= n; divisor += 2)
    if (n % divisor == 0)
      return divisor;
  return 0;
}

// Checks a batch sieved with base primes capped at `cap`: its primes match
// the reference (check_batch), and every odd number it passed over is in
// exactly one place (A2 at the handoff from sieve to Miller–Rabin): a prime it
// reported, a multiple of a base prime up to the cap (crossed off), or a
// composite it rejected with evidence that proves it.
static void check_partial_batch(const char *test_name, int next, u128 from, int count, uint64_t cap) {
  set_sieve_prime_cap(cap);
  check_batch(test_name, next, from, count);
  expect(test_name, "no proven-bound stop", 0, (u128)batch_reached_proven_bound());

  // the range the batch covered, and its rejected candidates as numbers
  static u128 primes[MAX_PRIMES];
  int written = sieve_primes(next, from, count, primes);
  size_t rejected = batch_rejected_count();
  static u128 rejected_numbers[4 * MAX_PRIMES + 4096];
  if (rejected > sizeof rejected_numbers / sizeof *rejected_numbers) {
    fail(test_name, "rejected fewer than expected", 0, rejected);
    return;
  }
  // in ascending order: going up the distances grow, going down they shrink
  for (size_t index = 0; index < rejected; index++) {
    u128 distance = batch_rejected_distances()[next ? index : rejected - 1 - index];
    rejected_numbers[index] = next ? from + distance : from - distance;
  }
  for (size_t index = 1; index < rejected; index++) {
    checks_run++;
    if (rejected_numbers[index] <= rejected_numbers[index - 1]) {
      fail(test_name, "rejected numbers come in order, each once", rejected_numbers[index - 1], rejected_numbers[index]);
      return;
    }
  }
  u128 low = next ? from + 1 : primes[0];
  u128 high = next ? primes[written - 1] : from - 1;

  size_t rejected_seen = 0; // also the next rejected number to meet, walking up
  for (u128 n = low | 1; n <= high; n += 2) {
    if (n < 3 || is_prime_reference(n))
      continue;
    // an odd composite: rejected if and only if no base prime up to the cap divides it
    int crossed_off = small_factor(n, cap) != 0;
    while (rejected_seen < rejected && rejected_numbers[rejected_seen] < n)
      rejected_seen++; // skipped: below the range or not composite, caught by the count below
    int was_rejected = rejected_seen < rejected && rejected_numbers[rejected_seen] == n;
    rejected_seen += was_rejected;
    checks_run++;
    if (crossed_off == was_rejected) {
      fail(test_name, crossed_off ? "crossed off and also rejected" : "composite neither crossed off nor rejected", n, 0);
      return;
    }
  }
  // every rejected number was met as a composite in the range (none skipped above)
  size_t rejected_met = 0;
  for (size_t index = 0; index < rejected; index++)
    rejected_met += rejected_numbers[index] >= low && rejected_numbers[index] <= high &&
                    !is_prime_reference(rejected_numbers[index]);
  expect(test_name, "every rejected number is a composite in the range", rejected, rejected_met);
  // each one's evidence proves it composite: a factor, or a Miller–Rabin witness
  for (size_t index = 0; index < rejected; index++) {
    u128 n = rejected_numbers[index];
    uint32_t evidence = batch_rejected_evidence()[next ? index : rejected - 1 - index]; // same order as above
    u128 odd_part = n - 1;
    int powers_of_two = 0;
    while (!(odd_part & 1)) {
      odd_part >>= 1;
      powers_of_two++;
    }
    u128 value = power_mod(evidence, odd_part, n);
    int passes = value == 1 || value == n - 1;
    for (int round = 1; round < powers_of_two && !passes; round++) {
      value = multiply_mod(value, value, n);
      passes = value == n - 1;
    }
    checks_run++;
    if (!(n % evidence == 0 || !passes))
      fail(test_name, "rejected number's evidence proves it composite", n, evidence);
  }
}

// At the proven bound: sieving up from `distance` below a(13), every prime
// below it is reported; the first survivor from a(13) up is unsettled, so the
// batch stops there, saying why. Nothing is found going down from above it.
static void check_proven_bound(u128 distance) {
  static u128 expected[MAX_PRIMES], actual[MAX_PRIMES];
  u128 from = PROVEN_BOUND - distance;
  int expected_count = 0; // the primes from `from` up to the bound, and no further
  for (u128 candidate = from + 1; candidate < PROVEN_BOUND && expected_count < MAX_PRIMES; candidate++)
    if (is_prime_reference(candidate))
      expected[expected_count++] = candidate;
  int actual_count = sieve_primes(1, from, MAX_PRIMES, actual);
  expect("at the proven bound", "every prime below it", (u128)expected_count, (u128)actual_count);
  for (int index = 0; index < expected_count && index < actual_count; index++)
    expect("at the proven bound", "prime", expected[index], actual[index]);
  expect("at the proven bound", "says it reached the bound", 1, (u128)batch_reached_proven_bound());
  expect("at the proven bound", "not the memory limit", 0, (u128)batch_reached_memory_limit());
  if (actual_count > 0) {
    expect("past the proven bound", "next finds nothing", 0, (u128)sieve_primes(1, actual[actual_count - 1], 10, actual));
    expect("past the proven bound", "and says why", 1, (u128)batch_reached_proven_bound());
  }
  expect("past the proven bound", "prev from above finds nothing", 0, (u128)sieve_primes(0, PROVEN_BOUND + 100000, 10, actual));
  expect("past the proven bound", "and says why, going down", 1, (u128)batch_reached_proven_bound());
}

// In a threaded build, SIEVE_TEST_HELPERS=n starts n helper threads and
// splits every window across them, however few base primes it needs.
static void start_test_threads(void) {
#ifdef SIEVE_THREADS
  // SIEVE_TEST_MEASURE=1 leaves the threshold to be measured, as in the app
  const char *requested = getenv("SIEVE_TEST_HELPERS");
  int helpers = requested ? atoi(requested) : 0;
  if (helpers > 0) {
    printf("threads: %d helpers started\n", sieve_start_helpers(helpers));
    if (!getenv("SIEVE_TEST_MEASURE"))
      set_parallel_threshold(1);
  }
#endif
}

static int report(const char *suite_name) {
  printf("%s: %d checks, %d failed\n", suite_name, checks_run, checks_failed);
  return checks_failed == 0 ? 0 : 1;
}

#endif
