// Native tests for wasm/bignum.c, against unsigned __int128 as the
// independent reference (values up to 128 bits). Randomized with a fixed seed
// so failures are reproducible, plus hand-picked values where limb counts
// change (2^32, 2^64, 2^96). Larger sizes are tested against JavaScript BigInt
// in tests/wasm/bignum.test.ts. Montgomery arithmetic is checked here for
// moduli below 2^64, where a·b mod N fits the reference's 128 bits.
//
// Run with: npm run test:native

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

#include "../../wasm/bignum.h"

typedef unsigned __int128 u128;

static int checks_run = 0;
static int checks_failed = 0;

static void print_u128(const char *label, u128 value) {
  char digits[50];
  int length = 0;
  do {
    digits[length++] = (char)('0' + (int)(value % 10));
    value /= 10;
  } while (value);
  fprintf(stderr, "%s", label);
  while (length)
    fputc(digits[--length], stderr);
}

static void fail(const char *test_name, u128 input, u128 expected, u128 actual) {
  checks_failed++;
  if (checks_failed > 20)
    return; // enough to diagnose
  fprintf(stderr, "FAIL %s:", test_name);
  print_u128(" input=", input);
  print_u128(" expected=", expected);
  print_u128(" actual=", actual);
  fprintf(stderr, "\n");
}

static void expect_equal(const char *test_name, u128 input, u128 expected, u128 actual) {
  checks_run++;
  if (expected != actual)
    fail(test_name, input, expected, actual);
}

// ── conversions between u128 and big_number ─────────────────────────────

static void set_u128(big_number *number, u128 value) {
  uint32_t limbs[4];
  for (int index = 0; index < 4; index++)
    limbs[index] = (uint32_t)(value >> (32 * index));
  if (!big_number_set_limbs(number, limbs, 4)) {
    fprintf(stderr, "out of memory\n");
    exit(1);
  }
}

// Reads a big_number back as u128; *too_big is set if it needs more than 128 bits.
static u128 get_u128(const big_number *number, int *too_big) {
  *too_big = number->limb_count > 4;
  u128 value = 0;
  for (size_t index = number->limb_count; index-- > 0;)
    value = (value << 32) | number->limbs[index];
  return value;
}

static int is_normalized(const big_number *number) {
  return number->limb_count == 0 || number->limbs[number->limb_count - 1] != 0;
}

// ── reference implementations (u128) ─────────────────────────────────────

static int reference_bit_length(u128 value) {
  int bits = 0;
  while (value) {
    bits++;
    value >>= 1;
  }
  return bits;
}

// floor(√value), by binary search. root² can't overflow: root < 2^64.
static u128 reference_floor_square_root(u128 value) {
  u128 low = 0, high = (u128)1 << 64;
  while (high - low > 1) {
    u128 middle = (low + high) / 2;
    if (middle * middle <= value)
      low = middle;
    else
      high = middle;
  }
  return low;
}

// base^exponent mod modulus, by binary exponentiation. Every product is of two
// values below the modulus < 2^64, so it fits in 128 bits.
static u128 reference_power_mod(u128 base, u128 exponent, uint64_t modulus) {
  u128 result = 1 % modulus;
  base %= modulus;
  while (exponent) {
    if (exponent & 1)
      result = result * base % modulus;
    base = base * base % modulus;
    exponent >>= 1;
  }
  return result;
}

// ── random values ─────────────────────────────────────────────────────────

static uint64_t random_state = 0x9e3779b97f4a7c15ULL;

static uint64_t random_u64(void) { // xorshift64*
  random_state ^= random_state >> 12;
  random_state ^= random_state << 25;
  random_state ^= random_state >> 27;
  return random_state * 0x2545f4914f6cdd1dULL;
}

// A random value of a random bit length up to max_bits, so small and large
// values (and every limb count) come up often.
static u128 random_value(int max_bits) {
  int bits = (int)(random_u64() % (uint64_t)(max_bits + 1));
  u128 value = ((u128)random_u64() << 64) | random_u64();
  if (bits == 0)
    return 0;
  if (bits < 128)
    value &= ((u128)1 << bits) - 1;
  // Sometimes all ones or a power of two: the patterns where carries and borrows run furthest.
  switch (random_u64() % 8) {
  case 0: return bits < 128 ? ((u128)1 << bits) - 1 : ~(u128)0;
  case 1: return (u128)1 << (bits - 1);
  default: return value;
  }
}

