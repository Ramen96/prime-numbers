// Deterministic Miller–Rabin. See primality.h for what the verdicts prove.
//
// The test, for an odd candidate n: write n − 1 = d · 2^s with d odd. A prime
// n must satisfy, for every base a not divisible by n, either
//   a^d ≡ 1 (mod n),  or  a^(d·2^r) ≡ −1 (mod n) for some r < s,
// because the only square roots of 1 modulo a prime are 1 and −1. A base for
// which neither holds is a witness: proof that n is composite. Some composites
// pass some bases ("strong pseudoprimes"), which is why the proven bounds of
// A014233 decide how many bases a candidate needs.

#include "primality.h"

#define BASE_COUNT 13

// The first 13 primes: the bases, tried in order. Also the trial divisors.
static const uint32_t PRIME_BASES[BASE_COUNT] = {2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41};

// A014233: entry k − 1 is a(k), the smallest odd composite that passes the
// first k bases, so with k bases every odd candidate below a(k) gets a proven
// verdict. As three 32-bit limbs, least significant first (Requirement B).
// Sources: https://oeis.org/A014233/b014233.txt; a(12) and a(13) from
// J. Sorenson and J. Webster, "Strong Pseudoprimes to Twelve Prime Bases",
// Math. Comp. 86 (2017). verifyPrimes.ts holds the same table in decimal, and
// the tests check that the two agree and that each a(k) really passes its k bases.
#define BOUND_LIMBS 3
static const uint32_t FIRST_COMPOSITE_PASSING_BASES[BASE_COUNT][BOUND_LIMBS] = {
    {0x000007ff, 0x00000000, 0x00000000}, // a(1)  = 2,047
    {0x0014f5d5, 0x00000000, 0x00000000}, // a(2)  = 1,373,653
    {0x018271b1, 0x00000000, 0x00000000}, // a(3)  = 25,326,001
    {0xbfa17dc7, 0x00000000, 0x00000000}, // a(4)  = 3,215,031,751
    {0x1f3fee3b, 0x000001f5, 0x00000000}, // a(5)  = 2,152,302,898,747
    {0x07381cdf, 0x00000329, 0x00000000}, // a(6)  = 3,474,749,660,383
    {0x52b2c8c1, 0x000136a3, 0x00000000}, // a(7)  = 341,550,071,728,321
    {0x52b2c8c1, 0x000136a3, 0x00000000}, // a(8)  = 341,550,071,728,321
    {0x4f9af9fb, 0x35159127, 0x00000000}, // a(9)  = 3,825,123,056,546,413,051
    {0x4f9af9fb, 0x35159127, 0x00000000}, // a(10) = 3,825,123,056,546,413,051
    {0x4f9af9fb, 0x35159127, 0x00000000}, // a(11) = 3,825,123,056,546,413,051
    {0xfc85b7e5, 0xe92817f9, 0x0000437a}, // a(12) = 318,665,857,834,031,151,167,461
    {0x2410a5fd, 0x51adc5b2, 0x0002be69}, // a(13) = 3,317,044,064,679,887,385,961,981
};

// a(k) as a uint64_t, for the fast path. Only valid for k <= 11, whose bounds
// fit in 64 bits; every uint64_t is below a(12).
static uint64_t bound_u64(int base_count) {
  const uint32_t *limbs = FIRST_COMPOSITE_PASSING_BASES[base_count - 1];
  return (uint64_t)limbs[0] | ((uint64_t)limbs[1] << 32);
}

// How many bases a candidate below 2^64 needs: the smallest k with candidate
// < a(k). Every uint64_t is below a(12), so the answer is at most 12.
static int bases_needed_u64(uint64_t candidate) {
  for (int base_count = 1; base_count <= 11; base_count++) {
    if (candidate < bound_u64(base_count))
      return base_count;
  }
  return 12;
}

// How many bases a candidate of any size needs, or 0 if it's at least a(13)
// and no number of these bases proves anything.
static int bases_needed(const big_number *candidate) {
  for (int base_count = 1; base_count <= BASE_COUNT; base_count++) {
    big_number bound;
    big_number_init(&bound);
    // The bound's limbs are read in place: a big_number that isn't allocated
    // and is never written, only compared.
    bound.limbs = (uint32_t *)FIRST_COMPOSITE_PASSING_BASES[base_count - 1];
    bound.limb_count = BOUND_LIMBS;
    while (bound.limb_count > 0 && bound.limbs[bound.limb_count - 1] == 0)
      bound.limb_count--; // normalized, so compare is correct
    if (big_number_compare(candidate, &bound) < 0)
      return base_count;
  }
  return 0;
}

// ── the uint64_t fast path ─────────────────────────────────────────────────
//
// Montgomery arithmetic with one 64-bit limb, R = 2^64: products are 128 bits
// (unsigned __int128; in Wasm the compiler turns these into small helper
// calls). Same method as montgomery_multiply in bignum.c, one limb wide.

