// Native tests for wasm/primality.c (deterministic Miller–Rabin).
//
// Independent references: a plain sieve of Eratosthenes, and a strong
// probable-prime test written with unsigned __int128 `%` (no Montgomery
// arithmetic, so it shares no code with either path under test). Candidates
// above 2^64 are compared with JavaScript BigInt in tests/wasm/primality.test.ts.
//
// Run with: npm run test:native

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "../../wasm/primality.h"

typedef unsigned __int128 u128;

static int checks_run = 0;
static int checks_failed = 0;

static void expect(int condition, const char *test_name, u128 candidate) {
  checks_run++;
  if (condition)
    return;
  checks_failed++;
  if (checks_failed > 20)
    return; // enough to diagnose
  char digits[50];
  int length = 0;
  do {
    digits[length++] = (char)('0' + (int)(candidate % 10));
    candidate /= 10;
  } while (candidate);
  fprintf(stderr, "FAIL %s: candidate=", test_name);
  while (length)
    fputc(digits[--length], stderr);
  fprintf(stderr, "\n");
}

static const uint32_t BASES[13] = {2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41};

// A014233 in decimal, as published (independent of primality.c's limbs).
static const char *FIRST_COMPOSITE_PASSING_BASES[13] = {
    "2047", "1373653", "25326001", "3215031751", "2152302898747", "3474749660383", "341550071728321",
    "341550071728321", "3825123056546413051", "3825123056546413051", "3825123056546413051",
    "318665857834031151167461", "3317044064679887385961981",
};

// ── references and helpers ────────────────────────────────────────────────

static u128 parse_decimal(const char *text) {
  u128 value = 0;
  for (; *text; text++)
    value = value * 10 + (u128)(*text - '0');
  return value;
}

static void set_u128(big_number *number, u128 value) {
  uint32_t limbs[4];
  for (int index = 0; index < 4; index++)
    limbs[index] = (uint32_t)(value >> (32 * index));
  if (!big_number_set_limbs(number, limbs, 4)) {
    fprintf(stderr, "out of memory\n");
    exit(1);
  }
}

// base^exponent mod modulus with plain 128-bit `%`.
static uint64_t reference_power_mod(uint64_t base, uint64_t exponent, uint64_t modulus) {
  u128 result = 1, running = base % modulus;
  while (exponent) {
    if (exponent & 1)
      result = result * running % modulus;
    running = running * running % modulus;
    exponent >>= 1;
  }
  return (uint64_t)result;
}

// The strong test for one base, by the definition (odd candidate > base + 1).
static int reference_strong_test(uint64_t candidate, uint64_t base) {
  uint64_t odd_part = candidate - 1;
  int powers_of_two = 0;
  while (!(odd_part & 1)) {
    odd_part >>= 1;
    powers_of_two++;
  }
  uint64_t value = reference_power_mod(base, odd_part, candidate);
  if (value == 1 || value == candidate - 1)
    return 1;
  for (int round = 1; round < powers_of_two; round++) {
    value = (uint64_t)((u128)value * value % candidate);
    if (value == candidate - 1)
      return 1;
  }
  return 0;
}

// A composite verdict's evidence must prove it: a factor that divides the
// candidate, or a base the reference strong test confirms is a witness.
static int evidence_proves_composite(uint64_t candidate, primality_verdict verdict, uint32_t evidence) {
  if (verdict == PRIMALITY_COMPOSITE_BY_FACTOR)
    return evidence > 1 && evidence < candidate && candidate % evidence == 0;
  if (verdict == PRIMALITY_COMPOSITE_BY_WITNESS)
    return !reference_strong_test(candidate, evidence);
  return 0;
}

static int is_composite_verdict(primality_verdict verdict) {
  return verdict == PRIMALITY_COMPOSITE_BY_FACTOR || verdict == PRIMALITY_COMPOSITE_BY_WITNESS;
}