static uint64_t random_small(void) {
  return (uint64_t)random_value(64);
}

// Values where the limb count changes, and their neighbors.
static const u128 EDGE_VALUES[] = {
    0, 1, 2, 3,
    ((u128)1 << 32) - 1, (u128)1 << 32, ((u128)1 << 32) + 1,
    ((u128)1 << 53) - 1, (u128)1 << 53, ((u128)1 << 53) + 1,
    ((u128)1 << 64) - 1, (u128)1 << 64, ((u128)1 << 64) + 1,
    ((u128)1 << 96) - 1, (u128)1 << 96, ((u128)1 << 96) + 1,
    ((u128)1 << 127), ~(u128)0 >> 1,
};
static const uint64_t EDGE_SMALLS[] = {0, 1, 2, UINT32_MAX, (uint64_t)UINT32_MAX + 1, UINT64_MAX - 1, UINT64_MAX};

#define EDGE_VALUE_COUNT (sizeof EDGE_VALUES / sizeof EDGE_VALUES[0])
#define EDGE_SMALL_COUNT (sizeof EDGE_SMALLS / sizeof EDGE_SMALLS[0])
#define RANDOM_ROUNDS 200000

// ── tests ─────────────────────────────────────────────────────────────────

static void check_conversions(u128 value) {
  big_number number;
  big_number_init(&number);
  set_u128(&number, value);
  int too_big;
  checks_run++;
  if (!is_normalized(&number))
    fail("set_limbs normalizes", value, 1, 0);
  expect_equal("round trip through limbs", value, value, get_u128(&number, &too_big));
  expect_equal("bit_length", value, (u128)reference_bit_length(value), big_number_bit_length(&number));
  expect_equal("is_odd", value, (u128)(value & 1), (u128)big_number_is_odd(&number));
  expect_equal("fits_u64", value, (u128)(value <= UINT64_MAX), (u128)big_number_fits_u64(&number));
  if (value <= UINT64_MAX) {
    // The fast path's uint64_t and the multi-limb value must agree.
    big_number from_u64;
    big_number_init(&from_u64);
    big_number_set_u64(&from_u64, (uint64_t)value);
    expect_equal("set_u64 matches set_limbs", value, 0, (u128)(big_number_compare(&from_u64, &number) != 0));
    expect_equal("to_u64", value, value, big_number_to_u64(&number));
    big_number_free(&from_u64);
  }
  big_number_free(&number);
}

static void check_compare(u128 first_value, u128 second_value) {
  big_number first, second;
  big_number_init(&first);
  big_number_init(&second);
  set_u128(&first, first_value);
  set_u128(&second, second_value);
  int expected = first_value < second_value ? -1 : first_value > second_value ? 1 : 0;
  expect_equal("compare", first_value, (u128)(expected + 1), (u128)(big_number_compare(&first, &second) + 1));
  uint64_t small = (uint64_t)second_value;
  int expected_small = first_value < small ? -1 : first_value > small ? 1 : 0;
  expect_equal("compare_u64", first_value, (u128)(expected_small + 1), (u128)(big_number_compare_u64(&first, small) + 1));
  big_number_free(&first);
  big_number_free(&second);
}

static void check_add_small(u128 value, uint64_t small) {
  if (value > ~(u128)0 - small)
    return; // the reference would overflow 128 bits
  big_number number;
  big_number_init(&number);
  set_u128(&number, value);
  big_number_add_small(&number, small);
  int too_big;
  u128 actual = get_u128(&number, &too_big);
  expect_equal("add_small", value, value + small, too_big ? 0 : actual);
  checks_run++;
  if (!is_normalized(&number))
    fail("add_small normalizes", value, 1, 0);
  if (value <= UINT64_MAX && small <= UINT64_MAX - value) // the fast path agrees
    expect_equal("add_small matches uint64_t", value, (uint64_t)value + small, big_number_to_u64(&number));
  big_number_free(&number);
}

