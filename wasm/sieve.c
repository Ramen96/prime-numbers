#include <math.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "bignum.h"

#define MAX_BATCH 8192
#define SEGMENT_BYTES 32768
// numbers covered by one segment (it only holds odd numbers)
#define SEGMENT_SPAN (2ULL * SEGMENT_BYTES)
#define BOOTSTRAP_LIMIT 65536

// The batch: its first prime as limbs, and every prime as an offset from it.
// Offsets fit 64 bits: MAX_BATCH primes spanning 2^64 would need an average
// gap of 2^51, which only happens near 2^(2^51); memory runs out long before.
static big_number batch_base;
static uint64_t batch_offsets[MAX_BATCH];
// set when the last call stopped because base primes couldn't be built
static int batch_hit_memory_limit = 0;

// The number a call starts from, written by JavaScript as limbs
static uint32_t *request_limbs = NULL;
static size_t request_limb_capacity = 0;

static uint8_t segment[SEGMENT_BYTES];

// Base primes: every odd prime below base_limit, in order from 3, stored as
// gaps. Gaps between odd primes are even, so a byte holds gap / 2 (1 to 255).
// A 0 byte escapes a larger gap: the next 8 bytes hold gap / 2, least
// significant byte first, so nothing caps the gap size.
//
// Fixed widths: primes as uint64_t. Holding every prime up to 2^64 would take
// about 4 * 10^17 of them; memory runs out first. Byte counts as size_t: a
// wasm32 module can't address more than 4 GiB, so memory runs out first.
static uint8_t *base_prime_gaps = NULL;
static size_t base_gap_bytes = 0;
static size_t base_gap_capacity = 0;
static uint64_t largest_base_prime = 0; // 0 until bootstrapped
static uint64_t base_limit = 0;         // exclusive
// the most bytes base_prime_gaps may take. JavaScript sets it from the
// device's memory; until then it's only limited by what malloc can give
static size_t base_prime_memory_budget = SIZE_MAX;

typedef struct {
  size_t byte_index;
  uint64_t prime;
} base_prime_cursor;

uint32_t *request_buffer(size_t limb_count) {
  if (limb_count > request_limb_capacity) {
    uint32_t *grown = realloc(request_limbs, limb_count * sizeof *grown);
    if (!grown)
      return NULL;
    request_limbs = grown;
    request_limb_capacity = limb_count;
  }
  return request_limbs;
}

// resizes the base prime storage to exactly `capacity` bytes (callers only
// ever grow it). returns 0 if it's over the budget or malloc says no
static int resize_base_prime_storage(size_t capacity) {
  if (capacity > base_prime_memory_budget)
    return 0;
  uint8_t *resized = realloc(base_prime_gaps, capacity);
  if (!resized)
    return 0;
  base_prime_gaps = resized;
  base_gap_capacity = capacity;
  return 1;
}

void set_base_prime_memory_budget(size_t bytes) { base_prime_memory_budget = bytes; }

// bytes held for base primes right now (allocated, not just used)
size_t base_prime_memory_bytes(void) { return base_gap_capacity; }

// makes room for `bytes` of base prime gaps up front, so building them
// doesn't grow the storage step by step (each step copies it, and briefly
// needs the old and new copies at once). returns 0 if they don't fit
int reserve_base_prime_storage(size_t bytes) {
  if (bytes <= base_gap_capacity)
    return 1;
  return resize_base_prime_storage(bytes);
}

uint32_t *batch_base_limbs(void) { return batch_base.limbs; }
size_t batch_base_limb_count(void) { return batch_base.limb_count; }
uint64_t *batch_offset_buffer(void) { return batch_offsets; }
int batch_reached_memory_limit(void) { return batch_hit_memory_limit; }

// Square root on a double can be off by 1 near 2^64
// this can skip a base prime and let a composite through
// this is fixed with integer math (the squares need 128 bits near 2^64)
static uint64_t integer_sqrt(uint64_t n) {
  uint64_t root = (uint64_t)sqrt((double)n);
  while ((unsigned __int128)root * root > n)
    root--;
  while ((unsigned __int128)(root + 1) * (root + 1) <= n)
    root++;
  return root;
}

