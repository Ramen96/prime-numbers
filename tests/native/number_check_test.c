// Native tests for wasm/number_check.c (the prime checker's verdict).
//
// Below 100,000 the reference is a plain sieve, and every composite's evidence
// is checked here: a factor divides it, a witness fails a strong test written
// with plain `%`. Past a(13), known numbers: Mersenne primes, a(13) itself, and
// composites built from known primes. tests/wasm/numberCheck.test.ts checks
// random numbers up to 1,000 digits in both shipped builds, in BigInt.
//
// Run with: npm run test:native

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "../../wasm/number_check.h"
#include "../../wasm/primality.h"

typedef unsigned __int128 u128;

static int checks_run = 0;
static int checks_failed = 0;

static void expect(int condition, const char *test_name, uint64_t detail) {
  checks_run++;
  if (condition)
    return;
  checks_failed++;
  if (checks_failed <= 20)
    fprintf(stderr, "FAIL %s (%llu)\n", test_name, (unsigned long long)detail);
}

// Writes `value` into the checker's input buffer, with `extra_zero_limbs` zero
// limbs above it (which mustn't change anything), and returns the limb count.
static size_t write_u128(u128 value, size_t extra_zero_limbs) {
  size_t limb_count = 0;
  uint32_t limbs[4];
  for (u128 rest = value; rest != 0; rest >>= 32)
    limbs[limb_count++] = (uint32_t)rest;
  uint32_t *buffer = number_check_input_buffer(limb_count + extra_zero_limbs);
  memcpy(buffer, limbs, limb_count * sizeof *limbs);
  for (size_t index = 0; index < extra_zero_limbs; index++)
    buffer[limb_count + index] = 0;
  return limb_count + extra_zero_limbs;
}

static int check_u128(u128 value) { return check_number(write_u128(value, 0)); }

static uint64_t power_mod(uint64_t base, uint64_t exponent, uint64_t modulus) {
  uint64_t result = 1;
  base %= modulus;
  for (; exponent; exponent >>= 1) {
    if (exponent & 1)
      result = result * base % modulus;
    base = base * base % modulus;
  }
  return result;
}

// Whether `base` is a strong-test witness for odd `candidate` (below 2^32, so products fit).
static int is_witness(uint64_t candidate, uint64_t base) {
  uint64_t odd_part = candidate - 1;
  int powers_of_two = 0;
  while ((odd_part & 1) == 0) {
    odd_part >>= 1;
    powers_of_two++;
  }
  uint64_t value = power_mod(base, odd_part, candidate);
  if (value == 1 || value == candidate - 1)
    return 0;
  for (int round = 1; round < powers_of_two; round++) {
    value = value * value % candidate;
    if (value == candidate - 1)
      return 0;
  }
  return 1;
}

static void test_every_number_below_100000(void) {
  enum { LIMIT = 100000 };
  static unsigned char is_prime[LIMIT];
  memset(is_prime, 1, sizeof is_prime);
  is_prime[0] = is_prime[1] = 0;
  for (int candidate = 2; candidate * candidate < LIMIT; candidate++)
    if (is_prime[candidate])
      for (int multiple = candidate * candidate; multiple < LIMIT; multiple += candidate)
        is_prime[multiple] = 0;
  for (uint64_t value = 0; value < LIMIT; value++) {
    int verdict = check_u128(value);
    uint32_t evidence = number_check_evidence();
    if (value < 2) {
      expect(verdict == PRIMALITY_BELOW_TWO && evidence == 0, "below two", value);
    } else if (is_prime[value]) {
      expect(verdict == PRIMALITY_PRIME && evidence == 0, "prime", value);
    } else if (verdict == PRIMALITY_COMPOSITE_BY_FACTOR) {
      expect(evidence > 1 && evidence < value && value % evidence == 0, "factor divides it", value);
    } else {
      expect(verdict == PRIMALITY_COMPOSITE_BY_WITNESS, "composite", value);
      expect(value % 2 == 1 && evidence > 1 && evidence + 1 < value && is_witness(value, evidence), "witness holds", value);
    }
  }
}

static void test_inputs(void) {
  expect(check_number(0) == PRIMALITY_BELOW_TWO, "no limbs is zero", 0);
  expect(check_number(write_u128(1000003, 3)) == PRIMALITY_PRIME, "leading zero limbs", 1000003);
  // 101 × 9,901: no factor up to 41, so Miller–Rabin finds a witness
  expect(check_number(write_u128(1000001, 2)) == PRIMALITY_COMPOSITE_BY_WITNESS && number_check_evidence() != 0,
         "leading zero limbs, composite", 1000001);
  number_check_input_buffer(2);
  expect(check_number(1u << 20) == -1, "more limbs than the buffer holds", 1u << 20);
  expect(number_check_evidence() == 0, "no evidence after a refused call", 0);
}

static void test_past_a13(void) {
  const u128 a13 = (u128)3317044064ULL * 1000000000000000ULL + 679887385961981ULL;
  const u128 mersenne_89 = ((u128)1 << 89) - 1, mersenne_107 = ((u128)1 << 107) - 1, mersenne_127 = ((u128)1 << 127) - 1;
  const u128 mersenne_61 = ((u128)1 << 61) - 1, mersenne_31 = ((u128)1 << 31) - 1;

  expect(check_u128(a13) == PRIMALITY_COMPOSITE_BY_LUCAS, "a(13) passes base 2 and fails Lucas", 13);
  expect(number_check_evidence() == 0, "Lucas has no evidence", 13);
  expect(check_u128(a13 - 2) != PRIMALITY_BEYOND_PROVEN_BOUND, "just below a(13) is settled", 12);
  const u128 probable[] = {mersenne_89, mersenne_107, mersenne_127};
  for (int index = 0; index < 3; index++) {
    expect(check_u128(probable[index]) == PRIMALITY_PROBABLE_PRIME, "Mersenne prime is a probable prime", (uint64_t)index);
    expect(number_check_evidence() == 0, "a probable prime has no evidence", (uint64_t)index);
  }
  expect(check_u128(mersenne_61 * mersenne_31) == PRIMALITY_COMPOSITE_BY_WITNESS && number_check_evidence() == 2,
         "two primes above 65,536: base 2 is a witness", 2);
  expect(check_u128(mersenne_89 * 41) == PRIMALITY_COMPOSITE_BY_FACTOR && number_check_evidence() == 41,
         "a multiple of 41", 41);
  expect(check_u128(mersenne_89 + 2) == PRIMALITY_COMPOSITE_BY_FACTOR && number_check_evidence() == 3,
         "2^89 + 1 is a multiple of 3", 3);
}

int main(void) {
  test_every_number_below_100000();
  test_inputs();
  test_past_a13();
  printf("number_check: %d checks, %d failed\n", checks_run, checks_failed);
  return checks_failed ? 1 : 0;
}
