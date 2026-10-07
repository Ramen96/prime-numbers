// Multi-limb unsigned integers. See bignum.h for the representation.

#include "bignum.h"

#include <math.h>
#include <stdlib.h>
#include <string.h>

#define LIMB_BITS 32

// ── internal helpers ──────────────────────────────────────────────────────

// Makes room for at least `needed` limbs, growing by doubling so repeated
// small growth stays cheap. Existing limbs are kept.
static int reserve_limbs(big_number *number, size_t needed) {
  if (needed <= number->limb_capacity)
    return 1;
  size_t new_capacity = number->limb_capacity ? number->limb_capacity : 4;
  while (new_capacity < needed) {
    if (new_capacity > SIZE_MAX / 2 / sizeof(uint32_t))
      return 0; // can't be allocated anyway; memory runs out long before this
    new_capacity *= 2;
  }
  uint32_t *grown = realloc(number->limbs, new_capacity * sizeof(uint32_t));
  if (!grown)
    return 0;
  number->limbs = grown;
  number->limb_capacity = new_capacity;
  return 1;
}

// Drops leading zero limbs, restoring the "normalized" invariant.
static void normalize(big_number *number) {
  while (number->limb_count > 0 && number->limbs[number->limb_count - 1] == 0)
    number->limb_count--;
}

// floor(√value) for a 64-bit value. The double square root can be off by one
// in either direction near 2^64, so it is corrected with exact integer checks.
// unsigned __int128 keeps (root + 1)² from overflowing when root is 2^32 − 1.
static uint64_t floor_square_root_u64(uint64_t value) {
  uint64_t root = (uint64_t)sqrt((double)value);
  while ((unsigned __int128)root * root > value)
    root--;
  while ((unsigned __int128)(root + 1) * (root + 1) <= value)
    root++;
  return root;
}

// The 64 bits of `number` starting at bit `bit_shift`: (number >> bit_shift)
// mod 2^64. Reads at most three limbs, so it costs the same at any size.
static uint64_t bits_starting_at(const big_number *number, size_t bit_shift) {
  size_t first_limb = bit_shift / LIMB_BITS;
  unsigned shift_within_limb = (unsigned)(bit_shift % LIMB_BITS);
  unsigned __int128 window = 0;
  for (size_t offset = 0; offset < 3; offset++) {
    size_t limb_index = first_limb + offset;
    if (limb_index < number->limb_count)
      window |= (unsigned __int128)number->limbs[limb_index] << (LIMB_BITS * offset);
  }
  return (uint64_t)(window >> shift_within_limb);
}

// Sets `number` to value · 2^bit_shift.
static int set_u64_shifted_left(big_number *number, uint64_t value, size_t bit_shift) {
  size_t zero_limbs = bit_shift / LIMB_BITS;
  unsigned shift_within_limb = (unsigned)(bit_shift % LIMB_BITS);
  // value << shift_within_limb needs at most 64 + 31 bits: three limbs.
  if (!reserve_limbs(number, zero_limbs + 3))
    return 0;
  memset(number->limbs, 0, zero_limbs * sizeof(uint32_t));
  unsigned __int128 shifted = (unsigned __int128)value << shift_within_limb;
  for (size_t offset = 0; offset < 3; offset++)
    number->limbs[zero_limbs + offset] = (uint32_t)(shifted >> (LIMB_BITS * offset));
  number->limb_count = zero_limbs + 3;
  normalize(number);
  return 1;
}

// ── lifecycle ─────────────────────────────────────────────────────────────

// Starts as zero, with nothing allocated.
void big_number_init(big_number *number) {
  number->limbs = NULL;
  number->limb_count = 0;
  number->limb_capacity = 0;
}

void big_number_free(big_number *number) {
  free(number->limbs);
  big_number_init(number);
}

int big_number_copy(big_number *destination, const big_number *source) {
  return big_number_set_limbs(destination, source->limbs, source->limb_count);
}