// base primes are read in order: start at 3, then step through the gaps
static base_prime_cursor first_base_prime(void) {
  base_prime_cursor cursor = {0, 3};
  return cursor;
}

// moves to the next base prime, returns 0 when there are no more
static int next_base_prime(base_prime_cursor *cursor) {
  if (cursor->byte_index >= base_gap_bytes)
    return 0;
  uint64_t half_gap = base_prime_gaps[cursor->byte_index++];
  if (half_gap == 0) {
    for (int byte = 0; byte < 8; byte++)
      half_gap |= (uint64_t)base_prime_gaps[cursor->byte_index++] << (8 * byte);
  }
  cursor->prime += 2 * half_gap;
  return 1;
}

static int append_base_prime(uint64_t prime) {
  if (largest_base_prime == 0) { // 3, the first one, isn't stored as a gap
    largest_base_prime = prime;
    return 1;
  }
  uint64_t half_gap = (prime - largest_base_prime) / 2;
  size_t bytes_needed = half_gap <= 255 ? 1 : 9;
  size_t bytes_after = base_gap_bytes + bytes_needed;
  if (bytes_after > base_gap_capacity) {
    // grow by an eighth, not double: storage is normally reserved up front
    // (reserve_base_prime_storage), so this is only for a short estimate, and
    // doubling a large block would overshoot the memory left. near the budget,
    // take whatever is left of it
    size_t new_capacity = base_gap_capacity ? base_gap_capacity + base_gap_capacity / 8 : 8192;
    if (new_capacity > base_prime_memory_budget)
      new_capacity = base_prime_memory_budget;
    if (new_capacity < bytes_after || !resize_base_prime_storage(new_capacity))
      return 0;
  }
  if (half_gap <= 255) {
    base_prime_gaps[base_gap_bytes++] = (uint8_t)half_gap;
  } else {
    // escape: 0, then gap / 2 in 8 bytes. A fixed width that can't be reached:
    // these are gaps between base primes, which are themselves below 2^64
    // (holding every prime up to 2^64 would take about 4 * 10^17 of them;
    // memory runs out first). A gap between two numbers below 2^64 is below
    // 2^64, so gap / 2 always fits in 64 bits.
    base_prime_gaps[base_gap_bytes++] = 0;
    for (int byte = 0; byte < 8; byte++)
      base_prime_gaps[base_gap_bytes++] = (uint8_t)(half_gap >> (8 * byte));
  }
  largest_base_prime = prime;
  return 1;
}

// marks the odd composites in low, low + 2 * SEGMENT_BYTES where low is odd
// and the whole window is below 2^64 (the fast path)
// it needs every base prime up to the square root of the segments last number
static void sieve_segment(uint64_t low) {
  uint64_t high = low + SEGMENT_SPAN;
  for (size_t i = 0; i < SEGMENT_BYTES; i++)
    segment[i] = 0;

  // the segment only holds odd numbers, and base primes start at 3
  // every base prime needed here is below 2^32 (the window is below 2^64),
  // so its square fits in 64 bits: no 128-bit arithmetic per prime
  uint64_t largest_needed = integer_sqrt(high - 1);
  base_prime_cursor cursor = first_base_prime();
  do {
    uint64_t prime = cursor.prime;
    if (prime > largest_needed)
      break;
    uint64_t square = prime * prime;

    // first odd multiple of prime that is >= low and never below prime square
    // the smaller multiples were already crossed off by smaller primes.
    // found as a distance from low, from the remainder: near 2^64,
    // low + prime would overflow
    uint64_t remainder = low % prime;
    uint64_t distance = remainder == 0 ? 0 : prime - remainder;
    if (distance % 2 == 1)
      distance += prime;
    if (square > low && distance < square - low)
      distance = square - low;

    // odd multiples are 2 * prime apart which is prime slots apart
    for (uint64_t index = distance / 2; index < SEGMENT_BYTES; index += prime) {
      segment[index] = 1;
    }
  } while (next_base_prime(&cursor));
}