static void check_subtract_small(u128 value, uint64_t small) {
  big_number number;
  big_number_init(&number);
  set_u128(&number, value);
  int succeeded = big_number_subtract_small(&number, small);
  int too_big;
  u128 actual = get_u128(&number, &too_big);
  if (value >= small) {
    expect_equal("subtract_small succeeds", value, 1, (u128)succeeded);
    expect_equal("subtract_small", value, value - small, actual);
    checks_run++;
    if (!is_normalized(&number))
      fail("subtract_small normalizes", value, 1, 0);
  } else {
    expect_equal("subtract_small refuses to go below zero", value, 0, (u128)succeeded);
    expect_equal("subtract_small leaves it unchanged", value, value, actual);
  }
  big_number_free(&number);
}

static void check_mod_small(u128 value, uint64_t divisor) {
  if (divisor == 0)
    return;
  big_number number;
  big_number_init(&number);
  set_u128(&number, value);
  expect_equal("mod_small", value, value % divisor, big_number_mod_small(&number, divisor));
  big_number_free(&number);
}

static void check_square_root(u128 value) {
  big_number number, root;
  big_number_init(&number);
  big_number_init(&root);
  set_u128(&number, value);
  big_number_square_root_upper(&number, &root);
  int too_big;
  u128 actual = get_u128(&root, &too_big);
  u128 floor_root = reference_floor_square_root(value);
  if (value <= UINT64_MAX) {
    expect_equal("square_root_upper is exact below 2^64", value, floor_root, actual);
  } else {
    // Never below floor(√value), and above it by at most 1 part in 2^28 (plus 2).
    checks_run++;
    if (actual < floor_root)
      fail("square_root_upper never rounds down", value, floor_root, actual);
    checks_run++;
    if (actual > floor_root + (floor_root >> 28) + 2)
      fail("square_root_upper stays close", value, floor_root, actual);
  }
  big_number_free(&number);
  big_number_free(&root);
}

static void check_add(u128 first_value, u128 second_value) {
  if (first_value > ~(u128)0 - second_value)
    return; // the reference would overflow 128 bits
  big_number first, second, sum;
  big_number_init(&first);
  big_number_init(&second);
  big_number_init(&sum);
  set_u128(&first, first_value);
  set_u128(&second, second_value);
  big_number_add(&sum, &first, &second);
  int too_big;
  expect_equal("add", first_value, first_value + second_value, get_u128(&sum, &too_big));
  checks_run++;
  if (!is_normalized(&sum))
    fail("add normalizes", first_value, 1, 0);
  // The output may be one of the inputs.
  big_number_add(&first, &first, &second);
  expect_equal("add into its first input", first_value, first_value + second_value, get_u128(&first, &too_big));
  big_number_free(&first);
  big_number_free(&second);
  big_number_free(&sum);
}

static void check_subtract(u128 first_value, u128 second_value) {
  big_number first, second, difference;
  big_number_init(&first);
  big_number_init(&second);
  big_number_init(&difference);
  set_u128(&first, first_value);
  set_u128(&second, second_value);
  set_u128(&difference, 12345); // to see that a refused subtraction leaves it alone
  int succeeded = big_number_subtract(&difference, &first, &second);
  int too_big;
  if (first_value >= second_value) {
    expect_equal("subtract succeeds", first_value, 1, (u128)succeeded);
    expect_equal("subtract", first_value, first_value - second_value, get_u128(&difference, &too_big));
    checks_run++;
    if (!is_normalized(&difference))
      fail("subtract normalizes", first_value, 1, 0);
    big_number_subtract(&second, &first, &second); // into its second input
    expect_equal("subtract into its second input", first_value, first_value - second_value, get_u128(&second, &too_big));
  } else {
    expect_equal("subtract refuses to go below zero", first_value, 0, (u128)succeeded);
    expect_equal("subtract leaves the result unchanged", first_value, 12345, get_u128(&difference, &too_big));
  }
  big_number_free(&first);
  big_number_free(&second);
  big_number_free(&difference);
}

