// Native tests for wasm/sieve.c, built with the system C compiler.
// Every result is checked against references that share no code with the
// sieve: a deterministic Miller–Rabin test, and a plain array sieve for the
// long sweeps.
//
// Run with: npm run test:native

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int sieve_next(uint64_t after, int count);
int sieve_prev(uint64_t before, int count);
uint64_t *output_buffer(void);
uint64_t base_prime_limit(void);
int extend_base_primes(uint64_t limit);

#define SIEVE_LIMIT 9007199254740991ULL // 2^53 − 1
#define LARGEST_PRIME_BELOW_2_TO_THE_53 9007199254740881ULL
#define BOOTSTRAP_LIMIT 65536ULL
#define SEGMENT_SPAN 65536ULL // numbers covered by one segment (32,768 odd slots)
#define BATCH_SIZE 500
#define MAX_REFERENCE_PRIMES 8192

static int checks_run = 0;
static int checks_failed = 0;

// ── reference: deterministic Miller–Rabin ───────────────────────────────

static uint64_t multiply_mod(uint64_t a, uint64_t b, uint64_t modulus) {
  return (uint64_t)((unsigned __int128)a * b % modulus);
}

static uint64_t power_mod(uint64_t base, uint64_t exponent, uint64_t modulus) {
  uint64_t result = 1;
  base %= modulus;
  while (exponent) {
    if (exponent & 1) result = multiply_mod(result, base, modulus);
    base = multiply_mod(base, base, modulus);
    exponent >>= 1;
  }
  return result;
}

// These 12 bases make Miller–Rabin exact for every n < 3.3 × 10^24.
static int is_prime_reference(uint64_t candidate) {
  static const uint64_t witnesses[] = {2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37};
  if (candidate < 2) return 0;
  for (size_t i = 0; i < sizeof witnesses / sizeof *witnesses; i++) {
    if (candidate % witnesses[i] == 0) return candidate == witnesses[i];
  }
  uint64_t odd_part = candidate - 1;
  int powers_of_two = 0;
  while (odd_part % 2 == 0) {
    odd_part /= 2;
    powers_of_two++;
  }
  for (size_t i = 0; i < sizeof witnesses / sizeof *witnesses; i++) {
    uint64_t x = power_mod(witnesses[i], odd_part, candidate);
    if (x == 1 || x == candidate - 1) continue;
    int composite = 1;
    for (int round = 1; round < powers_of_two; round++) {
      x = multiply_mod(x, x, candidate);
      if (x == candidate - 1) {
        composite = 0;
        break;
      }
    }
    if (composite) return 0;
  }
  return 1;
}

// Up to `count` primes > after (and ≤ 2^53 − 1), ascending.
static int reference_primes_after(uint64_t after, int count, uint64_t *primes) {
  int found = 0;
  for (uint64_t candidate = after + 1; found < count && candidate <= SIEVE_LIMIT; candidate++) {
    if (is_prime_reference(candidate)) primes[found++] = candidate;
  }
  return found;
}

// Up to `count` primes < before, ascending.
static int reference_primes_before(uint64_t before, int count, uint64_t *primes) {
  int found = 0;
  uint64_t descending[MAX_REFERENCE_PRIMES];
  for (uint64_t candidate = before; found < count && candidate > 2;) {
    candidate--;
    if (is_prime_reference(candidate)) descending[found++] = candidate;
  }
  for (int i = 0; i < found; i++) primes[i] = descending[found - 1 - i];
  return found;
}

// ── assertions ──────────────────────────────────────────────────────────

static void fail(const char *test_name, const char *format, unsigned long long a,
                 unsigned long long b) {
  checks_failed++;
  fprintf(stderr, "FAIL %s: ", test_name);
  fprintf(stderr, format, a, b);
  fprintf(stderr, "\n");
}

static void expect_matches_reference(const char *test_name, int written, const uint64_t *expected,
                                     int expected_count) {
  checks_run++;
  const uint64_t *output = output_buffer();
  if (written != expected_count) {
    fail(test_name, "wrote %llu primes, expected %llu", (unsigned long long)written,
         (unsigned long long)expected_count);
    return;
  }
  for (int i = 0; i < written; i++) {
    if (output[i] != expected[i]) {
      fail(test_name, "got %llu where %llu was expected", (unsigned long long)output[i],
           (unsigned long long)expected[i]);
      return;
    }
  }
}

static void check_next(const char *test_name, uint64_t after, int count) {
  static uint64_t expected[MAX_REFERENCE_PRIMES];
  int expected_count = after >= SIEVE_LIMIT ? 0 : reference_primes_after(after, count, expected);
  expect_matches_reference(test_name, sieve_next(after, count), expected, expected_count);
}

