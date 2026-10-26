// Test-only harness that exposes wasm/bignum.c to JavaScript, so randomized
// tests can compare it with BigInt at any size (tests/wasm/bignum.test.ts).
// Not part of the site: built into .cache/ by `npm run test:wasm`.
//
// JavaScript writes limbs (least significant first) into the input buffers,
// calls an operation, and reads limbs back from the output buffer.

#include <stdint.h>
#include <stdlib.h>

#include "../../wasm/bignum.h"

#define MAX_TEST_LIMBS 4096
#define FAILED ((size_t)-1)

static uint32_t first_input[MAX_TEST_LIMBS];
static uint32_t second_input[MAX_TEST_LIMBS];
static uint32_t third_input[MAX_TEST_LIMBS];
// A product or a left shift can be twice as long as the inputs.
static uint32_t output_limbs[2 * MAX_TEST_LIMBS + 4];
static uint32_t second_output_limbs[2 * MAX_TEST_LIMBS + 4];
static size_t second_output_count;

uint32_t *harness_first_input(void) { return first_input; }
uint32_t *harness_second_input(void) { return second_input; }
uint32_t *harness_third_input(void) { return third_input; }
uint32_t *harness_output(void) { return output_limbs; }
uint32_t *harness_second_output(void) { return second_output_limbs; }
// The limb count of the last result written to the second output.
size_t harness_second_output_count(void) { return second_output_count; }

static big_number load(const uint32_t *limbs, size_t limb_count) {
  big_number number;
  big_number_init(&number);
  if (!big_number_set_limbs(&number, limbs, limb_count))
    abort();
  return number;
}

// Writes a number's limbs to an output buffer and frees it. Returns the limb count.
static size_t store_into(uint32_t *output, big_number *number) {
  size_t limb_count = number->limb_count;
  for (size_t index = 0; index < limb_count; index++)
    output[index] = number->limbs[index];
  big_number_free(number);
  return limb_count;
}

static size_t store(big_number *number) { return store_into(output_limbs, number); }

int harness_compare(size_t first_count, size_t second_count) {
  big_number first = load(first_input, first_count), second = load(second_input, second_count);
  int result = big_number_compare(&first, &second);
  big_number_free(&first);
  big_number_free(&second);
  return result;
}

size_t harness_add_small(size_t count, uint64_t value) {
  big_number number = load(first_input, count);
  if (!big_number_add_small(&number, value))
    abort();
  return store(&number);
}

// FAILED when the result would be negative.
size_t harness_subtract_small(size_t count, uint64_t value) {
  big_number number = load(first_input, count);
  if (!big_number_subtract_small(&number, value)) {
    big_number_free(&number);
    return FAILED;
  }
  return store(&number);
}

uint64_t harness_mod_small(size_t count, uint64_t divisor) {
  big_number number = load(first_input, count);
  uint64_t remainder = big_number_mod_small(&number, divisor);
  big_number_free(&number);
  return remainder;
}

size_t harness_square_root_upper(size_t count) {
  big_number number = load(first_input, count), root;
  big_number_init(&root);
  if (!big_number_square_root_upper(&number, &root))
    abort();
  big_number_free(&number);
  return store(&root);
}

size_t harness_bit_length(size_t count) {
  big_number number = load(first_input, count);
  size_t bits = big_number_bit_length(&number);
  big_number_free(&number);
  return bits;
}

// Two-input operations: first and second input, result in the output.
size_t harness_add(size_t first_count, size_t second_count) {
  big_number first = load(first_input, first_count), second = load(second_input, second_count);
  if (!big_number_add(&first, &first, &second))
    abort();
  big_number_free(&second);
  return store(&first);
}

// FAILED when the result would be negative.
size_t harness_subtract(size_t first_count, size_t second_count) {
  big_number first = load(first_input, first_count), second = load(second_input, second_count);
  int succeeded = big_number_subtract(&second, &first, &second);
  big_number_free(&first);
  if (!succeeded) {
    big_number_free(&second);
    return FAILED;
  }
  return store(&second);
}

size_t harness_multiply(size_t first_count, size_t second_count) {
  big_number first = load(first_input, first_count), second = load(second_input, second_count), product;
  big_number_init(&product);
  if (!big_number_multiply(&product, &first, &second))
    abort();
  big_number_free(&first);
  big_number_free(&second);
  return store(&product);
}

size_t harness_shift_left(size_t count, size_t bits) {
  big_number number = load(first_input, count);
  if (!big_number_shift_left(&number, &number, bits))
    abort();
  return store(&number);
}

size_t harness_shift_right(size_t count, size_t bits) {
  big_number number = load(first_input, count);
  if (!big_number_shift_right(&number, &number, bits))
    abort();
  return store(&number);
}

// Quotient in the output (its count returned), remainder in the second
// output (its count from harness_second_output_count). FAILED for a zero divisor.
size_t harness_divide(size_t dividend_count, size_t divisor_count) {
  big_number dividend = load(first_input, dividend_count), divisor = load(second_input, divisor_count);
  big_number quotient, remainder;
  big_number_init(&quotient);
  big_number_init(&remainder);
  int succeeded = big_number_divide(&quotient, &remainder, &dividend, &divisor);
  big_number_free(&dividend);
  big_number_free(&divisor);
  if (!succeeded)
    return FAILED;
  second_output_count = store_into(second_output_limbs, &remainder);
  return store(&quotient);
}

// base (first input) ^ exponent (second input) mod modulus (third input), by
// Montgomery exponentiation. FAILED if the modulus is even or below 2.
size_t harness_power_mod(size_t base_count, size_t exponent_count, size_t modulus_count) {
  big_number base = load(first_input, base_count), exponent = load(second_input, exponent_count);
  big_number modulus = load(third_input, modulus_count), result;
  big_number_init(&result);
  montgomery_context context;
  int set_up = montgomery_init(&context, &modulus);
  if (set_up && !montgomery_power(&context, &result, &base, &exponent))
    abort();
  montgomery_free(&context);
  big_number_free(&base);
  big_number_free(&exponent);
  big_number_free(&modulus);
  if (!set_up)
    return FAILED;
  return store(&result);
}