static void check_multiply(u128 first_value, u128 second_value) {
  if (first_value != 0 && second_value > ~(u128)0 / first_value)
    return; // the reference would overflow 128 bits
  big_number first, second, product;
  big_number_init(&first);
  big_number_init(&second);
  big_number_init(&product);
  set_u128(&first, first_value);
  set_u128(&second, second_value);
  big_number_multiply(&product, &first, &second);
  int too_big;
  expect_equal("multiply", first_value, first_value * second_value, get_u128(&product, &too_big));
  checks_run++;
  if (!is_normalized(&product))
    fail("multiply normalizes", first_value, 1, 0);
  big_number_multiply(&first, &first, &first); // squaring in place
  if (first_value <= UINT64_MAX)
    expect_equal("multiply squares in place", first_value, first_value * first_value, get_u128(&first, &too_big));
  big_number_free(&first);
  big_number_free(&second);
  big_number_free(&product);
}

static void check_shifts(u128 value, size_t bits) {
  big_number number, shifted;
  big_number_init(&number);
  big_number_init(&shifted);
  set_u128(&number, value);
  int too_big;
  big_number_shift_right(&shifted, &number, bits);
  expect_equal("shift_right", value, bits >= 128 ? 0 : value >> bits, get_u128(&shifted, &too_big));
  checks_run++;
  if (!is_normalized(&shifted))
    fail("shift_right normalizes", value, 1, 0);
  if (bits < 128 && (value >> (127 - bits)) <= 1 && (bits == 0 || value >> (128 - bits) == 0)) {
    big_number_shift_left(&shifted, &number, bits);
    expect_equal("shift_left", value, value << bits, get_u128(&shifted, &too_big));
    checks_run++;
    if (!is_normalized(&shifted))
      fail("shift_left normalizes", value, 1, 0);
  }
  big_number_free(&number);
  big_number_free(&shifted);
}

static void check_divide(u128 dividend_value, u128 divisor_value) {
  big_number dividend, divisor, quotient, remainder;
  big_number_init(&dividend);
  big_number_init(&divisor);
  big_number_init(&quotient);
  big_number_init(&remainder);
  set_u128(&dividend, dividend_value);
  set_u128(&divisor, divisor_value);
  int too_big;
  if (divisor_value == 0) {
    set_u128(&quotient, 777);
    expect_equal("divide by zero is refused", dividend_value, 0, (u128)big_number_divide(&quotient, &remainder, &dividend, &divisor));
    expect_equal("divide by zero leaves the quotient unchanged", dividend_value, 777, get_u128(&quotient, &too_big));
  } else {
    big_number_divide(&quotient, &remainder, &dividend, &divisor);
    expect_equal("divide: quotient", dividend_value, dividend_value / divisor_value, get_u128(&quotient, &too_big));
    expect_equal("divide: remainder", dividend_value, dividend_value % divisor_value, get_u128(&remainder, &too_big));
    checks_run++;
    if (!is_normalized(&quotient) || !is_normalized(&remainder))
      fail("divide normalizes", dividend_value, 1, 0);
    // Outputs that are the inputs, and an output left out.
    big_number_divide(&dividend, NULL, &dividend, &divisor);
    expect_equal("divide: quotient into the dividend", dividend_value, dividend_value / divisor_value, get_u128(&dividend, &too_big));
    set_u128(&dividend, dividend_value);
    big_number_divide(NULL, &divisor, &dividend, &divisor);
    expect_equal("divide: remainder into the divisor", dividend_value, dividend_value % divisor_value, get_u128(&divisor, &too_big));
  }
  big_number_free(&dividend);
  big_number_free(&divisor);
  big_number_free(&quotient);
  big_number_free(&remainder);
}

static void check_montgomery(u128 base_value, u128 exponent_value, uint64_t modulus_value) {
  big_number modulus, base, exponent, result;
  big_number_init(&modulus);
  big_number_init(&base);
  big_number_init(&exponent);
  big_number_init(&result);
  big_number_set_u64(&modulus, modulus_value);
  set_u128(&base, base_value);
  set_u128(&exponent, exponent_value);
  montgomery_context context;
  int set_up = montgomery_init(&context, &modulus);
  int usable = (modulus_value & 1) && modulus_value > 1;
  expect_equal("montgomery_init accepts odd moduli above 1, only", modulus_value, (u128)usable, (u128)set_up);
  if (set_up) {
    int too_big;
    montgomery_power(&context, &result, &base, &exponent);
    expect_equal("montgomery_power", base_value, reference_power_mod(base_value, exponent_value, modulus_value),
                 get_u128(&result, &too_big));
    // Into and out of Montgomery form gives back value mod N.
    big_number form;
    big_number_init(&form);
    montgomery_to_form(&context, &form, &base);
    montgomery_from_form(&context, &form, &form);
    expect_equal("montgomery form round trip", base_value, base_value % modulus_value, get_u128(&form, &too_big));
    big_number_free(&form);
  }
  montgomery_free(&context);
  big_number_free(&modulus);
  big_number_free(&base);
  big_number_free(&exponent);
  big_number_free(&result);
}

