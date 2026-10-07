// Native tests for wasm/bignum.c, against unsigned __int128 as the
// independent reference (values up to 128 bits). Randomized with a fixed seed
// so failures are reproducible, plus hand-picked values where limb counts
// change (2^32, 2^64, 2^96). Larger sizes are tested against JavaScript BigInt
// in tests/wasm/bignum.test.ts.
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

int main(void) {
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
  }

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
  }

  printf("native bignum tests: %d checks, %d failed\n", checks_run, checks_failed);
  return checks_failed == 0 ? 0 : 1;
}