// Both paths must give the same verdict and the same evidence.
static void check_paths_agree(uint64_t candidate) {
  big_number number;
  big_number_init(&number);
  big_number_set_u64(&number, candidate);
  uint32_t fast_evidence = 0, multi_limb_evidence = 0;
  primality_verdict fast = miller_rabin_u64(candidate, &fast_evidence);
  primality_verdict multi_limb = miller_rabin_multi_limb(&number, &multi_limb_evidence);
  expect(fast == multi_limb, "uint64_t and multi-limb verdicts agree", candidate);
  if (is_composite_verdict(fast))
    expect(fast_evidence == multi_limb_evidence, "uint64_t and multi-limb evidence agree", candidate);
  expect(miller_rabin(&number, NULL) == fast, "miller_rabin uses the fast path below 2^64", candidate);
  big_number_free(&number);
}

static uint64_t random_state = 0x2545f4914f6cdd1dULL;
static uint64_t random_u64(void) { // xorshift64*
  random_state ^= random_state >> 12;
  random_state ^= random_state << 25;
  random_state ^= random_state >> 27;
  return random_state * 0x2545f4914f6cdd1dULL;
}

// ── tests ─────────────────────────────────────────────────────────────────

// Every candidate below the limit against a sieve, and π(limit) (A4).
static void check_against_sieve(uint32_t limit, uint64_t expected_prime_count) {
  uint8_t *is_composite = calloc(limit, 1);
  for (uint64_t value = 2; value * value < limit; value++)
    if (!is_composite[value])
      for (uint64_t multiple = value * value; multiple < limit; multiple += value)
        is_composite[multiple] = 1;
  uint64_t prime_count = 0;
  for (uint32_t candidate = 0; candidate < limit; candidate++) {
    uint32_t evidence = 0;
    primality_verdict verdict = miller_rabin_u64(candidate, &evidence);
    if (candidate < 2) {
      expect(verdict == PRIMALITY_BELOW_TWO, "0 and 1 are below two", candidate);
      continue;
    }
    if (!is_composite[candidate]) {
      expect(verdict == PRIMALITY_PRIME, "a sieve prime is proven prime", candidate);
      prime_count += verdict == PRIMALITY_PRIME;
    } else {
      expect(evidence_proves_composite(candidate, verdict, evidence), "a sieve composite is proven composite", candidate);
    }
  }
  expect(prime_count == expected_prime_count, "π(limit) matches the published count", limit);
  free(is_composite);
}

// The table's data: each a(k) is composite, passes its first k bases (it's a
// strong pseudoprime to them, by the reference test), and is caught. a(13)
// itself is at the bound, so it's beyond what's proven.
static void check_bound_table(void) {
  for (int base_count = 1; base_count <= 13; base_count++) {
    u128 bound = parse_decimal(FIRST_COMPOSITE_PASSING_BASES[base_count - 1]);
    big_number number;
    big_number_init(&number);
    set_u128(&number, bound);
    for (int index = 0; index < base_count; index++) {
      if (bound <= UINT64_MAX)
        expect(reference_strong_test((uint64_t)bound, BASES[index]), "a(k) passes its first k bases (reference)", bound);
      expect(strong_probable_prime(&number, BASES[index]) == 1, "a(k) passes its first k bases", bound);
    }
    uint32_t evidence = 0;
    primality_verdict verdict = miller_rabin(&number, &evidence);
    if (base_count < 13) {
      expect(is_composite_verdict(verdict), "a(k) is proven composite", bound);
      if (bound <= UINT64_MAX)
        expect(evidence_proves_composite((uint64_t)bound, verdict, evidence), "a(k)'s evidence holds", bound);
    } else {
      expect(verdict == PRIMALITY_BEYOND_PROVEN_BOUND, "a(13) is beyond the proven bound", bound);
    }
    // The odd numbers just below a(k) need only k bases: still proven.
    if (bound <= UINT64_MAX)
      check_paths_agree((uint64_t)bound - 2);
    big_number_free(&number);
  }
}