// Algorithm D's "add back" step runs when the first guess at a quotient limb
// was one too big, about 2 times in 2^32: random tests almost never reach it.
// This division does (from H. Warren, Hacker's Delight, the 32-bit-digit
// example of the add-back case): 0x7fffffff_80000000_00000000_00000000 /
// 0x80000000_00000000_00000001.
static void check_divide_add_back(void) {
  u128 dividend = ((u128)0x7fffffff80000000ULL << 64);
  u128 divisor = ((u128)0x80000000ULL << 64) | 1;
  check_divide(dividend, divisor);
}

// Small numbers' limbs come from a per-thread cache of blocks (bignum.c). Many
// numbers held at once must each have their own block, however many blocks are
// taken and given back, and growing past the block size must keep every limb.
// Run under AddressSanitizer too (tests/native/run.sh asan): that's what sees a
// write past a block's end.
#define NUMBERS_HELD 200
#define LIMBS_FILLING_A_BLOCK 32
static void check_block_cache(void) {
  static big_number numbers[NUMBERS_HELD];
  for (int round = 0; round < 3; round++) {
    for (int index = 0; index < NUMBERS_HELD; index++) {
      big_number_init(&numbers[index]);
      big_number_set_u64(&numbers[index], (uint64_t)index * 1000003 + (uint64_t)round);
    }
    for (int index = 0; index < NUMBERS_HELD; index++)
      expect_equal("each number has its own block", (u128)index, (uint64_t)index * 1000003 + (uint64_t)round,
                   big_number_to_u64(&numbers[index]));
    for (int index = 0; index < NUMBERS_HELD; index++)
      big_number_free(&numbers[index]);
  }

  // all ones in exactly a block's worth of limbs, then + 1: one more limb, 2^1024
  uint32_t all_ones[LIMBS_FILLING_A_BLOCK + 1];
  for (int index = 0; index < LIMBS_FILLING_A_BLOCK + 1; index++)
    all_ones[index] = UINT32_MAX;
  big_number grown;
  big_number_init(&grown);
  big_number_set_limbs(&grown, all_ones, LIMBS_FILLING_A_BLOCK);
  big_number_add_small(&grown, 1);
  expect_equal("growing past a block: limb count", 0, LIMBS_FILLING_A_BLOCK + 1, grown.limb_count);
  expect_equal("growing past a block: top limb", 0, 1, grown.limbs[LIMBS_FILLING_A_BLOCK]);
  big_number_shift_left(&grown, &grown, 32 * LIMBS_FILLING_A_BLOCK);
  expect_equal("shifting further: limb count", 0, 2 * LIMBS_FILLING_A_BLOCK + 1, grown.limb_count);
  big_number_free(&grown);
  for (size_t limbs = LIMBS_FILLING_A_BLOCK - 3; limbs <= LIMBS_FILLING_A_BLOCK + 1; limbs++) {
    // Montgomery's working space is limbs + 2: this crosses the block size
    big_number modulus, base, exponent, result;
    big_number_init(&modulus);
    big_number_init(&base);
    big_number_init(&exponent);
    big_number_init(&result);
    big_number_set_limbs(&modulus, all_ones, limbs); // 2^(32 · limbs) − 1 is odd
    big_number_set_u64(&base, 2);
    big_number_set_u64(&exponent, 32 * (uint64_t)limbs);
    montgomery_context context;
    expect_equal("montgomery at the block size: set up", limbs, 1, (u128)montgomery_init(&context, &modulus));
    montgomery_power(&context, &result, &base, &exponent); // 2^(32 · limbs) ≡ 1
    expect_equal("montgomery at the block size: result", limbs, 1, big_number_to_u64(&result));
    expect_equal("montgomery at the block size: one limb", limbs, 1, result.limb_count);
    montgomery_free(&context);
    big_number_free(&modulus);
    big_number_free(&base);
    big_number_free(&exponent);
    big_number_free(&result);
  }
}

