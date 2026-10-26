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

// The limb at `index`, or 0 past the top: a normalized number has no stored
// leading zeros, but arithmetic treats it as having as many as it needs.
static uint32_t limb_at(const big_number *number, size_t index) {
  return index < number->limb_count ? number->limbs[index] : 0;
}

// Hands `source`'s storage to `destination` (freeing what it held) and
// leaves `source` empty. Results are built in a separate number and moved in
// at the end, so an output can be the same number as an input, and a failed
// allocation leaves the output unchanged.
static void move_into(big_number *destination, big_number *source) {
  free(destination->limbs);
  *destination = *source;
  big_number_init(source);
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

// ── arithmetic with another big number ────────────────────────────────────

// result = first + second. Schoolbook addition, limb by limb from the bottom,
// carrying upward: each step adds two limbs and a carry of 0 or 1, at most
// 2^33 − 1, so a uint64_t holds it. The sum has at most one limb more than
// the longer input.
int big_number_add(big_number *result, const big_number *first, const big_number *second) {
  size_t longer = first->limb_count > second->limb_count ? first->limb_count : second->limb_count;
  big_number sum;
  big_number_init(&sum);
  if (!reserve_limbs(&sum, longer + 1))
    return 0;
  uint64_t carry = 0;
  for (size_t index = 0; index < longer; index++) {
    uint64_t total = (uint64_t)limb_at(first, index) + limb_at(second, index) + carry;
    sum.limbs[index] = (uint32_t)total;
    carry = total >> LIMB_BITS;
  }
  sum.limbs[longer] = (uint32_t)carry;
  sum.limb_count = longer + 1;
  normalize(&sum);
  move_into(result, &sum);
  return 1;
}

// result = first − second, borrowing upward. Returns 0 (result unchanged) if
// second > first.
int big_number_subtract(big_number *result, const big_number *first, const big_number *second) {
  if (big_number_compare(first, second) < 0)
    return 0;
  big_number difference;
  big_number_init(&difference);
  if (!reserve_limbs(&difference, first->limb_count))
    return 0;
  int64_t borrow = 0;
  for (size_t index = 0; index < first->limb_count; index++) {
    int64_t limb_difference = (int64_t)first->limbs[index] - limb_at(second, index) - borrow;
    borrow = limb_difference < 0;
    difference.limbs[index] = (uint32_t)(limb_difference + (borrow ? (int64_t)1 << LIMB_BITS : 0));
  }
  difference.limb_count = first->limb_count;
  normalize(&difference);
  move_into(result, &difference);
  return 1;
}

// result = first · second. Schoolbook multiplication: every limb of one
// times every limb of the other, added in at the sum of their positions.
// Each step computes
//   product[i + j] + first[i] · second[j] + carry
// which is at most (2^32 − 1) + (2^32 − 1)² + (2^32 − 1) = 2^64 − 1, so a
// uint64_t holds it exactly. It takes (limbs of first) × (limbs of second)
// steps. Faster methods (Karatsuba) only pay for numbers of hundreds of limbs,
// far beyond Phase 4's three; they can replace this later without changing
// how it's called.
int big_number_multiply(big_number *result, const big_number *first, const big_number *second) {
  if (first->limb_count == 0 || second->limb_count == 0) {
    result->limb_count = 0;
    return 1;
  }
  if (first->limb_count > SIZE_MAX - second->limb_count)
    return 0; // can't be allocated anyway; memory runs out long before this
  size_t product_limbs = first->limb_count + second->limb_count;
  big_number product;
  big_number_init(&product);
  if (!reserve_limbs(&product, product_limbs))
    return 0;
  memset(product.limbs, 0, product_limbs * sizeof(uint32_t));
  for (size_t first_index = 0; first_index < first->limb_count; first_index++) {
    uint64_t carry = 0;
    uint64_t first_limb = first->limbs[first_index];
    for (size_t second_index = 0; second_index < second->limb_count; second_index++) {
      uint64_t step = product.limbs[first_index + second_index] + first_limb * second->limbs[second_index] + carry;
      product.limbs[first_index + second_index] = (uint32_t)step;
      carry = step >> LIMB_BITS;
    }
    // Nothing has been written at this position yet: earlier rows end below it.
    product.limbs[first_index + second->limb_count] = (uint32_t)carry;
  }
  product.limb_count = product_limbs;
  normalize(&product);
  move_into(result, &product);
  return 1;
}

// result = number · 2^bits: whole limbs of zeros at the bottom, then each limb
// shifted by the remaining bits, with what spills out of one limb carried
// into the next.
int big_number_shift_left(big_number *result, const big_number *number, size_t bits) {
  if (number->limb_count == 0) {
    result->limb_count = 0;
    return 1;
  }
  size_t zero_limbs = bits / LIMB_BITS;
  unsigned shift_within_limb = (unsigned)(bits % LIMB_BITS);
  if (zero_limbs > SIZE_MAX - number->limb_count - 1)
    return 0; // can't be allocated anyway; memory runs out long before this
  size_t shifted_limbs = number->limb_count + zero_limbs + 1;
  big_number shifted;
  big_number_init(&shifted);
  if (!reserve_limbs(&shifted, shifted_limbs))
    return 0;
  memset(shifted.limbs, 0, zero_limbs * sizeof(uint32_t));
  uint32_t spilled = 0;
  for (size_t index = 0; index < number->limb_count; index++) {
    uint32_t limb = number->limbs[index];
    shifted.limbs[zero_limbs + index] = (limb << shift_within_limb) | spilled;
    spilled = shift_within_limb ? limb >> (LIMB_BITS - shift_within_limb) : 0;
  }
  shifted.limbs[shifted_limbs - 1] = spilled;
  shifted.limb_count = shifted_limbs;
  normalize(&shifted);
  move_into(result, &shifted);
  return 1;
}

// result = floor(number / 2^bits): drop whole limbs from the bottom, then
// shift each remaining limb down, pulling in the low bits of the one above.
int big_number_shift_right(big_number *result, const big_number *number, size_t bits) {
  size_t dropped_limbs = bits / LIMB_BITS;
  unsigned shift_within_limb = (unsigned)(bits % LIMB_BITS);
  if (dropped_limbs >= number->limb_count) {
    result->limb_count = 0;
    return 1;
  }
  size_t shifted_limbs = number->limb_count - dropped_limbs;
  big_number shifted;
  big_number_init(&shifted);
  if (!reserve_limbs(&shifted, shifted_limbs))
    return 0;
  for (size_t index = 0; index < shifted_limbs; index++) {
    uint32_t low = number->limbs[dropped_limbs + index];
    uint32_t high = limb_at(number, dropped_limbs + index + 1);
    shifted.limbs[index] = shift_within_limb ? (low >> shift_within_limb) | (high << (LIMB_BITS - shift_within_limb)) : low;
  }
  shifted.limb_count = shifted_limbs;
  normalize(&shifted);
  move_into(result, &shifted);
  return 1;
}

// Division by a single-limb divisor: long division from the top limb down,
//   remainder · 2^32 + limb  <  divisor · 2^32  <=  2^64
// so plain 64-bit arithmetic is exact. Writes the quotient's limbs into
// `quotient` (which has room for the dividend's count) and returns the remainder.
static uint32_t divide_by_limb(big_number *quotient, const big_number *dividend, uint32_t divisor) {
  uint64_t remainder = 0;
  for (size_t index = dividend->limb_count; index-- > 0;) {
    uint64_t current = (remainder << LIMB_BITS) | dividend->limbs[index];
    quotient->limbs[index] = (uint32_t)(current / divisor);
    remainder = current % divisor;
  }
  quotient->limb_count = dividend->limb_count;
  normalize(quotient);
  return (uint32_t)remainder;
}

// quotient = floor(dividend / divisor), remainder = dividend mod divisor.
//
// Knuth's Algorithm D (The Art of Computer Programming, vol. 2, §4.3.1), the
// schoolbook long division done one limb of quotient at a time, as in the
// version in Hacker's Delight (H. Warren, §9-2):
//
//   1. Normalize: shift both numbers left until the divisor's top limb has
//      its top bit set. That doesn't change the quotient (the remainder is
//      shifted back at the end), and it makes the guesses below nearly exact.
//   2. For each quotient limb from the top: guess it from the top two limbs
//      of what's left of the dividend and the top limb of the divisor. The
//      guess is never too small and, after the correction against the
//      divisor's second limb, at most one too big.
//   3. Subtract guess × divisor. If that went negative (the rare case where
//      the guess was one too big, about 2 in 2^32), add the divisor back and
//      lower the guess by one.
//
// It takes about (quotient limbs) × (divisor limbs) steps.
int big_number_divide(big_number *quotient, big_number *remainder, const big_number *dividend,
                      const big_number *divisor) {
  if (divisor->limb_count == 0)
    return 0; // undefined
  if (big_number_compare(dividend, divisor) < 0) {
    // The quotient is 0 and the remainder is the dividend. The remainder is
    // set first, in case the quotient is the same number as the dividend.
    if (remainder && !big_number_copy(remainder, dividend))
      return 0;
    if (quotient)
      quotient->limb_count = 0;
    return 1;
  }

  size_t divisor_limbs = divisor->limb_count;
  size_t quotient_limbs = dividend->limb_count - divisor_limbs + 1;
  big_number quotient_result, remainder_result;
  big_number_init(&quotient_result);
  big_number_init(&remainder_result);
  if (!reserve_limbs(&quotient_result, dividend->limb_count))
    return 0;

  if (divisor_limbs == 1) {
    uint32_t small_remainder = divide_by_limb(&quotient_result, dividend, divisor->limbs[0]);
    if (!big_number_set_u64(&remainder_result, small_remainder)) {
      big_number_free(&quotient_result);
      return 0;
    }
  } else {
    // Step 1: normalize into working copies. The dividend gains a limb on top
    // (whatever the shift pushes out of its top limb, possibly 0).
    unsigned shift = 0;
    for (uint32_t top = divisor->limbs[divisor_limbs - 1]; !(top & 0x80000000u); top <<= 1)
      shift++;
    big_number divisor_shifted, dividend_shifted;
    big_number_init(&divisor_shifted);
    big_number_init(&dividend_shifted);
    if (!reserve_limbs(&divisor_shifted, divisor_limbs) ||
        !reserve_limbs(&dividend_shifted, dividend->limb_count + 1) ||
        !reserve_limbs(&remainder_result, divisor_limbs)) {
      big_number_free(&divisor_shifted);
      big_number_free(&dividend_shifted);
      big_number_free(&quotient_result);
      big_number_free(&remainder_result);
      return 0;
    }
    uint32_t *divisor_digits = divisor_shifted.limbs;
    uint32_t *dividend_digits = dividend_shifted.limbs;
    for (size_t index = divisor_limbs; index-- > 0;) {
      uint32_t below = index > 0 ? divisor->limbs[index - 1] : 0;
      divisor_digits[index] = (divisor->limbs[index] << shift) | (shift ? below >> (LIMB_BITS - shift) : 0);
    }
    dividend_digits[dividend->limb_count] = shift ? dividend->limbs[dividend->limb_count - 1] >> (LIMB_BITS - shift) : 0;
    for (size_t index = dividend->limb_count; index-- > 0;) {
      uint32_t below = index > 0 ? dividend->limbs[index - 1] : 0;
      dividend_digits[index] = (dividend->limbs[index] << shift) | (shift ? below >> (LIMB_BITS - shift) : 0);
    }

    const uint64_t limb_base = (uint64_t)1 << LIMB_BITS;
    uint64_t divisor_top = divisor_digits[divisor_limbs - 1];
    uint64_t divisor_second = divisor_digits[divisor_limbs - 2];
    for (size_t position = quotient_limbs; position-- > 0;) {
      // Step 2: guess this quotient limb from the top two limbs left.
      uint64_t top_two = ((uint64_t)dividend_digits[position + divisor_limbs] << LIMB_BITS) |
                         dividend_digits[position + divisor_limbs - 1];
      uint64_t guess = top_two / divisor_top;
      uint64_t guess_remainder = top_two % divisor_top;
      // Correct it against the divisor's second limb. guess >= limb_base is
      // tested first, so guess · divisor_second can't overflow; guess_remainder
      // < limb_base whenever the second test runs, so its shift can't either.
      while (guess >= limb_base ||
             guess * divisor_second > ((guess_remainder << LIMB_BITS) | dividend_digits[position + divisor_limbs - 2])) {
        guess--;
        guess_remainder += divisor_top;
        if (guess_remainder >= limb_base)
          break;
      }

      // Step 3: subtract guess × divisor from the dividend's limbs at this
      // position. guess < 2^32 now, so guess · limb + carry < 2^64.
      uint64_t product_carry = 0;
      uint64_t borrow = 0;
      for (size_t index = 0; index < divisor_limbs; index++) {
        uint64_t product = guess * divisor_digits[index] + product_carry;
        product_carry = product >> LIMB_BITS;
        uint64_t difference = (uint64_t)dividend_digits[position + index] - (uint32_t)product - borrow;
        dividend_digits[position + index] = (uint32_t)difference;
        borrow = difference >> 63; // wrapped below zero: borrow 1 from the next limb
      }
      uint64_t top_difference = (uint64_t)dividend_digits[position + divisor_limbs] - product_carry - borrow;
      dividend_digits[position + divisor_limbs] = (uint32_t)top_difference;
      if (top_difference >> 63) {
        // The guess was one too big: add the divisor back. The carry out of
        // the top limb cancels the borrow that made it negative.
        guess--;
        uint64_t carry = 0;
        for (size_t index = 0; index < divisor_limbs; index++) {
          uint64_t sum = (uint64_t)dividend_digits[position + index] + divisor_digits[index] + carry;
          dividend_digits[position + index] = (uint32_t)sum;
          carry = sum >> LIMB_BITS;
        }
        dividend_digits[position + divisor_limbs] += (uint32_t)carry;
      }
      quotient_result.limbs[position] = (uint32_t)guess;
    }
    quotient_result.limb_count = quotient_limbs;
    normalize(&quotient_result);

    // What's left of the dividend is the remainder, still shifted: shift it back.
    for (size_t index = 0; index < divisor_limbs; index++) {
      uint32_t above = dividend_digits[index + 1];
      remainder_result.limbs[index] = shift ? (dividend_digits[index] >> shift) | (above << (LIMB_BITS - shift)) : dividend_digits[index];
    }
    remainder_result.limb_count = divisor_limbs;
    normalize(&remainder_result);
    big_number_free(&divisor_shifted);
    big_number_free(&dividend_shifted);
  }

  if (remainder)
    move_into(remainder, &remainder_result);
  else
    big_number_free(&remainder_result);
  if (quotient)
    move_into(quotient, &quotient_result);
  else
    big_number_free(&quotient_result);
  return 1;
}

// ── Montgomery arithmetic ─────────────────────────────────────────────────

// N⁻¹ mod 2^32 for odd N, by Newton's iteration: if x·N ≡ 1 (mod 2^k), then
// x' = x·(2 − x·N) satisfies x'·N ≡ 1 (mod 2^2k). Every odd N is its own
// inverse mod 8 (3 bits), so four steps reach 3 → 6 → 12 → 24 → 48 ≥ 32 bits.
static uint32_t inverse_mod_limb_base(uint32_t odd) {
  uint32_t inverse = odd;
  for (int step = 0; step < 4; step++)
    inverse *= 2 - odd * inverse;
  return inverse;
}

// Sets up arithmetic modulo `modulus`: N⁻¹'s low limb, and R² mod N with
// R = 2^(32 · limbs of N), found with one long division of 2^(64 · limbs).
int montgomery_init(montgomery_context *context, const big_number *modulus) {
  big_number_init(&context->modulus);
  big_number_init(&context->r_squared);
  context->scratch = NULL;
  if (!big_number_is_odd(modulus) || big_number_compare_u64(modulus, 2) < 0)
    return 0;

  size_t modulus_limbs = modulus->limb_count;
  big_number r_squared_unreduced;
  big_number_init(&r_squared_unreduced);
  int ok = big_number_copy(&context->modulus, modulus) &&
           big_number_set_u64(&r_squared_unreduced, 1) &&
           modulus_limbs <= SIZE_MAX / (2 * LIMB_BITS) &&
           big_number_shift_left(&r_squared_unreduced, &r_squared_unreduced, 2 * LIMB_BITS * modulus_limbs) &&
           big_number_divide(NULL, &context->r_squared, &r_squared_unreduced, modulus) &&
           (context->scratch = malloc((modulus_limbs + 2) * sizeof(uint32_t))) != NULL;
  big_number_free(&r_squared_unreduced);
  if (!ok) {
    montgomery_free(context);
    return 0;
  }
  context->negated_inverse = (uint32_t)0 - inverse_mod_limb_base(modulus->limbs[0]);
  return 1;
}

void montgomery_free(montgomery_context *context) {
  big_number_free(&context->modulus);
  big_number_free(&context->r_squared);
  free(context->scratch);
  context->scratch = NULL;
}

// result = first · second · R⁻¹ mod N, by "coarsely integrated operand
// scanning" (C. Koç, T. Acar, B. Kaliski, "Analyzing and Comparing Montgomery
// Multiplication Algorithms", IEEE Micro 16(3), 1996). For each limb of
// `second`, from the bottom:
//
//   1. add first × that limb into the running total t;
//   2. add the multiple m·N that makes t's low limb zero (m = t₀ · (−N⁻¹)
//      mod 2^32), and drop that limb: t becomes t / 2^32.
//
// Dropping a limb n times divides by R, and adding multiples of N doesn't
// change t mod N. The total stays below 2N, so one subtraction of N at the end
// finishes it. Every step is limb + limb · limb + carry < 2^64, as in
// big_number_multiply. t needs limbs of N + 2 limbs: context->scratch.
int montgomery_multiply(montgomery_context *context, big_number *result, const big_number *first,
                        const big_number *second) {
  const big_number *modulus = &context->modulus;
  size_t limbs = modulus->limb_count;
  uint32_t *total = context->scratch;
  memset(total, 0, (limbs + 2) * sizeof(uint32_t));

  for (size_t outer = 0; outer < limbs; outer++) {
    // 1. total += first · second[outer]
    uint64_t multiplier = limb_at(second, outer);
    uint64_t carry = 0;
    for (size_t index = 0; index < limbs; index++) {
      uint64_t step = total[index] + (uint64_t)limb_at(first, index) * multiplier + carry;
      total[index] = (uint32_t)step;
      carry = step >> LIMB_BITS;
    }
    uint64_t top = (uint64_t)total[limbs] + carry;
    total[limbs] = (uint32_t)top;
    total[limbs + 1] = (uint32_t)(top >> LIMB_BITS);

    // 2. total = (total + m · N) / 2^32, with m chosen so the low limb is zero
    uint64_t low_limb_multiplier = (uint32_t)(total[0] * context->negated_inverse);
    carry = ((uint64_t)total[0] + low_limb_multiplier * modulus->limbs[0]) >> LIMB_BITS;
    for (size_t index = 1; index < limbs; index++) {
      uint64_t step = total[index] + low_limb_multiplier * modulus->limbs[index] + carry;
      total[index - 1] = (uint32_t)step;
      carry = step >> LIMB_BITS;
    }
    top = (uint64_t)total[limbs] + carry;
    total[limbs - 1] = (uint32_t)top;
    total[limbs] = total[limbs + 1] + (uint32_t)(top >> LIMB_BITS);
  }

  // total < 2N: subtract N once if total >= N.
  int at_least_modulus = total[limbs] != 0;
  if (!at_least_modulus) {
    at_least_modulus = 1; // equal counts as "at least"
    for (size_t index = limbs; index-- > 0;) {
      if (total[index] != modulus->limbs[index]) {
        at_least_modulus = total[index] > modulus->limbs[index];
        break;
      }
    }
  }
  if (at_least_modulus) {
    int64_t borrow = 0;
    for (size_t index = 0; index < limbs; index++) {
      int64_t difference = (int64_t)total[index] - modulus->limbs[index] - borrow;
      borrow = difference < 0;
      total[index] = (uint32_t)(difference + (borrow ? (int64_t)1 << LIMB_BITS : 0));
    }
  }
  // first and second have been fully read, so result may be either of them.
  return big_number_set_limbs(result, total, limbs);
}

// result = value · R mod N: reduce value below N first if it isn't already,
// then multiply by R² (R² · value · R⁻¹ = value · R).
int montgomery_to_form(montgomery_context *context, big_number *result, const big_number *value) {
  if (big_number_compare(value, &context->modulus) < 0)
    return montgomery_multiply(context, result, value, &context->r_squared);
  big_number reduced;
  big_number_init(&reduced);
  int ok = big_number_divide(NULL, &reduced, value, &context->modulus) &&
           montgomery_multiply(context, result, &reduced, &context->r_squared);
  big_number_free(&reduced);
  return ok;
}

// result = value · R⁻¹ mod N: multiplying by 1 removes one factor of R.
int montgomery_from_form(montgomery_context *context, big_number *result, const big_number *value) {
  big_number one;
  big_number_init(&one);
  int ok = big_number_set_u64(&one, 1) && montgomery_multiply(context, result, value, &one);
  big_number_free(&one);
  return ok;
}

// result = base^exponent mod N, by left-to-right binary exponentiation in
// Montgomery form: for each bit of the exponent from the top, square the
// running result, and multiply by the base if the bit is 1. The running result
// starts as 1 in Montgomery form (R mod N), which also makes base^0 = 1.
int montgomery_power(montgomery_context *context, big_number *result, const big_number *base,
                     const big_number *exponent) {
  big_number base_form, running, one;
  big_number_init(&base_form);
  big_number_init(&running);
  big_number_init(&one);
  int ok = montgomery_to_form(context, &base_form, base) && big_number_set_u64(&one, 1) &&
           montgomery_to_form(context, &running, &one);
  for (size_t bit = big_number_bit_length(exponent); ok && bit-- > 0;) {
    ok = montgomery_multiply(context, &running, &running, &running);
    if (ok && (exponent->limbs[bit / LIMB_BITS] >> (bit % LIMB_BITS)) & 1)
      ok = montgomery_multiply(context, &running, &running, &base_form);
  }
  ok = ok && montgomery_from_form(context, &running, &running);
  if (ok)
    move_into(result, &running);
  big_number_free(&base_form);
  big_number_free(&running);
  big_number_free(&one);
  return ok;
}