// the same for a window that starts at 2^64 or above (low is multi-limb and
// odd). where each base prime first lands comes from big mod small; after
// that everything is small offsets, so the marking loop is the same.
// base primes are far below low here, so a prime never marks itself.
static void sieve_big_segment(const big_number *low, uint64_t largest_needed) {
  for (size_t i = 0; i < SEGMENT_BYTES; i++)
    segment[i] = 0;

  base_prime_cursor cursor = first_base_prime();
  do {
    uint64_t prime = cursor.prime;
    if (prime > largest_needed)
      break;

    // distance from low to the first multiple of prime at or above low,
    // moved on by one more prime if that lands on an even number
    uint64_t remainder = big_number_mod_small(low, prime);
    uint64_t distance = remainder == 0 ? 0 : prime - remainder;
    if (distance % 2 == 1)
      distance += prime;

    for (uint64_t index = distance / 2; index < SEGMENT_BYTES; index += prime) {
      segment[index] = 1;
    }
  } while (next_base_prime(&cursor));
}

static int bootstrap_base_primes(void) {
  uint8_t *composite = calloc(BOOTSTRAP_LIMIT, 1);
  if (!composite)
    return 0;

  for (uint64_t n = 2; n < BOOTSTRAP_LIMIT; n++) {
    if (composite[n])
      continue;
    // 2 isn't a base prime: the segments only hold odd numbers
    if (n > 2 && !append_base_prime(n)) {
      free(composite);
      return 0;
    }

    for (uint64_t multiple = n * n; multiple < BOOTSTRAP_LIMIT; multiple += n) {
      composite[multiple] = 1;
    }
  }
  free(composite);
  base_limit = BOOTSTRAP_LIMIT;
  return 1;
}

// extends the base primes so every prime < new_limit is in them. If memory
// runs out part way, the base primes go back to how they were, so they never
// have a gap
static int extend_base_primes_to(uint64_t new_limit) {
  size_t bytes_before = base_gap_bytes;
  uint64_t largest_before = largest_base_prime;

  // BOOTSTRAP_LIMIT is odd-aligned after the first step. Primes are appended
  // as each segment is done, so the base primes always cover the square root
  // of the segment being sieved
  uint64_t low = base_limit | 1;
  while (low < new_limit) {
    sieve_segment(low);
    for (uint64_t i = 0; i < SEGMENT_BYTES; i++) {
      uint64_t n = low + 2 * i;
      if (n >= new_limit)
        break;
      if (!segment[i] && !append_base_prime(n)) {
        base_gap_bytes = bytes_before;
        largest_base_prime = largest_before;
        return 0;
      }
    }
    low += SEGMENT_SPAN;
  }
  base_limit = new_limit;
  return 1;
}

// make sure every prime <= limit is in base primes
static int ensure_base_primes(uint64_t limit) {
  if (base_limit == 0 && !bootstrap_base_primes())
    return 0;
  if (limit < base_limit)
    return 1;

  // grow the limit by at least an eighth so extending isn't needed every few
  // segments (each extension only sieves the new part, so a bigger step
  // saves little, and doubling would need about twice the memory). if that
  // doesn't fit in memory, try just what's needed
  uint64_t needed_limit = limit + 1;
  uint64_t step = base_limit / 8;
  uint64_t grown_limit = base_limit <= UINT64_MAX - step ? base_limit + step : UINT64_MAX;
  if (grown_limit > needed_limit && extend_base_primes_to(grown_limit))
    return 1;
  return extend_base_primes_to(needed_limit);
}

// exclusive: every odd prime below this is in base primes (0 before the first batch)
uint64_t base_prime_limit(void) { return base_limit; }

// makes sure every prime <= limit is in base primes, so the worker can build
// them as a separate, separately timed step. returns 0 if memory runs out
int extend_base_primes(uint64_t limit) { return ensure_base_primes(limit); }

#ifdef SIEVE_TEST_HOOKS
// tests only: sieve windows below 2^64 the multi-limb way too, so the two
// paths can be checked against each other. only for windows past 2^20, where
// base primes are always below the window
static int force_multi_limb_windows = 0;
void sieve_force_multi_limb_windows(int force) { force_multi_limb_windows = force; }