// Carmichael numbers fool the Fermat test for every base coprime to them.
// Chernick's form (6k+1)(12k+1)(18k+1), with all three factors prime, is
// always one; these have every factor above 41, so trial division can't help
// and a Miller–Rabin witness must be found. The first 200 from the bottom,
// then 200 from k = 300,000, where 1296k³ passes 2^64 (multi-limb), up to
// about 10^22.
static void check_carmichael_numbers(void) {
  int found = 0;
  for (uint64_t k = 1; found < 400; k = (found == 200 && k < 300000) ? 300000 : k + 1) {
    uint64_t factors[3] = {6 * k + 1, 12 * k + 1, 18 * k + 1};
    int all_prime = factors[0] > 41;
    for (int index = 0; index < 3 && all_prime; index++)
      all_prime = miller_rabin_u64(factors[index], NULL) == PRIMALITY_PRIME;
    if (!all_prime)
      continue;
    found++;
    big_number product, factor;
    big_number_init(&product);
    big_number_init(&factor);
    big_number_set_u64(&product, factors[0]);
    for (int index = 1; index < 3; index++) {
      big_number_set_u64(&factor, factors[index]);
      big_number_multiply(&product, &product, &factor);
    }
    u128 value = (u128)factors[0] * factors[1] * factors[2];
    uint32_t evidence = 0;
    primality_verdict verdict = miller_rabin(&product, &evidence);
    expect(verdict == PRIMALITY_COMPOSITE_BY_WITNESS, "a Carmichael number is caught by a witness", value);
    if (value <= UINT64_MAX) {
      expect(evidence_proves_composite((uint64_t)value, verdict, evidence), "its witness holds", value);
      check_paths_agree((uint64_t)value);
    } else {
      expect(strong_probable_prime(&product, evidence) == 0, "its witness holds (multi-limb)", value);
    }
    big_number_free(&product);
    big_number_free(&factor);
  }
}

// Known values above 2^64, and at and past the proven bound.
static void check_large_values(void) {
  struct {
    const char *decimal;
    primality_verdict expected;
  } cases[] = {
      {"18446744073709551629", PRIMALITY_PRIME},           // 2^64 + 13, the first prime above 2^64
      {"18446744073709551617", PRIMALITY_COMPOSITE_BY_WITNESS}, // 2^64 + 1 = 274177 · 67280421310721
      {"100000000000000000039", PRIMALITY_PRIME},          // 10^20 + 39
      {"1000000000000000000000007", PRIMALITY_PRIME},      // 10^24 + 7
      {"1000000000000000000000001", PRIMALITY_COMPOSITE_BY_FACTOR},  // 10^24 + 1 = 17 · …
      {"1000000000100000000002379", PRIMALITY_COMPOSITE_BY_WITNESS}, // (10^12 + 39)(10^12 + 61)
      {"3317044064679887385961979", PRIMALITY_COMPOSITE_BY_FACTOR},  // a(13) − 2 = 17 · …
      {"3317044064679887385961983", PRIMALITY_COMPOSITE_BY_FACTOR},  // a(13) + 2 = 3 · …: proven at any size
      {"3317044064679887385961987", PRIMALITY_BEYOND_PROVEN_BOUND},  // a(13) + 6, no factor below 43
      {"618970019642690137449562111", PRIMALITY_BEYOND_PROVEN_BOUND}, // 2^89 − 1, a Mersenne prime
      {"618970019642690137449562112", PRIMALITY_COMPOSITE_BY_FACTOR}, // even: proven at any size
  };
  for (size_t index = 0; index < sizeof cases / sizeof cases[0]; index++) {
    u128 value = parse_decimal(cases[index].decimal);
    big_number number;
    big_number_init(&number);
    set_u128(&number, value);
    uint32_t evidence = 0;
    primality_verdict verdict = miller_rabin(&number, &evidence);
    expect(verdict == cases[index].expected, cases[index].decimal, value);
    if (verdict == PRIMALITY_COMPOSITE_BY_WITNESS)
      expect(strong_probable_prime(&number, evidence) == 0, "the witness holds", value);
    if (verdict == PRIMALITY_COMPOSITE_BY_FACTOR)
      expect(big_number_mod_small(&number, evidence) == 0, "the factor divides it", value);
    big_number_free(&number);
  }
}