// ── inverses, Jacobi symbols, square roots ────────────────────────────────

static u128 small_gcd(u128 first, u128 second) {
  while (second) {
    u128 rest = first % second;
    first = second;
    second = rest;
  }
  return first;
}

static void check_inverse(u128 value, uint64_t modulus_value) {
  big_number number, modulus, inverse;
  big_number_init(&number);
  big_number_init(&modulus);
  big_number_init(&inverse);
  set_u128(&number, value);
  big_number_set_u64(&modulus, modulus_value);
  int status = big_number_inverse_mod(&inverse, &number, &modulus);
  int too_big;
  u128 got = get_u128(&inverse, &too_big);
  if (modulus_value == 1) {
    expect_equal("inverse mod 1 is 0", value, 0, got);
  } else if (small_gcd(value % modulus_value, modulus_value) == 1) {
    expect_equal("inverse exists", value, 1, (u128)status);
    checks_run++;
    if (got >= modulus_value)
      fail("inverse is reduced", value, modulus_value, got);
    expect_equal("inverse multiplies to 1", value, 1, (value % modulus_value) * got % modulus_value);
  } else {
    expect_equal("no inverse when a factor is shared", value, 0, (u128)(status + 1));
  }
  big_number_free(&number);
  big_number_free(&modulus);
  big_number_free(&inverse);
}

// The Jacobi symbol from its definition: the product of Legendre symbols of
// bottom's prime factors, each by Euler's criterion.
static int reference_jacobi(uint64_t top, uint64_t bottom) {
  int symbol = 1;
  uint64_t rest = bottom;
  for (uint64_t prime = 3; rest > 1; prime += 2) {
    if (prime * prime > rest)
      prime = rest;
    while (rest % prime == 0) {
      rest /= prime;
      u128 power = reference_power_mod(top, (prime - 1) / 2, prime);
      symbol *= power == 0 ? 0 : power == 1 ? 1 : -1;
    }
  }
  return symbol;
}

static void check_jacobi(uint64_t top, uint64_t bottom) {
  big_number top_number, bottom_number;
  big_number_init(&top_number);
  big_number_init(&bottom_number);
  big_number_set_u64(&top_number, top);
  big_number_set_u64(&bottom_number, bottom);
  expect_equal("jacobi", top, (u128)(reference_jacobi(top, bottom) + 2), (u128)(big_number_jacobi(&top_number, &bottom_number) + 2));
  big_number_free(&top_number);
  big_number_free(&bottom_number);
}

static void check_square_root_mod(uint64_t value, uint64_t prime) {
  big_number number, modulus, root;
  big_number_init(&number);
  big_number_init(&modulus);
  big_number_init(&root);
  big_number_set_u64(&number, value);
  big_number_set_u64(&modulus, prime);
  int status = big_number_square_root_mod(&root, &number, &modulus);
  u128 reduced = value % prime;
  int is_square = reduced == 0 || reference_power_mod(reduced, (prime - 1) / 2, prime) == 1;
  expect_equal("square root exists exactly for squares", value, (u128)(is_square ? 2 : 0), (u128)(status + 1));
  if (is_square) {
    u128 got = big_number_to_u64(&root);
    expect_equal("square root squares back", value, reduced, got * got % prime);
  }
  big_number_free(&number);
  big_number_free(&modulus);
  big_number_free(&root);
}