// tests only: stores `primes` (odd, ascending, starting at 3, which the
// storage assumes) as gaps in fresh storage, reads them back through the
// cursor, and returns 1 if every one comes back unchanged. the real base
// primes are put back afterwards. real base primes don't need the 9-byte
// escape until after 304,599,508,537, so tests use synthetic gaps
int sieve_test_gap_encoding_round_trip(const uint64_t *primes, size_t count) {
  uint8_t *saved_gaps = base_prime_gaps;
  size_t saved_bytes = base_gap_bytes, saved_capacity = base_gap_capacity;
  uint64_t saved_largest = largest_base_prime;
  base_prime_gaps = NULL;
  base_gap_bytes = base_gap_capacity = 0;
  largest_base_prime = 0;

  int matches = count > 0 && primes[0] == 3;
  for (size_t i = 0; matches && i < count; i++)
    matches = append_base_prime(primes[i]);
  base_prime_cursor cursor = first_base_prime();
  for (size_t i = 0; matches && i < count; i++) {
    matches = cursor.prime == primes[i];
    if (matches && i + 1 < count)
      matches = next_base_prime(&cursor);
  }
  matches = matches && !next_base_prime(&cursor); // and nothing extra

  free(base_prime_gaps);
  base_prime_gaps = saved_gaps;
  base_gap_bytes = saved_bytes;
  base_gap_capacity = saved_capacity;
  largest_base_prime = saved_largest;
  return matches;
}
#else
#define force_multi_limb_windows 0
#endif

// gets the base primes for the window starting at low (odd) and sieves it.
// returns 0 if the base primes it needs don't fit in memory
static int prepare_segment(const big_number *low) {
  int fast_path = big_number_compare_u64(low, UINT64_MAX - SEGMENT_SPAN + 1) < 0;
  if (force_multi_limb_windows && big_number_compare_u64(low, 1 << 20) > 0)
    fast_path = 0;
  if (fast_path) {
    uint64_t low_u64 = big_number_to_u64(low);
    if (!ensure_base_primes(integer_sqrt(low_u64 + SEGMENT_SPAN - 1)))
      return 0;
    sieve_segment(low_u64);
    return 1;
  }

  // multi-limb window: base primes up to (an overestimate of) its square root
  big_number last, root;
  big_number_init(&last);
  big_number_init(&root);
  int ok = big_number_copy(&last, low) && big_number_add_small(&last, SEGMENT_SPAN - 1) &&
           big_number_square_root_upper(&last, &root) &&
           big_number_fits_u64(&root) && // base primes past 2^64 can't be held anyway
           ensure_base_primes(big_number_to_u64(&root));
  if (ok)
    sieve_big_segment(low, big_number_to_u64(&root));
  big_number_free(&last);
  big_number_free(&root);
  return ok;
}

// writes up to count primes strictly greater than the requested number (the
// limbs in request_buffer) as batch_base + batch_offsets, ascending. returns
// how many were written: fewer only if base primes ran out of memory
int sieve_next(size_t request_limb_count, int count) {
  if (count > MAX_BATCH)
    count = MAX_BATCH;
  batch_hit_memory_limit = 0;
  int written = 0;

  // distances from `after` are collected first, then made relative to the
  // first prime. they stay small: see batch_offsets
  big_number after, low;
  big_number_init(&after);
  big_number_init(&low);
  if (!big_number_set_limbs(&after, request_limbs, request_limb_count)) {
    batch_hit_memory_limit = 1;
    return 0;
  }

  if (big_number_compare_u64(&after, 2) < 0 && written < count)
    batch_offsets[written++] = 2 - big_number_to_u64(&after);

  // odd numbers only from here on starting at the first odd number > after
  uint64_t low_distance;
  int ok;
  if (big_number_compare_u64(&after, 3) < 0) {
    low_distance = 3 - big_number_to_u64(&after);
    ok = big_number_set_u64(&low, 3);
  } else {
    low_distance = big_number_is_odd(&after) ? 2 : 1;
    ok = big_number_copy(&low, &after) && big_number_add_small(&low, low_distance);
  }
  if (!ok)
    batch_hit_memory_limit = 1;

  while (ok && written < count) {
    if (!prepare_segment(&low)) {
      batch_hit_memory_limit = 1;
      break;
    }
    for (uint64_t i = 0; i < SEGMENT_BYTES && written < count; i++) {
      if (!segment[i])
        batch_offsets[written++] = low_distance + 2 * i;
    }
    if (!big_number_add_small(&low, SEGMENT_SPAN)) {
      batch_hit_memory_limit = 1;
      break;
    }
    low_distance += SEGMENT_SPAN;
  }

  // the first prime is the batch base, the rest are offsets from it
  if (written > 0) {
    uint64_t first_distance = batch_offsets[0];
    big_number_copy(&batch_base, &after);
    big_number_add_small(&batch_base, first_distance);
    for (int i = 0; i < written; i++)
      batch_offsets[i] -= first_distance;
  }
  big_number_free(&after);
  big_number_free(&low);
  return written;
}