// ── Baillie–PSW ───────────────────────────────────────────────────────────

static primality_verdict bpsw_of(u128 value, uint32_t *evidence) {
  big_number number;
  big_number_init(&number);
  set_u128(&number, value);
  primality_verdict verdict = bpsw(&number, evidence);
  big_number_free(&number);
  return verdict;
}

static int lucas_of(u128 value) {
  big_number number;
  big_number_init(&number);
  set_u128(&number, value);
  int passes = strong_lucas_probable_prime(&number);
  big_number_free(&number);
  return passes;
}

static void check_bpsw(void) {
  // Every number below 2,000,000 against a sieve: never calls a prime
  // composite, and lets no composite through.
  enum { LIMIT = 2000000 };
  uint8_t *is_composite = calloc(LIMIT, 1);
  for (uint64_t value = 2; value * value < LIMIT; value++)
    if (!is_composite[value])
      for (uint64_t multiple = value * value; multiple < LIMIT; multiple += value)
        is_composite[multiple] = 1;
  for (uint32_t candidate = 2; candidate < LIMIT; candidate++) {
    primality_verdict verdict = bpsw_of(candidate, NULL);
    expect((verdict == PRIMALITY_PROBABLE_PRIME) == !is_composite[candidate], "BPSW against a sieve", candidate);
  }
  free(is_composite);
  expect(bpsw_of(0, NULL) == PRIMALITY_BELOW_TWO && bpsw_of(1, NULL) == PRIMALITY_BELOW_TWO, "BPSW below two", 0);

  // Strong Lucas pseudoprimes (OEIS A217255): composites that pass Lucas alone,
  // so this is the proof the Lucas test matches the published one. Base 2 catches them.
  static const uint32_t lucas_pseudoprimes[] = {5459,  5777,   10877,  16109,  18971,  22499,  24569,  25199,
                                                40309, 58519,  75077,  97439,  100127, 113573, 115639, 130139};
  for (size_t index = 0; index < sizeof lucas_pseudoprimes / sizeof *lucas_pseudoprimes; index++) {
    expect(lucas_of(lucas_pseudoprimes[index]) == 1, "a strong Lucas pseudoprime passes Lucas", lucas_pseudoprimes[index]);
    expect(bpsw_of(lucas_pseudoprimes[index], NULL) == PRIMALITY_COMPOSITE_BY_WITNESS, "and fails base 2", lucas_pseudoprimes[index]);
  }
  // And no other odd number below the list's end passes without being prime.
  int lucas_pseudoprimes_found = 0;
  for (uint32_t candidate = 43; candidate < 130140; candidate += 2) {
    int is_prime = miller_rabin_u64(candidate, NULL) == PRIMALITY_PRIME;
    if (lucas_of(candidate) == 1 && !is_prime)
      lucas_pseudoprimes_found++;
    if (is_prime)
      expect(lucas_of(candidate) == 1, "every prime passes Lucas", candidate);
  }
  expect(lucas_pseudoprimes_found == 16, "exactly the published strong Lucas pseudoprimes", (u128)lucas_pseudoprimes_found);

  // Strong pseudoprimes to base 2 pass that step: Lucas must catch them.
  static const uint32_t base_2_pseudoprimes[] = {2047, 3277, 4033, 4681, 8321, 15841, 29341, 42799, 49141, 52633};
  for (size_t index = 0; index < sizeof base_2_pseudoprimes / sizeof *base_2_pseudoprimes; index++) {
    primality_verdict verdict = bpsw_of(base_2_pseudoprimes[index], NULL);
    expect(verdict == PRIMALITY_COMPOSITE_BY_LUCAS || verdict == PRIMALITY_COMPOSITE_BY_FACTOR, "base-2 pseudoprime caught", base_2_pseudoprimes[index]);
  }

  // Perfect squares, whose D search never ends without the square check.
  static const u128 square_roots[] = {43, 1009, 65537, 4294967311ULL, 1000000000039ULL};
  for (size_t index = 0; index < sizeof square_roots / sizeof *square_roots; index++) {
    u128 square = square_roots[index] * square_roots[index];
    primality_verdict verdict = bpsw_of(square, NULL);
    expect(verdict != PRIMALITY_PROBABLE_PRIME && verdict != PRIMALITY_OUT_OF_MEMORY, "a square is proven composite", square);
    expect(lucas_of(square) != 1, "a square fails Lucas", square);
  }

  // Against deterministic Miller–Rabin on random values, which is proven here.
  for (int round = 0; round < 40000; round++) {
    uint64_t candidate = (random_u64() >> (random_u64() % 60)) | 1;
    primality_verdict proven = miller_rabin_u64(candidate, NULL);
    primality_verdict filter = bpsw_of(candidate, NULL);
    expect((proven == PRIMALITY_PRIME) == (filter == PRIMALITY_PROBABLE_PRIME), "BPSW against Miller–Rabin", candidate);
  }
  // Every prime around the limb changes passes.
  for (int limbs = 1; limbs <= 2; limbs++) { // 2^32 and 2^64; 2^96 is past a(13), so below
    u128 center = (u128)1 << (32 * limbs);
    for (u128 candidate = center - 2001; candidate < center + 2001; candidate += 2) {
      if (center <= UINT64_MAX)
        expect((miller_rabin_u64((uint64_t)candidate, NULL) == PRIMALITY_PRIME) == (bpsw_of(candidate, NULL) == PRIMALITY_PROBABLE_PRIME),
               "BPSW around a limb change", candidate);
      else {
        big_number number;
        big_number_init(&number);
        set_u128(&number, candidate);
        expect((miller_rabin(&number, NULL) == PRIMALITY_PRIME) == (bpsw_of(candidate, NULL) == PRIMALITY_PROBABLE_PRIME),
               "BPSW around a limb change", candidate);
        big_number_free(&number);
      }
    }
  }
  // Past a(13): 2^89 − 1 and 2^107 − 1 are Mersenne primes.
  expect(bpsw_of(((u128)1 << 89) - 1, NULL) == PRIMALITY_PROBABLE_PRIME, "2^89 − 1", ((u128)1 << 89) - 1);
  expect(bpsw_of(((u128)1 << 107) - 1, NULL) == PRIMALITY_PROBABLE_PRIME, "2^107 − 1", ((u128)1 << 107) - 1);
  expect(bpsw_of(((u128)1 << 127) - 1, NULL) == PRIMALITY_PROBABLE_PRIME, "2^127 − 1", ((u128)1 << 127) - 1);
  expect(bpsw_of(((u128)1 << 101) - 1, NULL) != PRIMALITY_PROBABLE_PRIME, "2^101 − 1 is composite", ((u128)1 << 101) - 1);
}

int main(void) {
  check_against_sieve(10000000, 664579); // π(10^7)
  for (uint64_t candidate = 0; candidate < 200000; candidate++)
    check_paths_agree(candidate);
  for (int round = 0; round < 200000; round++) {
    uint64_t candidate = random_u64() >> (random_u64() % 64);
    check_paths_agree(candidate);
    check_paths_agree(candidate | 1);
    if (round < 2000) // around 2^32 and 2^64, where the limb count changes
      check_paths_agree((uint64_t)UINT32_MAX - 1000 + (uint64_t)round), check_paths_agree(UINT64_MAX - (uint64_t)round);
    // Every composite's evidence holds, by the reference test.
    uint32_t evidence = 0;
    primality_verdict verdict = miller_rabin_u64(candidate | 1, &evidence);
    if (is_composite_verdict(verdict))
      expect(evidence_proves_composite(candidate | 1, verdict, evidence), "random composite's evidence holds", candidate | 1);
  }
  check_bound_table();
  check_carmichael_numbers();
  check_large_values();
  check_bpsw();

  printf("native primality tests: %d checks, %d failed\n", checks_run, checks_failed);
  return checks_failed == 0 ? 0 : 1;
}