static void check_prev(const char *test_name, uint64_t before, int count) {
  static uint64_t expected[MAX_REFERENCE_PRIMES];
  // The sieve stops at its limit, so anything above it behaves like 2^53.
  uint64_t capped_before = before > SIEVE_LIMIT + 1 ? SIEVE_LIMIT + 1 : before;
  int expected_count = before <= 2 ? 0 : reference_primes_before(capped_before, count, expected);
  expect_matches_reference(test_name, sieve_prev(before, count), expected, expected_count);
}

// next and prev, each with a small batch and one spanning several segments.
static void check_around(const char *label, uint64_t center) {
  char test_name[128];
  snprintf(test_name, sizeof test_name, "next after %s", label);
  check_next(test_name, center, BATCH_SIZE);
  snprintf(test_name, sizeof test_name, "prev before %s", label);
  check_prev(test_name, center, BATCH_SIZE);
  snprintf(test_name, sizeof test_name, "next after %s, 8192 primes (several segments)", label);
  check_next(test_name, center, 8192);
  snprintf(test_name, sizeof test_name, "prev before %s, 8192 primes (several segments)", label);
  check_prev(test_name, center, 8192);
}

// ── tests ───────────────────────────────────────────────────────────────

static void test_near_zero(void) {
  for (uint64_t after = 0; after <= 12; after++) {
    char test_name[64];
    snprintf(test_name, sizeof test_name, "next after %llu", (unsigned long long)after);
    check_next(test_name, after, 10);
  }
  for (uint64_t before = 0; before <= 14; before++) {
    char test_name[64];
    snprintf(test_name, sizeof test_name, "prev before %llu", (unsigned long long)before);
    check_prev(test_name, before, 10);
  }
  check_next("first 8192 primes", 0, 8192);
  check_prev("everything below 1,000 (stops at 2)", 1000, BATCH_SIZE);
}

static void test_bootstrap_and_segment_boundaries(void) {
  // The candidates crossing the bootstrap table's end...
  check_around("65,536 (bootstrap limit)", BOOTSTRAP_LIMIT);
  // ...and the point where base primes must first grow past it (√2^32 = 65,536).
  check_around("2^32 (base primes extend past the bootstrap)", BOOTSTRAP_LIMIT * BOOTSTRAP_LIMIT);
  // Segments start wherever a request starts; shift the start across one span.
  for (uint64_t offset = 0; offset <= 4; offset++) {
    char label[96];
    snprintf(label, sizeof label, "10^6 + 65,536 + %llu", (unsigned long long)offset);
    check_around(label, 1000000 + SEGMENT_SPAN + offset);
  }
}

static void test_large_numbers(void) {
  check_around("10^9", 1000000000ULL);
  check_around("10^12", 1000000000000ULL);
  check_around("10^15", 1000000000000000ULL);
}

// The base primes stop at √(2^53). The squares of the largest ones are the
// composites that need them most: if the top base primes were missing, these
// squares would be reported as prime.
static void test_squares_of_the_largest_base_primes(void) {
  int squares_checked = 0;
  for (uint64_t base_prime = 94906265; squares_checked < 5; base_prime--) {
    if (!is_prime_reference(base_prime)) continue;
    uint64_t square = base_prime * base_prime;
    char test_name[128];
    snprintf(test_name, sizeof test_name, "next across %llu² = %llu",
             (unsigned long long)base_prime, (unsigned long long)square);
    check_next(test_name, square - 600, 50);
    snprintf(test_name, sizeof test_name, "prev across %llu²", (unsigned long long)base_prime);
    check_prev(test_name, square + 600, 50);
    squares_checked++;
  }
}

static void test_last_primes_below_2_to_the_53(void) {
  checks_run++;
  if (!is_prime_reference(LARGEST_PRIME_BELOW_2_TO_THE_53))
    fail("largest prime", "%llu is not prime (reference)%llu",
         (unsigned long long)LARGEST_PRIME_BELOW_2_TO_THE_53, 0);

  check_next("next near 2^53 runs out before 500", SIEVE_LIMIT - 20000, BATCH_SIZE);
  check_next("next after the largest prime finds none", LARGEST_PRIME_BELOW_2_TO_THE_53, 10);
  check_next("next after 2^53 − 1 finds none", SIEVE_LIMIT, 10);
  check_prev("prev below 2^53 − 1", SIEVE_LIMIT, BATCH_SIZE);
  check_prev("prev below 2^53", SIEVE_LIMIT + 1, BATCH_SIZE);

  // 64-bit inputs past the sieve's limit: nothing after them, and "before"
  // them means "before 2^53". 2^64 − 1 used to wrap (after + 1) around to 0.
  check_next("next after 2^53 finds none", SIEVE_LIMIT + 1, 10);
  check_next("next after 2^63 finds none", 1ULL << 63, 10);
  check_next("next after 2^64 − 1 finds none", UINT64_MAX, 10);
  check_prev("prev below 2^64 − 1 gives the last primes below 2^53", UINT64_MAX, BATCH_SIZE);

  checks_run++;
  int written = sieve_next(SIEVE_LIMIT - 2000, 100);
  uint64_t last_prime = written > 0 ? output_buffer()[written - 1] : 0;
  if (written == 0 || last_prime != LARGEST_PRIME_BELOW_2_TO_THE_53)
    fail("largest prime from sieve_next", "last prime %llu, expected %llu",
         (unsigned long long)last_prime, LARGEST_PRIME_BELOW_2_TO_THE_53);
}