// ── conversion ────────────────────────────────────────────────────────────

// The fast path's values (below 2^64) become two limbs (or fewer).
int big_number_set_u64(big_number *number, uint64_t value) {
  if (!reserve_limbs(number, 2))
    return 0;
  number->limbs[0] = (uint32_t)value;
  number->limbs[1] = (uint32_t)(value >> LIMB_BITS);
  number->limb_count = 2;
  normalize(number);
  return 1;
}

// Copies limbs in (least significant first). Leading zero limbs are allowed
// in the input and dropped, so the result is normalized.
int big_number_set_limbs(big_number *number, const uint32_t *limbs, size_t limb_count) {
  if (!reserve_limbs(number, limb_count))
    return 0;
  if (limb_count > 0)
    memmove(number->limbs, limbs, limb_count * sizeof(uint32_t));
  number->limb_count = limb_count;
  normalize(number);
  return 1;
}

// True when the value fits the fast path (below 2^64).
int big_number_fits_u64(const big_number *number) {
  return number->limb_count <= 2;
}

// The value as uint64_t. Only meaningful when big_number_fits_u64 is true;
// otherwise it's the low 64 bits.
uint64_t big_number_to_u64(const big_number *number) {
  uint64_t low = number->limb_count > 0 ? number->limbs[0] : 0;
  uint64_t high = number->limb_count > 1 ? number->limbs[1] : 0;
  return low | (high << LIMB_BITS);
}

// ── inspection ────────────────────────────────────────────────────────────

// How many bits the value needs: 0 for zero, 1 for one, 64 for 2^63, …
size_t big_number_bit_length(const big_number *number) {
  if (number->limb_count == 0)
    return 0;
  uint32_t top_limb = number->limbs[number->limb_count - 1];
  size_t bits_in_top_limb = 0;
  while (top_limb) {
    bits_in_top_limb++;
    top_limb >>= 1;
  }
  return (number->limb_count - 1) * LIMB_BITS + bits_in_top_limb;
}

int big_number_is_odd(const big_number *number) {
  return number->limb_count > 0 && (number->limbs[0] & 1);
}

// ── comparison ────────────────────────────────────────────────────────────

// Normalized numbers with more limbs are larger. With the same count, the
// first differing limb from the top decides.
int big_number_compare(const big_number *first, const big_number *second) {
  if (first->limb_count != second->limb_count)
    return first->limb_count < second->limb_count ? -1 : 1;
  for (size_t index = first->limb_count; index-- > 0;) {
    if (first->limbs[index] != second->limbs[index])
      return first->limbs[index] < second->limbs[index] ? -1 : 1;
  }
  return 0;
}

int big_number_compare_u64(const big_number *number, uint64_t value) {
  if (!big_number_fits_u64(number))
    return 1; // three or more limbs: at least 2^64, so larger than any uint64_t
  uint64_t number_value = big_number_to_u64(number);
  return number_value < value ? -1 : number_value > value ? 1 : 0;
}

// ── arithmetic with a small value ─────────────────────────────────────────

// number += value. Schoolbook addition: add the value's two limbs to the
// bottom of the number, then carry upward. The carry can run past the top
// (e.g. 2^96 − 1 + 1), adding one limb.
int big_number_add_small(big_number *number, uint64_t value) {
  size_t length_needed = (number->limb_count > 2 ? number->limb_count : 2) + 1;
  if (!reserve_limbs(number, length_needed))
    return 0;
  // Treat limbs above the current count as zero.
  for (size_t index = number->limb_count; index < length_needed; index++)
    number->limbs[index] = 0;

  uint64_t carry = 0;
  for (size_t index = 0; index < length_needed; index++) {
    uint64_t addend = index == 0 ? (uint32_t)value : index == 1 ? (uint32_t)(value >> LIMB_BITS) : 0;
    if (addend == 0 && carry == 0 && index >= 2)
      break; // nothing more to add
    uint64_t sum = (uint64_t)number->limbs[index] + addend + carry;
    number->limbs[index] = (uint32_t)sum;
    carry = sum >> LIMB_BITS;
  }
  number->limb_count = length_needed;
  normalize(number);
  return 1;
}

