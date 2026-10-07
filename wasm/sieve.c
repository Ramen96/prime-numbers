#include <math.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>

#define MAX_SAFE_INTEGER 9007199254740991ULL // 2^53 - 1
#define MAX_BATCH 8192
#define SEGMENT_BYTES 32768
#define BOOTSTRAP_LIMIT 65536
#define MAX_BASE_LIMIT 94906266ULL

static double output[MAX_BATCH];
static uint8_t segment[SEGMENT_BYTES];
static uint32_t *base_primes = NULL;
static size_t base_count = 0;
static size_t base_capacity = 0;
static uint64_t base_limit = 0;

double *output_buffer(void) { return output; }

// Square root on a double can be off by 1 near 2^53
// this can skip a base prime and let a composite through
// this is fixed with integer math
static uint64_t integer_sqrt(uint64_t n) {
  uint64_t root = (uint64_t)sqrt((double)n);
  while (root * root > n)
    root--;
  while ((root + 1) * (root + 1) <= n)
    root++;
  return root;
}

static int append_base_prime(uint64_t prime) {
  if (base_count == base_capacity) {
    size_t new_capacity = base_capacity ? base_capacity * 2 : 8192;
    uint32_t *grown = realloc(base_primes, new_capacity * sizeof *grown);
    if (!grown)
      return 0;
    base_primes = grown;
    base_capacity = new_capacity;
  }
  base_primes[base_count++] = (uint32_t)prime;
  return 1;
}

// marks the odd composites in low, low + 2 * SEGMENT_BYTES where low is odd
// it needs every base prime up to the square root of the segments last number
static void sieve_segment(uint64_t low) {
  uint64_t high = low + 2ULL * SEGMENT_BYTES;
  for (size_t i = 0; i < SEGMENT_BYTES; i++)
    segment[i] = 0;

  // the segment only holds odd numbers
  for (size_t k = 1; k < base_count; k++) {
    uint64_t prime = base_primes[k];
    uint64_t square = prime * prime;
    if (square >= high)
      break;

    // first odd multiple of prime that is >= low and never below prime square
    // the smaller multiples were already crossed off by smaller primes
    uint64_t multiple = (low + prime - 1) / prime * prime;
    if (multiple % 2 == 0)
      multiple += prime;
    if (multiple < square)
      multiple = square;

    // odd multiples are 2 * prime apart which is prime slots apart
    for (uint64_t index = (multiple - low) / 2; index < SEGMENT_BYTES;
         index += prime) {
      segment[index] = 1;
    }
  }
}

static int bootstrap_base_primes(void) {
  uint8_t *composite = calloc(BOOTSTRAP_LIMIT, 1);
  if (!composite)
    return 0;

  for (uint64_t n = 2; n < BOOTSTRAP_LIMIT; n++) {
    if (composite[n])
      continue;
    if (!append_base_prime(n)) {
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

// make sure every prime is <= limit is in base primes
static int ensure_base_primes(uint64_t limit) {
  if (base_limit == 0 && !bootstrap_base_primes())
    return 0;
  if (limit < base_limit)
    return 1;

  // grow at least 2x at a time so the extending is are
  uint64_t new_limit = limit + 1;
  if (new_limit < base_limit * 2)
    new_limit = base_limit * 2;
  if (new_limit > MAX_BASE_LIMIT + 1)
    new_limit = MAX_BASE_LIMIT + 1;

  // estend with the segmented sieve itself. BOOTSTRAP_LIMIT is odd-aligned
  // after the first step and the bootstrap primes cover sqrt(new_limit)
  uint64_t low = base_limit | 1;
  while (low < new_limit) {
    sieve_segment(low);
    for (uint64_t i = 0; i < SEGMENT_BYTES; i++) {
      uint64_t n = low + 2 * i;
      if (n >= new_limit)
        break;
      if (!segment[i] && !append_base_prime(n))
        return 0;
    }
    low += 2ULL * SEGMENT_BYTES;
  }
  base_limit = new_limit;
  return 1;
}

static int prepare_segment(uint64_t low) {
  uint64_t last = low + 2ULL * SEGMENT_BYTES - 1;
  if (!ensure_base_primes(integer_sqrt(last)))
    return 0;
  sieve_segment(low);
  return 1;
}

// writes up to count primes strictly greater than after into the output buffer
// ascending then it returns how many were written (fewr only at 2^53 or if
// memory runs out)
int sieve_next(double after, int count) {
  if (count > MAX_BATCH)
    count = MAX_BATCH;
  int written = 0;
  uint64_t floor_exclusive = after < 0 ? 0 : (uint64_t)after;

  if (floor_exclusive < 2 && written < count)
    output[written++] = 2;

  // odd numbers only from here on starting at the first odd number > after
  uint64_t low = floor_exclusive < 3 ? 3 : (floor_exclusive + 1) | 1;

  while (written < count && low <= MAX_SAFE_INTEGER) {
    if (!prepare_segment(low))
      break;
    for (uint64_t i = 0; i < SEGMENT_BYTES && written < count; i++) {
      uint64_t n = low + 2 * i;
      if (n > MAX_SAFE_INTEGER)
        return written;
      if (!segment[i])
        output[written++] = (double)n;
    }
    low += 2ULL * SEGMENT_BYTES;
  }
  return written;
}

// writes up to count primes strictly less than before into the output buffer in
// ascending bootstrap_base_primes returns how many were written, fewr when the
// list reaches 2
int sieve_prev(double before, int count) {
  if (count > MAX_BATCH)
    count = MAX_BATCH;
  if (before <= 2)
    return 0;
  uint64_t ceiling_exclusive = (uint64_t)before;
  if (ceiling_exclusive > MAX_SAFE_INTEGER + 1)
    ceiling_exclusive = MAX_SAFE_INTEGER + 1;

  // collected in decending order then reversed at the end
  int written = 0;
  uint64_t upper = ceiling_exclusive; // only numbers less than upper are new

  while (written < count && upper > 3) {
    uint64_t span = 2ULL * SEGMENT_BYTES;
    uint64_t low = upper > 3 + span ? (upper - span) | 1 : 3;
    if (!prepare_segment(low))
      break;

    for (int64_t i = SEGMENT_BYTES - 1; i >= 0 && written < count; i--) {
      uint64_t n = low + 2 * (uint64_t)i;
      if (n >= upper)
        continue;
      if (!segment[i])
        output[written++] = (double)n;
    }
    upper = low;
  }

  if (written < count && ceiling_exclusive > 2)
    output[written++] = 2;

  for (int left = 0, right = written - 1; left < right; left++, right--) {
    double swap = output[left];
    output[left] = output[right];
    output[right] = swap;
  }
  return written;
}
