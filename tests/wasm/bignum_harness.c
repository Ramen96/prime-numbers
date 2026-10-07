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
static uint32_t output_limbs[MAX_TEST_LIMBS + 4];

uint32_t *harness_first_input(void) { return first_input; }
uint32_t *harness_second_input(void) { return second_input; }
uint32_t *harness_output(void) { return output_limbs; }

static big_number load(const uint32_t *limbs, size_t limb_count) {
  big_number number;
  big_number_init(&number);
  if (!big_number_set_limbs(&number, limbs, limb_count))
    abort();
  return number;
}

// Writes the result's limbs to the output buffer and frees it. Returns the limb count.
static size_t store(big_number *number) {
  size_t limb_count = number->limb_count;
  for (size_t index = 0; index < limb_count; index++)
    output_limbs[index] = number->limbs[index];
  big_number_free(number);
  return limb_count;
}

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