// number −= value, borrowing upward. Returns 0 (and leaves the number
// unchanged) if the result would be negative: these numbers are unsigned.
int big_number_subtract_small(big_number *number, uint64_t value) {
  if (big_number_compare_u64(number, value) < 0)
    return 0;
  int64_t borrow = 0;
  for (size_t index = 0; index < number->limb_count; index++) {
    int64_t subtrahend = index == 0 ? (uint32_t)value : index == 1 ? (uint32_t)(value >> LIMB_BITS) : 0;
    if (subtrahend == 0 && borrow == 0 && index >= 2)
      break; // nothing more to subtract
    int64_t difference = (int64_t)number->limbs[index] - subtrahend - borrow;
    borrow = difference < 0;
    number->limbs[index] = (uint32_t)(difference + (borrow ? (int64_t)1 << LIMB_BITS : 0));
  }
  normalize(number);
  return 1;
}

// number mod divisor, for any 64-bit divisor (divisor must not be zero).
//
// Long division from the top limb down, keeping only the remainder:
//   remainder = (remainder · 2^32 + limb) mod divisor
// remainder < divisor < 2^64, so remainder · 2^32 + limb < 2^96. That needs
// more than 64 bits, so the intermediate is an unsigned __int128. (In Wasm the
// compiler turns the 128-bit modulo into a small helper call; it's exact.)
//
// This is how the sieve finds where a base prime first lands in a window
// whose start is a big number: (p − start mod p) mod p.
//
// Fast path: almost every base prime is below 2^32. Then remainder < 2^32 and
// remainder · 2^32 + limb < 2^64, so plain 64-bit arithmetic is exact. In Wasm
// that matters: 128-bit division is emulated in software, and near 2^64 this
// path makes a batch about 5× faster.
uint64_t big_number_mod_small(const big_number *number, uint64_t divisor) {
  if (divisor == 0)
    return 0; // undefined; callers never divide by zero
  if (divisor <= UINT32_MAX) {
    uint64_t small_remainder = 0;
    for (size_t index = number->limb_count; index-- > 0;)
      small_remainder = ((small_remainder << LIMB_BITS) | number->limbs[index]) % divisor;
    return small_remainder;
  }
  unsigned __int128 remainder = 0;
  for (size_t index = number->limb_count; index-- > 0;)
    remainder = ((remainder << LIMB_BITS) | number->limbs[index]) % divisor;
  return (uint64_t)remainder;
}

// ── square root ───────────────────────────────────────────────────────────

// Sets result to a value r with floor(√number) <= r, so base primes up to r
// cover every number up to `number`. Exact below 2^64.
//
// Above 2^64, take the top 64 bits: write number = top · 2^shift + rest with
// `shift` even and top < 2^64. Then
//   number < (top + 1) · 2^shift,  so  √number < √(top + 1) · 2^(shift/2)
// and floor(√top) + 1 >= √(top + 1), so
//   r = (floor(√top) + 1) · 2^(shift/2)
// is never below √number. Since top >= 2^62, √top >= 2^31 and the "+ 1"
// overestimates by at most 1 part in 2^31: a negligible amount of extra work.
int big_number_square_root_upper(const big_number *number, big_number *result) {
  if (big_number_fits_u64(number))
    return big_number_set_u64(result, floor_square_root_u64(big_number_to_u64(number)));

  size_t bit_length = big_number_bit_length(number);
  size_t shift = bit_length - 64;
  if (shift % 2 == 1)
    shift++; // even, so 2^shift has an exact square root; top then has 63 bits
  uint64_t top = bits_starting_at(number, shift);
  uint64_t root_of_top_rounded_up = floor_square_root_u64(top) + 1;
  return set_u64_shifted_left(result, root_of_top_rounded_up, shift / 2);
}