// writes up to count primes strictly less than the requested number as
// batch_base + batch_offsets, ascending. returns how many were written,
// fewer when the list reaches 2 (or base primes ran out of memory)
int sieve_prev(size_t request_limb_count, int count) {
  if (count > MAX_BATCH)
    count = MAX_BATCH;
  batch_hit_memory_limit = 0;

  big_number before, upper, low;
  big_number_init(&before);
  big_number_init(&upper);
  big_number_init(&low);
  if (!big_number_set_limbs(&before, request_limbs, request_limb_count)) {
    batch_hit_memory_limit = 1;
    return 0;
  }
  if (big_number_compare_u64(&before, 2) <= 0) {
    big_number_free(&before);
    return 0;
  }

  // collected in decending order as distances below `before`, then reversed
  int written = 0;
  big_number_copy(&upper, &before); // only numbers less than upper are new
  uint64_t upper_distance = 0;      // before - upper

  while (written < count && big_number_compare_u64(&upper, 3) > 0) {
    uint64_t window_width; // upper - low, at most SEGMENT_SPAN + 1
    if (big_number_compare_u64(&upper, 3 + SEGMENT_SPAN) > 0) {
      big_number_copy(&low, &upper);
      big_number_subtract_small(&low, SEGMENT_SPAN);
      window_width = SEGMENT_SPAN;
      if (!big_number_is_odd(&low)) { // (upper - span) | 1
        big_number_add_small(&low, 1);
        window_width--;
      }
    } else {
      window_width = big_number_to_u64(&upper) - 3;
      big_number_set_u64(&low, 3);
    }
    if (!prepare_segment(&low)) {
      batch_hit_memory_limit = 1;
      break;
    }

    uint64_t low_distance = upper_distance + window_width;
    for (int64_t i = SEGMENT_BYTES - 1; i >= 0 && written < count; i--) {
      if (2 * (uint64_t)i >= window_width) // at or past upper
        continue;
      if (!segment[i])
        batch_offsets[written++] = low_distance - 2 * (uint64_t)i;
    }
    big_number_copy(&upper, &low);
    upper_distance = low_distance;
  }

  if (written < count && !batch_hit_memory_limit && big_number_compare_u64(&upper, 3) <= 0)
    batch_offsets[written++] = upper_distance + (big_number_to_u64(&upper) - 2);

  // the smallest prime (largest distance) is the batch base
  if (written > 0) {
    uint64_t largest_distance = batch_offsets[written - 1];
    big_number_copy(&batch_base, &before);
    big_number_subtract_small(&batch_base, largest_distance);
    for (int left = 0, right = written - 1; left < right; left++, right--) {
      uint64_t swap = batch_offsets[left];
      batch_offsets[left] = batch_offsets[right];
      batch_offsets[right] = swap;
    }
    for (int i = 0; i < written; i++)
      batch_offsets[i] = largest_distance - batch_offsets[i];
  }
  big_number_free(&before);
  big_number_free(&upper);
  big_number_free(&low);
  return written;
}
