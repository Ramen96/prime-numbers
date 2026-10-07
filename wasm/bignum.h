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
// Only the primitives the sieve needs are here: compare, add or subtract a
// small value, "big mod small", conversion to and from uint64_t, and a square
// root that may round up but never down. Functions that can allocate return
// 1 on success and 0 if memory runs out, leaving the number unchanged.

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

#endif