#define SWEEP_LIMIT 3000000

static uint8_t *plain_sieve_up_to(uint64_t limit) {
  uint8_t *is_prime = malloc(limit + 1);
  memset(is_prime, 1, limit + 1);
  is_prime[0] = is_prime[1] = 0;
  for (uint64_t candidate = 2; candidate * candidate <= limit; candidate++) {
    if (!is_prime[candidate]) continue;
    for (uint64_t multiple = candidate * candidate; multiple <= limit; multiple += candidate)
      is_prime[multiple] = 0;
  }
  return is_prime;
}

static void test_forward_sweep_from_zero(const uint8_t *is_prime) {
  checks_run++;
  uint64_t expected_next = 2;
  uint64_t after = 0;
  while (expected_next <= SWEEP_LIMIT - 100000) {
    int written = sieve_next(after, BATCH_SIZE);
    const uint64_t *output = output_buffer();
    for (int i = 0; i < written; i++) {
      if (output[i] != expected_next) {
        fail("forward sweep", "got %llu, expected %llu", (unsigned long long)output[i],
             (unsigned long long)expected_next);
        return;
      }
      do expected_next++; while (!is_prime[expected_next]);
    }
    after = output[written - 1];
  }
}

static void test_backward_sweep_to_two(const uint8_t *is_prime) {
  checks_run++;
  uint64_t expected_previous = SWEEP_LIMIT - 100000;
  while (!is_prime[expected_previous]) expected_previous--;
  uint64_t before = expected_previous + 1;
  int reached_two = 0;
  while (!reached_two) {
    int written = sieve_prev(before, BATCH_SIZE);
    if (written == 0) break;
    const uint64_t *output = output_buffer();
    for (int i = written - 1; i >= 0; i--) {
      if (output[i] != expected_previous) {
        fail("backward sweep", "got %llu, expected %llu", (unsigned long long)output[i],
             (unsigned long long)expected_previous);
        return;
      }
      if (expected_previous == 2) {
        reached_two = 1;
        break;
      }
      do expected_previous--; while (!is_prime[expected_previous]);
    }
    before = output[0];
  }
  if (!reached_two) fail("backward sweep", "stopped before reaching 2 (at %llu)%llu",
                         (unsigned long long)expected_previous, 0);
  checks_run++;
  if (sieve_prev(2, BATCH_SIZE) != 0) fail("prev before 2", "should find nothing%llu%llu", 0, 0);
}

// Runs first, while the base primes are still small.
static void test_extending_base_primes(void) {
  checks_run++;
  if (base_prime_limit() != 0)
    fail("base primes before any call", "limit is %llu, expected %llu",
         (unsigned long long)base_prime_limit(), 0);

  const uint64_t needed_limit = 20000000; // √(4 × 10^14)
  checks_run++;
  if (!extend_base_primes(needed_limit) || base_prime_limit() <= needed_limit)
    fail("extend_base_primes", "limit is %llu, expected more than %llu",
         (unsigned long long)base_prime_limit(), (unsigned long long)needed_limit);

  // A batch whose base primes are already there doesn't extend them again.
  uint64_t limit_after_extending = base_prime_limit();
  check_next("next after 4 × 10^14 (base primes already built)", 400000000000000ULL, BATCH_SIZE);
  check_prev("prev before 4 × 10^14 (base primes already built)", 400000000000000ULL, BATCH_SIZE);
  checks_run++;
  if (base_prime_limit() != limit_after_extending)
    fail("sieve_next after extending", "base primes grew again, to %llu from %llu",
         (unsigned long long)base_prime_limit(), (unsigned long long)limit_after_extending);

  // Asking for less than what's there is a no-op.
  checks_run++;
  if (!extend_base_primes(1000) || base_prime_limit() != limit_after_extending)
    fail("extend_base_primes with a smaller limit", "limit changed to %llu from %llu",
         (unsigned long long)base_prime_limit(), (unsigned long long)limit_after_extending);
}

int main(void) {
  test_extending_base_primes();
  test_near_zero();
  test_bootstrap_and_segment_boundaries();
  test_large_numbers();
  test_squares_of_the_largest_base_primes();
  test_last_primes_below_2_to_the_53();

  uint8_t *is_prime = plain_sieve_up_to(SWEEP_LIMIT);
  test_forward_sweep_from_zero(is_prime);
  test_backward_sweep_to_two(is_prime);
  free(is_prime);

  printf("native sieve tests: %d checks, %d failed\n", checks_run, checks_failed);
  return checks_failed == 0 ? 0 : 1;
}