typedef struct {
  uint64_t modulus;
  uint64_t negated_inverse; // −modulus⁻¹ mod 2^64
  uint64_t r_squared;       // 2^128 mod modulus
  uint64_t one;             // R mod modulus: 1 in Montgomery form
} montgomery_u64;

// For odd modulus > 1. Newton's iteration doubles the correct bits of the
// inverse each step: 3 → 6 → 12 → 24 → 48 → 96 ≥ 64, so five steps.
static montgomery_u64 montgomery_u64_init(uint64_t modulus) {
  montgomery_u64 context;
  context.modulus = modulus;
  uint64_t inverse = modulus;
  for (int step = 0; step < 5; step++)
    inverse *= 2 - modulus * inverse;
  context.negated_inverse = (uint64_t)0 - inverse;
  context.one = ((uint64_t)0 - modulus) % modulus; // 2^64 mod modulus
  context.r_squared = (uint64_t)((unsigned __int128)context.one * context.one % modulus);
  return context;
}

// first · second · 2^−64 mod modulus, for inputs below the modulus.
// t + m·N can exceed 2^128 when the modulus is above 2^63, so the carry out
// is kept: the true value of (t + m·N) / 2^64 is high + carry · 2^64, which is
// below 2·modulus, and one wrapping subtraction brings it below the modulus.
static uint64_t montgomery_u64_multiply(const montgomery_u64 *context, uint64_t first, uint64_t second) {
  unsigned __int128 product = (unsigned __int128)first * second;
  uint64_t low_multiplier = (uint64_t)product * context->negated_inverse;
  unsigned __int128 correction = (unsigned __int128)low_multiplier * context->modulus;
  unsigned __int128 sum = product + correction;
  int carry = sum < product;
  uint64_t high = (uint64_t)(sum >> 64);
  if (carry || high >= context->modulus)
    high -= context->modulus;
  return high;
}

// base^exponent in Montgomery form, by left-to-right binary exponentiation,
// starting at the exponent's top set bit.
static uint64_t montgomery_u64_power(const montgomery_u64 *context, uint64_t base_form, uint64_t exponent) {
  uint64_t running = context->one;
  int top_bit = exponent ? 63 - __builtin_clzll(exponent) : -1;
  for (int bit = top_bit; bit >= 0; bit--) {
    running = montgomery_u64_multiply(context, running, running);
    if ((exponent >> bit) & 1)
      running = montgomery_u64_multiply(context, running, base_form);
  }
  return running;
}

// The strong test for one base, with the context already set up.
static int passes_base_u64(const montgomery_u64 *context, uint64_t odd_part, int powers_of_two, uint32_t base) {
  uint64_t minus_one = context->modulus - context->one; // −1 in Montgomery form
  uint64_t base_form = montgomery_u64_multiply(context, base % context->modulus, context->r_squared);
  uint64_t value = montgomery_u64_power(context, base_form, odd_part);
  if (value == context->one || value == minus_one)
    return 1;
  for (int round = 1; round < powers_of_two; round++) {
    value = montgomery_u64_multiply(context, value, value);
    if (value == minus_one)
      return 1;
  }
  return 0;
}

int strong_probable_prime_u64(uint64_t candidate, uint32_t base) {
  montgomery_u64 context = montgomery_u64_init(candidate);
  uint64_t odd_part = candidate - 1;
  int powers_of_two = 0;
  while (!(odd_part & 1)) {
    odd_part >>= 1;
    powers_of_two++;
  }
  return passes_base_u64(&context, odd_part, powers_of_two, base);
}

primality_verdict miller_rabin_u64(uint64_t candidate, uint32_t *evidence) {
  if (candidate < 2)
    return PRIMALITY_BELOW_TWO;
  // Trial division by the bases first: it settles small candidates, and it
  // keeps every base below the candidate for the strong tests.
  for (int index = 0; index < BASE_COUNT; index++) {
    uint32_t base = PRIME_BASES[index];
    if (candidate == base)
      return PRIMALITY_PRIME;
    if (candidate % base == 0) {
      if (evidence)
        *evidence = base;
      return PRIMALITY_COMPOSITE_BY_FACTOR;
    }
  }

  montgomery_u64 context = montgomery_u64_init(candidate);
  uint64_t odd_part = candidate - 1;
  int powers_of_two = 0;
  while (!(odd_part & 1)) {
    odd_part >>= 1;
    powers_of_two++;
  }
  int base_count = bases_needed_u64(candidate);
  for (int index = 0; index < base_count; index++) {
    if (!passes_base_u64(&context, odd_part, powers_of_two, PRIME_BASES[index])) {
      if (evidence)
        *evidence = PRIME_BASES[index];
      return PRIMALITY_COMPOSITE_BY_WITNESS;
    }
  }
  return PRIMALITY_PRIME;
}

// ── the multi-limb path ────────────────────────────────────────────────────

