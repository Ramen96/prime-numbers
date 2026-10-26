// Multi-limb unsigned integers for the sieve (CLAUDE.md, Requirement B).
//
// A number is an array of 32-bit "limbs", least significant first:
//
//   value = limbs[0] + limbs[1]·2^32 + limbs[2]·2^64 + …
//
// with an explicit limb count that grows as needed. There is no maximum.
//
// Invariant ("normalized"): the most significant limb in use is never zero,
// so every value has exactly one representation. Zero has limb_count 0.
//
// The sieve's primitives: compare, add or subtract a small value, "big mod
// small", conversion to and from uint64_t, and a square root that may round up
// but never down. Then general arithmetic for Miller–Rabin (Phase 4) and the
// proofs after it: add, subtract, shift, multiply, long division with
// remainder, and Montgomery modular multiplication and exponentiation.
//
// Functions that can allocate return 1 on success and 0 if memory runs out,
// leaving their outputs unchanged. Unless a comment says otherwise, an output
// may be the same number as an input (result = first + result works).

#ifndef BIGNUM_H
#define BIGNUM_H

#include <stddef.h>
#include <stdint.h>

typedef struct {
  // Least significant limb first. NULL while nothing has been allocated.
  uint32_t *limbs;
  // Limbs in use. A fixed width, but one the hardware can't reach: size_t is
  // 32 bits in wasm32, allowing 2^32 limbs (16 GiB of limbs), four times more
  // than the 4 GiB a wasm32 module can address in total. Memory runs out first.
  size_t limb_count;
  // Limbs allocated (limb_capacity >= limb_count).
  size_t limb_capacity;
} big_number;

// Lifecycle
void big_number_init(big_number *number);
void big_number_free(big_number *number);
int big_number_copy(big_number *destination, const big_number *source);

// Conversion
int big_number_set_u64(big_number *number, uint64_t value);
int big_number_set_limbs(big_number *number, const uint32_t *limbs, size_t limb_count);
int big_number_fits_u64(const big_number *number);
uint64_t big_number_to_u64(const big_number *number);

// Inspection
size_t big_number_bit_length(const big_number *number);
int big_number_is_odd(const big_number *number);

// Comparison: -1 if first < second, 0 if equal, 1 if first > second.
int big_number_compare(const big_number *first, const big_number *second);
int big_number_compare_u64(const big_number *number, uint64_t value);

// Arithmetic with a small (64-bit) value
int big_number_add_small(big_number *number, uint64_t value);
int big_number_subtract_small(big_number *number, uint64_t value);
uint64_t big_number_mod_small(const big_number *number, uint64_t divisor);

// A square root that is never below floor(√number), and at most a tiny
// fraction above it (exact below 2^64).
int big_number_square_root_upper(const big_number *number, big_number *result);

// Arithmetic with another big number
int big_number_add(big_number *result, const big_number *first, const big_number *second);
// Returns 0 (result unchanged) if second > first: these numbers are unsigned.
int big_number_subtract(big_number *result, const big_number *first, const big_number *second);
int big_number_multiply(big_number *result, const big_number *first, const big_number *second);
// result = number · 2^bits, and floor(number / 2^bits).
int big_number_shift_left(big_number *result, const big_number *number, size_t bits);
int big_number_shift_right(big_number *result, const big_number *number, size_t bits);
// quotient = floor(dividend / divisor), remainder = dividend mod divisor.
// Either output may be NULL if it isn't needed; they must not be the same
// number as each other. Returns 0 if divisor is zero, outputs unchanged.
int big_number_divide(big_number *quotient, big_number *remainder, const big_number *dividend,
                      const big_number *divisor);

// Montgomery arithmetic modulo an odd number N > 1.
//
// Miller–Rabin raises numbers to large powers mod N: thousands of modular
// multiplications per candidate, and each would otherwise need a long
// division. Montgomery's method (Peter Montgomery, 1985) replaces the division
// with shifts. With R = 2^(32 · limbs of N), a number x is kept in "Montgomery
// form" x·R mod N, and montgomery_multiply turns a·R and b·R into a·b·R
// (mod N) using only multiplications, additions and limb shifts.
typedef struct {
  // N: odd and greater than 1.
  big_number modulus;
  // −N⁻¹ mod 2^32, which makes the low limb vanish at each step.
  uint32_t negated_inverse;
  // R² mod N, used to bring numbers into Montgomery form.
  big_number r_squared;
  // limbs of N + 2 limbs of working space for montgomery_multiply. A context
  // is therefore used by one thread at a time.
  uint32_t *scratch;
} montgomery_context;

// Returns 0 if the modulus is even or less than 2, or if memory runs out.
int montgomery_init(montgomery_context *context, const big_number *modulus);
void montgomery_free(montgomery_context *context);
// result = value·R mod N, for a value of any size.
int montgomery_to_form(montgomery_context *context, big_number *result, const big_number *value);
// result = value·R⁻¹ mod N: back from Montgomery form. value must be below N.
int montgomery_from_form(montgomery_context *context, big_number *result, const big_number *value);
// result = first · second · R⁻¹ mod N. Both inputs must be below N (in
// Montgomery form, they always are).
int montgomery_multiply(montgomery_context *context, big_number *result, const big_number *first,
                        const big_number *second);
// result = base^exponent mod N, for an ordinary (not Montgomery form) base of
// any size. The result is ordinary too.
int montgomery_power(montgomery_context *context, big_number *result, const big_number *base,
                     const big_number *exponent);

#endif