static void check_ecpp_arithmetic(void) {
  // every value against small moduli, and random ones
  for (uint64_t modulus = 1; modulus < 400; modulus++)
    for (uint64_t value = 0; value < modulus + 3; value++)
      check_inverse(value, modulus);
  for (uint64_t bottom = 1; bottom < 600; bottom += 2)
    for (uint64_t top = 0; top < 300; top++)
      check_jacobi(top, bottom);
  // small primes, including ones with many factors of 2 in p − 1
  static const uint64_t small_primes[] = {3, 5, 7, 11, 13, 17, 97, 193, 257, 769, 7681, 12289};
  for (size_t index = 0; index < sizeof small_primes / sizeof *small_primes; index++) {
    uint64_t limit = small_primes[index] < 2000 ? small_primes[index] + 2 : 2000;
    for (uint64_t value = 0; value < limit; value++)
      check_square_root_mod(value, small_primes[index]);
  }
  // large primes: 2^61 − 1, 998244353 = 119 · 2^23 + 1, and 2^64 − 59
  static const uint64_t large_primes[] = {2305843009213693951ULL, 998244353ULL, 18446744073709551557ULL};
  for (int round = 0; round < 3000; round++) {
    uint64_t prime = large_primes[round % 3];
    u128 root = random_u64() % prime;
    check_square_root_mod((uint64_t)(root * root % prime), prime); // a square
    check_square_root_mod(random_u64(), prime);                    // half of these aren't
    check_inverse(random_value(128), prime);
    check_inverse(random_value(128), random_u64() | 1);
  }
  for (int round = 0; round < 3000; round++) {
    uint32_t bottom = ((uint32_t)random_u64() >> 12) | 1; // small enough to factor for the definition
    check_jacobi(random_u64(), bottom);
  }

  // A composite modulus must end, and any root it gives must be a real root.
  for (uint64_t modulus = 9; modulus < 2000; modulus += 2) {
    for (uint64_t value = 0; value < 50; value++) {
      big_number number, modulus_number, root;
      big_number_init(&number);
      big_number_init(&modulus_number);
      big_number_init(&root);
      big_number_set_u64(&number, value);
      big_number_set_u64(&modulus_number, modulus);
      if (big_number_square_root_mod(&root, &number, &modulus_number) == 1) {
        uint64_t got = big_number_to_u64(&root);
        expect_equal("a root modulo a composite is a real root", modulus, value % modulus, (u128)got * got % modulus);
      }
      big_number_free(&number);
      big_number_free(&modulus_number);
      big_number_free(&root);
    }
  }
}

int main(void) {
  check_block_cache();
  check_ecpp_arithmetic();
  for (size_t first = 0; first < EDGE_VALUE_COUNT; first++) {
    u128 value = EDGE_VALUES[first];
    check_conversions(value);
    check_square_root(value);
    for (size_t second = 0; second < EDGE_VALUE_COUNT; second++)
      check_compare(value, EDGE_VALUES[second]);
    for (size_t small = 0; small < EDGE_SMALL_COUNT; small++) {
      check_add_small(value, EDGE_SMALLS[small]);
      check_subtract_small(value, EDGE_SMALLS[small]);
      check_mod_small(value, EDGE_SMALLS[small]);
    }
    for (size_t second = 0; second < EDGE_VALUE_COUNT; second++) {
      check_add(value, EDGE_VALUES[second]);
      check_subtract(value, EDGE_VALUES[second]);
      check_multiply(value, EDGE_VALUES[second]);
      check_divide(value, EDGE_VALUES[second]);
    }
    for (size_t bits = 0; bits <= 130; bits++)
      check_shifts(value, bits);
    for (size_t small = 0; small < EDGE_SMALL_COUNT; small++)
      check_montgomery(value, value, EDGE_SMALLS[small]);
  }
  check_divide_add_back();

  for (int round = 0; round < RANDOM_ROUNDS; round++) {
    u128 value = random_value(128);
    uint64_t small = random_small();
    check_conversions(value);
    check_compare(value, random_value(128));
    check_compare(value, value);
    check_add_small(value, small);
    check_subtract_small(value, small);
    check_subtract_small(value, (uint64_t)value); // exactly down to zero, or the low 64 bits
    check_mod_small(value, small);
    check_square_root(value);
    u128 other = random_value(128);
    check_add(value, other);
    check_subtract(value, other);
    if (value != ~(u128)0) // value + 1 would wrap to 0
      check_subtract(value, value - (other % (value + 1))); // second <= first, so it succeeds
    check_multiply(value, random_value(128 - reference_bit_length(value)));
    check_divide(value, other);
    check_divide(value, random_value(64)); // single-limb and two-limb divisors
    check_shifts(value, (size_t)(random_u64() % 140));
    if (round % 4 == 0)
      check_montgomery(value, random_value(128), small | 1);
  }

  printf("native bignum tests: %d checks, %d failed\n", checks_run, checks_failed);
  return checks_failed == 0 ? 0 : 1;
}
