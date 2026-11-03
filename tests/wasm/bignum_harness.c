// Test-only harness that exposes wasm/bignum.c and wasm/primality.c to
// JavaScript, so randomized tests can compare them with BigInt at any size
// (tests/wasm/bignum.test.ts, tests/wasm/primality.test.ts).
// Not part of the site: built into .cache/ by `npm run test:wasm`.
//
// JavaScript writes limbs (least significant first) into the input buffers,
// calls an operation, and reads limbs back from the output buffer.

#include <stdint.h>
#include <stdlib.h>

#include "../../wasm/bignum.h"
#include "../../wasm/ecpp.h"
#include "../../wasm/primality.h"

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
static uint32_t fourth_input[MAX_TEST_LIMBS];
static uint32_t fifth_input[MAX_TEST_LIMBS];
uint32_t *harness_fourth_input(void) { return fourth_input; }
uint32_t *harness_fifth_input(void) { return fifth_input; }
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

// ── primality ─────────────────────────────────────────────────────────────

static uint32_t last_evidence;

// The evidence from the last composite verdict (a factor or a witness base).
uint32_t harness_last_evidence(void) { return last_evidence; }

// The verdict (a primality_verdict value) for the first input.
int harness_miller_rabin(size_t count) {
  big_number candidate = load(first_input, count);
  last_evidence = 0;
  primality_verdict verdict = miller_rabin(&candidate, &last_evidence);
  big_number_free(&candidate);
  return (int)verdict;
}

// The same, always by the multi-limb path.
int harness_miller_rabin_multi_limb(size_t count) {
  big_number candidate = load(first_input, count);
  last_evidence = 0;
  primality_verdict verdict = miller_rabin_multi_limb(&candidate, &last_evidence);
  big_number_free(&candidate);
  return (int)verdict;
}

// One strong test: 1 passes, 0 witness, -1 out of memory.
int harness_strong_probable_prime(size_t count, uint32_t base) {
  big_number candidate = load(first_input, count);
  int result = strong_probable_prime(&candidate, base);
  big_number_free(&candidate);
  return result;
}

// The BPSW verdict (a primality_verdict value) for the first input.
int harness_bpsw(size_t count) {
  big_number candidate = load(first_input, count);
  last_evidence = 0;
  primality_verdict verdict = bpsw(&candidate, &last_evidence);
  big_number_free(&candidate);
  return (int)verdict;
}

// The strong Lucas test alone: 1 passes, 0 composite, -1 out of memory.
int harness_strong_lucas(size_t count) {
  big_number candidate = load(first_input, count);
  int result = strong_lucas_probable_prime(&candidate);
  big_number_free(&candidate);
  return result;
}

// ── for ECPP ──────────────────────────────────────────────────────────────

// first⁻¹ mod second, in the output. FAILED if there's no inverse.
size_t harness_inverse_mod(size_t value_count, size_t modulus_count) {
  big_number value = load(first_input, value_count), modulus = load(second_input, modulus_count), result;
  big_number_init(&result);
  int status = big_number_inverse_mod(&result, &value, &modulus);
  big_number_free(&value);
  big_number_free(&modulus);
  if (status == 0)
    abort();
  if (status < 0) {
    big_number_free(&result);
    return FAILED;
  }
  return store(&result);
}

int harness_jacobi(size_t top_count, size_t bottom_count) {
  big_number top = load(first_input, top_count), bottom = load(second_input, bottom_count);
  int symbol = big_number_jacobi(&top, &bottom);
  big_number_free(&top);
  big_number_free(&bottom);
  return symbol;
}

// A square root of first mod second, in the output. FAILED if none was found.
size_t harness_square_root_mod(size_t value_count, size_t modulus_count) {
  big_number value = load(first_input, value_count), modulus = load(second_input, modulus_count), result;
  big_number_init(&result);
  int status = big_number_square_root_mod(&result, &value, &modulus);
  big_number_free(&value);
  big_number_free(&modulus);
  if (status == 0)
    abort();
  if (status < 0) {
    big_number_free(&result);
    return FAILED;
  }
  return store(&result);
}

// ── elliptic curves ───────────────────────────────────────────────────────

// Inputs: modulus (first), a (second), x (third), y (fourth), scalar (fifth), with
// b 0 or set by harness_curve_b. x in the output, y in the second output (its count
// from harness_second_output_count), the status returned, and x's count from
// harness_first_output_count.
static uint32_t curve_b = 0;
static size_t first_output_count;
void harness_curve_b(uint32_t b) { curve_b = b; }
size_t harness_first_output_count(void) { return first_output_count; }

int harness_curve_multiply(size_t modulus_count, size_t a_count, size_t x_count, size_t y_count, size_t scalar_count) {
  big_number modulus = load(first_input, modulus_count), a = load(second_input, a_count), b;
  big_number x = load(third_input, x_count), y = load(fourth_input, y_count), scalar = load(fifth_input, scalar_count);
  big_number out_x, out_y;
  big_number_init(&b);
  big_number_init(&out_x);
  big_number_init(&out_y);
  big_number_set_u64(&b, curve_b);
  ecpp_curve curve;
  if (!ecpp_curve_init(&curve, &modulus, &a, &b))
    abort();
  ecpp_status status = ecpp_multiply(&curve, &out_x, &out_y, &x, &y, &scalar);
  first_output_count = store(&out_x);
  second_output_count = store_into(second_output_limbs, &out_y);
  ecpp_curve_free(&curve);
  big_number_free(&modulus);
  big_number_free(&a);
  big_number_free(&b);
  big_number_free(&x);
  big_number_free(&y);
  big_number_free(&scalar);
  return (int)status;
}

// Inputs: modulus (first), a (second), start x (third). As above for the outputs.
int harness_curve_find_point(size_t modulus_count, size_t a_count, size_t start_count) {
  big_number modulus = load(first_input, modulus_count), a = load(second_input, a_count), b;
  big_number start = load(third_input, start_count), out_x, out_y;
  big_number_init(&b);
  big_number_init(&out_x);
  big_number_init(&out_y);
  big_number_set_u64(&b, curve_b);
  ecpp_curve curve;
  if (!ecpp_curve_init(&curve, &modulus, &a, &b))
    abort();
  ecpp_status status = ecpp_find_point(&curve, &out_x, &out_y, &start);
  first_output_count = store(&out_x);
  second_output_count = store_into(second_output_limbs, &out_y);
  ecpp_curve_free(&curve);
  big_number_free(&modulus);
  big_number_free(&a);
  big_number_free(&b);
  big_number_free(&start);
  return (int)status;
}