// Everything one candidate's strong tests share: the Montgomery context, d
// and s with n − 1 = d · 2^s, and 1 and −1 in Montgomery form.
typedef struct {
  montgomery_context montgomery;
  big_number odd_part;
  size_t powers_of_two;
  big_number one_form;
  big_number minus_one_form;
} strong_test_setup;

static void strong_test_free(strong_test_setup *setup) {
  montgomery_free(&setup->montgomery);
  big_number_free(&setup->odd_part);
  big_number_free(&setup->one_form);
  big_number_free(&setup->minus_one_form);
}

// For an odd candidate > 1. Returns 0 if memory runs out (setup then freed).
static int strong_test_init(strong_test_setup *setup, const big_number *candidate) {
  big_number_init(&setup->odd_part);
  big_number_init(&setup->one_form);
  big_number_init(&setup->minus_one_form);
  big_number one;
  big_number_init(&one);
  int ok = montgomery_init(&setup->montgomery, candidate) && big_number_copy(&setup->odd_part, candidate) &&
           big_number_subtract_small(&setup->odd_part, 1) && big_number_set_u64(&one, 1) &&
           montgomery_to_form(&setup->montgomery, &setup->one_form, &one) &&
           big_number_subtract(&setup->minus_one_form, candidate, &setup->one_form);
  big_number_free(&one);
  if (!ok) {
    strong_test_free(setup);
    return 0;
  }
  // n − 1 = d · 2^s: count the zero bits at the bottom, then shift them off.
  size_t zero_bits = 0;
  while (!(setup->odd_part.limbs[zero_bits / 32] >> (zero_bits % 32) & 1))
    zero_bits++;
  setup->powers_of_two = zero_bits;
  if (!big_number_shift_right(&setup->odd_part, &setup->odd_part, zero_bits)) {
    strong_test_free(setup);
    return 0;
  }
  return 1;
}

// The strong test for one base: 1 passes, 0 witness, -1 out of memory.
// a^d is computed in ordinary form, then brought into Montgomery form for the
// squarings, which are compared with −1 in Montgomery form.
static int passes_base(strong_test_setup *setup, uint32_t base) {
  big_number base_number, value;
  big_number_init(&base_number);
  big_number_init(&value);
  int result = -1;
  if (!big_number_set_u64(&base_number, base) ||
      !montgomery_power(&setup->montgomery, &value, &base_number, &setup->odd_part) ||
      !montgomery_to_form(&setup->montgomery, &value, &value))
    goto done;
  if (big_number_compare(&value, &setup->one_form) == 0 || big_number_compare(&value, &setup->minus_one_form) == 0) {
    result = 1;
    goto done;
  }
  for (size_t round = 1; round < setup->powers_of_two; round++) {
    if (!montgomery_multiply(&setup->montgomery, &value, &value, &value))
      goto done;
    if (big_number_compare(&value, &setup->minus_one_form) == 0) {
      result = 1;
      goto done;
    }
  }
  result = 0;
done:
  big_number_free(&base_number);
  big_number_free(&value);
  return result;
}

int strong_probable_prime(const big_number *candidate, uint32_t base) {
  strong_test_setup setup;
  if (!strong_test_init(&setup, candidate))
    return -1;
  int result = passes_base(&setup, base);
  strong_test_free(&setup);
  return result;
}

primality_verdict miller_rabin_multi_limb(const big_number *candidate, uint32_t *evidence) {
  if (big_number_compare_u64(candidate, 2) < 0)
    return PRIMALITY_BELOW_TWO;
  for (int index = 0; index < BASE_COUNT; index++) {
    uint32_t base = PRIME_BASES[index];
    if (big_number_compare_u64(candidate, base) == 0)
      return PRIMALITY_PRIME;
    if (big_number_mod_small(candidate, base) == 0) {
      if (evidence)
        *evidence = base;
      return PRIMALITY_COMPOSITE_BY_FACTOR;
    }
  }
  int base_count = bases_needed(candidate);
  if (base_count == 0)
    return PRIMALITY_BEYOND_PROVEN_BOUND;

  strong_test_setup setup;
  if (!strong_test_init(&setup, candidate))
    return PRIMALITY_OUT_OF_MEMORY;
  primality_verdict verdict = PRIMALITY_PRIME;
  for (int index = 0; index < base_count; index++) {
    int passed = passes_base(&setup, PRIME_BASES[index]);
    if (passed < 0) {
      verdict = PRIMALITY_OUT_OF_MEMORY;
      break;
    }
    if (!passed) {
      if (evidence)
        *evidence = PRIME_BASES[index];
      verdict = PRIMALITY_COMPOSITE_BY_WITNESS;
      break;
    }
  }
  strong_test_free(&setup);
  return verdict;
}

primality_verdict miller_rabin(const big_number *candidate, uint32_t *evidence) {
  if (big_number_fits_u64(candidate))
    return miller_rabin_u64(big_number_to_u64(candidate), evidence);
  return miller_rabin_multi_limb(candidate, evidence);
}
