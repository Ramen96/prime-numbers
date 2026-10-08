#include <math.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "bignum.h"

#ifdef SIEVE_THREADS
#include <pthread.h>
#endif

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
static size_t base_prime_count = 0;

typedef struct {
  size_t byte_index;
  uint64_t prime;
} base_prime_cursor;

// a saved cursor at every BASE_PRIME_CHECKPOINT_INTERVAL-th base prime (the
// first is 3), so threads can each start reading the gaps part way through:
// 16 bytes per 65,536 base primes. tests make the interval tiny, so thread
// slices start and end in many places
#ifndef BASE_PRIME_CHECKPOINT_INTERVAL
#define BASE_PRIME_CHECKPOINT_INTERVAL 65536
#endif
static base_prime_cursor *base_prime_checkpoints = NULL;
static size_t checkpoint_count = 0;
static size_t checkpoint_capacity = 0;

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

static size_t checkpoint_bytes(void) { return checkpoint_capacity * sizeof *base_prime_checkpoints; }

// whether `gap_bytes` of gaps and `checkpoint_bytes_wanted` of checkpoints fit
// the budget together (written so the sum can't overflow)
static int fits_budget(size_t gap_bytes, size_t checkpoint_bytes_wanted) {
  return gap_bytes <= base_prime_memory_budget &&
         checkpoint_bytes_wanted <= base_prime_memory_budget - gap_bytes;
}

// resizes the base prime storage to exactly `capacity` bytes (callers only
// ever grow it). returns 0 if it's over the budget or malloc says no
static int resize_base_prime_storage(size_t capacity) {
  if (!fits_budget(capacity, checkpoint_bytes()))
    return 0;
  uint8_t *resized = realloc(base_prime_gaps, capacity);
  if (!resized)
    return 0;
  base_prime_gaps = resized;
  base_gap_capacity = capacity;
  return 1;
}

void set_base_prime_memory_budget(size_t bytes) { base_prime_memory_budget = bytes; }

// bytes held for base primes right now (allocated, not just used), gaps and
// checkpoints together
size_t base_prime_memory_bytes(void) { return base_gap_capacity + checkpoint_bytes(); }

// makes room for `bytes` of base primes in all up front, so building them
// doesn't grow the storage step by step (each step copies it, and briefly
// needs the old and new copies at once). returns 0 if they don't fit
int reserve_base_prime_storage(size_t bytes) {
  size_t gap_bytes = bytes > checkpoint_bytes() ? bytes - checkpoint_bytes() : 0;
  if (gap_bytes <= base_gap_capacity)
    return 1;
  return resize_base_prime_storage(gap_bytes);
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

// reads one gap / 2 from `gaps` at *byte_index and moves past it
static uint64_t read_half_gap(const uint8_t *gaps, size_t *byte_index) {
  uint64_t half_gap = gaps[(*byte_index)++];
  if (half_gap == 0) {
    for (int byte = 0; byte < 8; byte++)
      half_gap |= (uint64_t)gaps[(*byte_index)++] << (8 * byte);
  }
  return half_gap;
}

// writes gap / 2 at `out`; returns the bytes written (1, or 9 escaped)
static size_t write_half_gap(uint8_t *out, uint64_t half_gap) {
  if (half_gap <= 255) {
    out[0] = (uint8_t)half_gap;
    return 1;
  }
  // escape: 0, then gap / 2 in 8 bytes. A fixed width that can't be reached:
  // these are gaps between base primes, which are themselves below 2^64
  // (holding every prime up to 2^64 would take about 4 * 10^17 of them;
  // memory runs out first). A gap between two numbers below 2^64 is below
  // 2^64, so gap / 2 always fits in 64 bits.
  out[0] = 0;
  for (int byte = 0; byte < 8; byte++)
    out[1 + byte] = (uint8_t)(half_gap >> (8 * byte));
  return 9;
}

// moves to the next base prime, returns 0 when there are no more
static int next_base_prime(base_prime_cursor *cursor) {
  if (cursor->byte_index >= base_gap_bytes)
    return 0;
  cursor->prime += 2 * read_half_gap(base_prime_gaps, &cursor->byte_index);
  return 1;
}

// room for one more checkpoint, within the budget. there are at most a few
// thousand (one per 65,536 base primes), so the byte count can't overflow
static int grow_checkpoints(void) {
  size_t new_capacity = checkpoint_capacity ? checkpoint_capacity + checkpoint_capacity / 8 + 1 : 64;
  if (!fits_budget(base_gap_capacity, new_capacity * sizeof *base_prime_checkpoints))
    return 0;
  base_prime_cursor *grown = realloc(base_prime_checkpoints, new_capacity * sizeof *grown);
  if (!grown)
    return 0;
  base_prime_checkpoints = grown;
  checkpoint_capacity = new_capacity;
  return 1;
}

// makes sure the gap storage holds at least bytes_after bytes
static int ensure_gap_capacity(size_t bytes_after) {
  if (bytes_after > base_gap_capacity) {
    // grow by an eighth (or what's needed, if that's more: a whole window's
    // gaps arrive at once), not double: storage is normally reserved up front
    // (reserve_base_prime_storage), so this is only for a short estimate, and
    // doubling a large block would overshoot the memory left. near the budget,
    // take whatever is left of it after the checkpoints
    size_t new_capacity = base_gap_capacity ? base_gap_capacity + base_gap_capacity / 8 : 8192;
    if (new_capacity < bytes_after)
      new_capacity = bytes_after;
    size_t room = base_prime_memory_budget > checkpoint_bytes() ? base_prime_memory_budget - checkpoint_bytes() : 0;
    if (new_capacity > room)
      new_capacity = room;
    if (new_capacity < bytes_after || !resize_base_prime_storage(new_capacity))
      return 0;
  }
  return 1;
}

// stores the gap from the largest base prime to `prime`
static int append_gap(uint64_t prime) {
  uint64_t half_gap = (prime - largest_base_prime) / 2;
  if (!ensure_gap_capacity(base_gap_bytes + (half_gap <= 255 ? 1 : 9)))
    return 0;
  base_gap_bytes += write_half_gap(base_prime_gaps + base_gap_bytes, half_gap);
  return 1;
}

static int append_base_prime(uint64_t prime) {
  int is_checkpoint = base_prime_count % BASE_PRIME_CHECKPOINT_INTERVAL == 0;
  if (is_checkpoint && checkpoint_count == checkpoint_capacity && !grow_checkpoints())
    return 0;
  // 3, the first one, isn't stored as a gap
  if (largest_base_prime != 0 && !append_gap(prime))
    return 0;
  if (is_checkpoint) {
    base_prime_cursor checkpoint = {base_gap_bytes, prime};
    base_prime_checkpoints[checkpoint_count++] = checkpoint;
  }
  largest_base_prime = prime;
  base_prime_count++;
  return 1;
}

// The primes one thread found in one window while building base primes,
// already encoded the way base_prime_gaps stores them, so the calling thread
// only has to copy them in order. Fixed size, and it can't overflow: a window
// holds at most SEGMENT_BYTES odd numbers, so at most that many gaps, and the
// gaps inside it add up to less than SEGMENT_SPAN, so at most
// SEGMENT_SPAN / 512 of them are big enough to need the 9-byte escape
#define WINDOW_GAP_BYTES (SEGMENT_BYTES + 8 * (SEGMENT_SPAN / 512))
typedef struct {
  size_t count;           // primes found
  uint64_t first, last;   // the first and last of them
  size_t gap_bytes;       // gaps from first to each later prime, in order
  uint8_t gaps[WINDOW_GAP_BYTES];
} window_primes;

// the unmarked numbers in a window starting at low, below `below`
static void collect_window_primes(const uint8_t *marks, uint64_t low, uint64_t below, window_primes *found) {
  found->count = 0;
  found->gap_bytes = 0;
  for (uint64_t i = 0; i < SEGMENT_BYTES; i++) {
    uint64_t n = low + 2 * i;
    if (n >= below)
      break;
    if (marks[i])
      continue;
    if (found->count == 0)
      found->first = n;
    else
      found->gap_bytes += write_half_gap(found->gaps + found->gap_bytes, (n - found->last) / 2);
    found->last = n;
    found->count++;
  }
}

// appends one window's primes: the first the usual way, then the rest copied
// as they are, with a checkpoint wherever one falls among them
static int append_window_primes(const window_primes *found) {
  if (found->count == 0)
    return 1;
  if (!append_base_prime(found->first))
    return 0;
  size_t rest = found->count - 1;
  if (rest == 0)
    return 1;
  if (!ensure_gap_capacity(base_gap_bytes + found->gap_bytes))
    return 0;

  // checkpoints are due at every multiple of the interval
  size_t next_checkpoint = (base_prime_count + BASE_PRIME_CHECKPOINT_INTERVAL - 1) /
                           BASE_PRIME_CHECKPOINT_INTERVAL * BASE_PRIME_CHECKPOINT_INTERVAL;
  base_prime_cursor walker = {0, found->first};
  for (size_t index = base_prime_count; next_checkpoint < base_prime_count + rest; index++) {
    walker.prime += 2 * read_half_gap(found->gaps, &walker.byte_index);
    if (index != next_checkpoint)
      continue;
    if (checkpoint_count == checkpoint_capacity && !grow_checkpoints())
      return 0;
    base_prime_cursor checkpoint = {base_gap_bytes + walker.byte_index, walker.prime};
    base_prime_checkpoints[checkpoint_count++] = checkpoint;
    next_checkpoint += BASE_PRIME_CHECKPOINT_INTERVAL;
  }
  memcpy(base_prime_gaps + base_gap_bytes, found->gaps, found->gap_bytes);
  base_gap_bytes += found->gap_bytes;
  base_prime_count += rest;
  largest_base_prime = found->last;
  return 1;
}

// how many checkpoints are at or below largest_needed. at least 1: the
// first is 3, and every window needs it
static size_t checkpoints_needed(uint64_t largest_needed) {
  size_t at_or_below = 1, above = checkpoint_count;
  while (at_or_below < above) {
    size_t middle = at_or_below + (above - at_or_below) / 2;
    if (base_prime_checkpoints[middle].prime <= largest_needed)
      at_or_below = middle + 1;
    else
      above = middle;
  }
  return at_or_below;
}

// marks, in `target`, the odd multiples of up to `prime_count` base primes
// starting at `cursor`, stopping at the first past largest_needed. the window
// starts at low (odd) and is below 2^64 (the fast path); every base prime it
// needs is below 2^32, so its square fits in 64 bits
static void mark_segment(uint8_t *target, uint64_t low, uint64_t largest_needed,
                         base_prime_cursor cursor, size_t prime_count) {
  for (size_t marked = 0; marked < prime_count; marked++) {
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
      target[index] = 1;
    }
    if (!next_base_prime(&cursor))
      break;
  }
}

// the same for a window that starts at 2^64 or above (low is multi-limb and
// odd). where each base prime first lands comes from big mod small; after
// that everything is small offsets, so the marking loop is the same.
// base primes are far below low here, so a prime never marks itself.
static void mark_big_segment(uint8_t *target, const big_number *low, uint64_t largest_needed,
                             base_prime_cursor cursor, size_t prime_count) {
  for (size_t marked = 0; marked < prime_count; marked++) {
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
      target[index] = 1;
    }
    if (!next_base_prime(&cursor))
      break;
  }
}

// ── threads ──────────────────────────────────────────────────────────────
//
// Work is shared out as jobs, two kinds:
// - one window, its base primes split into slices, one slice per thread,
//   each marking its own copy of the segment, merged afterwards. This is
//   what speeds up a batch: 500 primes almost always fit in one window, and
//   the time goes on the base primes (millions of them near 2^53).
// - building base primes: one whole window per thread, consecutive.
// The calling thread (thread 0) takes part and waits for the rest. Base
// primes are only read during a job; they're only extended between jobs, by
// the calling thread, so the job handoff (a mutex) is all the
// synchronization they need. The batch output and request buffers belong to
// the calling thread alone.

typedef struct {
  int whole_windows;          // 1: thread t sieves the window low + t * SEGMENT_SPAN whole
  int threads;                // how many take part, the calling thread included
  uint64_t low;               // the window (the first window, for whole_windows)...
  const big_number *big_low;  // ...or a multi-limb one (NULL on the fast path)
  uint64_t largest_needed;    // shared window: its largest base prime needed
  size_t checkpoints;         // shared window: checkpoints at or below that
  uint64_t collect_below;     // whole windows: collect the primes below this
} sieve_job;

#ifdef SIEVE_THREADS
typedef struct {
  uint8_t segment[SEGMENT_BYTES]; // this thread's marks
  window_primes found;            // and, building base primes, what it found
  pthread_t thread;
} sieve_helper;
static sieve_helper *helpers = NULL;
static int helper_count = 0;
#else
#define helper_count 0
#endif

// the calling thread's (thread 0's) primes found while building base primes
static window_primes calling_thread_found;

static uint8_t *thread_segment(int thread_index) {
#ifdef SIEVE_THREADS
  if (thread_index > 0)
    return helpers[thread_index - 1].segment;
#endif
  (void)thread_index;
  return segment;
}

static window_primes *thread_found(int thread_index) {
#ifdef SIEVE_THREADS
  if (thread_index > 0)
    return &helpers[thread_index - 1].found;
#endif
  (void)thread_index;
  return &calling_thread_found;
}

// Splitting a window across threads only pays once it needs enough base
// primes: below that, waking the threads costs more than it saves. Where that
// is depends on the device, so it's measured (see mark_window), as two
// bounds on a window's size in checkpoints: splitting was measured to win at
// smallest_size_split_won, and to lose at largest_size_split_lost.
static size_t smallest_size_split_won = SIZE_MAX; // SIZE_MAX: not seen yet
static size_t largest_size_split_lost = 1;        // a single checkpoint never splits

// time spent measuring since JavaScript last asked: it isn't sieving speed,
// so the worker counts it as setup, like building base primes
static double measuring_ms = 0;
double take_measuring_ms(void) {
  double taken = measuring_ms;
  measuring_ms = 0;
  return taken;
}

// tests only set it directly: split from `checkpoints` on, and stop measuring
void set_parallel_threshold(size_t checkpoints) {
  smallest_size_split_won = checkpoints ? checkpoints : 1;
  largest_size_split_lost = smallest_size_split_won - 1;
}

// the smallest window size known to split, in checkpoints: 0 until splitting
// has won somewhere (tests read it)
size_t measured_parallel_threshold(void) {
  return smallest_size_split_won == SIZE_MAX ? 0 : smallest_size_split_won;
}

// one thread's share of a job, in its own segment
static void run_slice(const sieve_job *job, int thread_index) {
  uint8_t *target = thread_segment(thread_index);
  memset(target, 0, SEGMENT_BYTES);
  if (job->whole_windows) {
    uint64_t low = job->low + (uint64_t)thread_index * SEGMENT_SPAN;
    mark_segment(target, low, integer_sqrt(low + SEGMENT_SPAN - 1), first_base_prime(), SIZE_MAX);
    collect_window_primes(target, low, job->collect_below, thread_found(thread_index));
    return;
  }
  // checkpoints [first, end) are this thread's; the last thread also takes
  // everything after its last checkpoint, up to largest_needed. first < the
  // job's checkpoints for every thread, so it's always a real checkpoint
  size_t first = job->checkpoints * (size_t)thread_index / (size_t)job->threads;
  size_t end = job->checkpoints * (size_t)(thread_index + 1) / (size_t)job->threads;
  int is_last = thread_index == job->threads - 1;
  if (first == end && !is_last)
    return;
  size_t prime_count = is_last ? SIZE_MAX : (end - first) * BASE_PRIME_CHECKPOINT_INTERVAL;
  base_prime_cursor start = base_prime_checkpoints[first];
  if (job->big_low)
    mark_big_segment(target, job->big_low, job->largest_needed, start, prime_count);
  else
    mark_segment(target, job->low, job->largest_needed, start, prime_count);
}

#ifdef SIEVE_THREADS
static pthread_mutex_t job_lock = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t job_posted = PTHREAD_COND_INITIALIZER;
static pthread_cond_t job_finished = PTHREAD_COND_INITIALIZER;
static const sieve_job *current_job = NULL;
static uint64_t jobs_posted = 0; // 64 bits: never wraps
static int helpers_working = 0;

// each helper waits for a job, does its slice, and reports back. every
// helper sees every job: the next can't be posted until all have reported
static void *helper_main(void *argument) {
  int thread_index = (int)(intptr_t)argument; // helpers are threads 1, 2, ...
  uint64_t jobs_seen = 0;
  pthread_mutex_lock(&job_lock);
  for (;;) {
    while (jobs_posted == jobs_seen)
      pthread_cond_wait(&job_posted, &job_lock);
    jobs_seen = jobs_posted;
    const sieve_job *job = current_job;
    pthread_mutex_unlock(&job_lock);

    if (thread_index < job->threads)
      run_slice(job, thread_index);

    pthread_mutex_lock(&job_lock);
    if (--helpers_working == 0)
      pthread_cond_signal(&job_finished);
  }
  return NULL;
}

// starts `count` helper threads (the calling thread is one more), once.
// returns how many are running: fewer if some couldn't start
int sieve_start_helpers(int count) {
  if (helper_count > 0 || count <= 0)
    return helper_count;
  helpers = malloc((size_t)count * sizeof *helpers);
  if (!helpers)
    return 0;
  for (int i = 0; i < count; i++) {
    if (pthread_create(&helpers[i].thread, NULL, helper_main, (void *)(intptr_t)(i + 1)) != 0)
      break;
    helper_count++;
  }
  return helper_count;
}

// runs a job on job->threads threads and waits until every slice is done
static void run_job(const sieve_job *job) {
  if (job->threads == 1) {
    run_slice(job, 0);
    return;
  }
  pthread_mutex_lock(&job_lock);
  current_job = job;
  jobs_posted++;
  helpers_working = helper_count;
  pthread_cond_broadcast(&job_posted);
  pthread_mutex_unlock(&job_lock);

  run_slice(job, 0);

  pthread_mutex_lock(&job_lock);
  while (helpers_working > 0)
    pthread_cond_wait(&job_finished, &job_lock);
  pthread_mutex_unlock(&job_lock);
}
#else
static void run_job(const sieve_job *job) { run_slice(job, 0); }
#endif

// runs a shared-window job on `threads` threads and merges their marks into
// `segment`: a number is composite if any thread marked it
static void mark_window_with(sieve_job *job, int threads) {
  job->threads = threads;
  run_job(job);
#ifdef SIEVE_THREADS
  for (int thread_index = 1; thread_index < threads; thread_index++) {
    const uint8_t *marks = helpers[thread_index - 1].segment;
    for (size_t i = 0; i < SEGMENT_BYTES; i++)
      segment[i] |= marks[i];
  }
#endif
}

static double milliseconds_now(void) {
  struct timespec now;
  clock_gettime(CLOCK_MONOTONIC, &now);
  return (double)now.tv_sec * 1e3 + (double)now.tv_nsec / 1e6;
}

// the fastest of a few runs, on one thread or on all of them. each run marks
// the whole window, so `segment` holds a complete result afterwards
static double fastest_marking_ms(sieve_job *job, int threads) {
  double fastest = 0;
  for (int run = 0; run < 3; run++) {
    double started = milliseconds_now();
    mark_window_with(job, threads);
    double took = milliseconds_now() - started;
    if (run == 0 || took < fastest)
      fastest = took;
  }
  return fastest;
}

// marks the odd composites in the window at low (big_low if it's multi-limb),
// in `segment`. it needs every base prime up to largest_needed.
// Splitting gets more worthwhile the more base primes a window needs, so a
// window at least as big as one where it won is split, and one no bigger than
// where it lost isn't. a window at least twice as big as where it lost and at
// most half as big as where it won is marked both ways and timed, and moves
// one bound: all threads must be clearly faster (by 10%) to win. that's at
// most a dozen or so measurements, wherever the user jumps. sizes between
// the bounds that aren't measured stay on one thread. the result is the same
// either way; only the time differs
static void mark_window(uint64_t low, const big_number *big_low, uint64_t largest_needed) {
  sieve_job job = {0, 1, low, big_low, largest_needed, checkpoints_needed(largest_needed), 0};
  size_t size = job.checkpoints;
  int all_threads = helper_count + 1;
  int worth_measuring = size / 2 >= largest_size_split_lost &&
                        (smallest_size_split_won == SIZE_MAX || size <= smallest_size_split_won / 2);
  if (all_threads > 1 && size >= smallest_size_split_won) {
    mark_window_with(&job, all_threads);
  } else if (all_threads > 1 && worth_measuring) {
    double started = milliseconds_now();
    double one_thread_ms = fastest_marking_ms(&job, 1);
    double all_threads_ms = fastest_marking_ms(&job, all_threads);
    measuring_ms += milliseconds_now() - started;
    if (all_threads_ms < one_thread_ms * 0.9)
      smallest_size_split_won = size;
    else
      largest_size_split_lost = size;
  } else {
    mark_window_with(&job, 1);
  }
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
  size_t count_before = base_prime_count;
  size_t checkpoints_before = checkpoint_count;

  // BOOTSTRAP_LIMIT is odd-aligned after the first step. Primes are appended
  // after each round of windows, so the base primes must already cover the
  // square root of every window in the round. past the bootstrap they always
  // do (low^2 is far beyond low + threads * SEGMENT_SPAN); the check is there
  // so it never depends on that
  uint64_t low = base_limit | 1;
  while (low < new_limit) {
    uint64_t windows_left = (new_limit - low + SEGMENT_SPAN - 1) / SEGMENT_SPAN;
    int windows = windows_left < (uint64_t)helper_count + 1 ? (int)windows_left : helper_count + 1;
    while (windows > 1 && integer_sqrt(low + (uint64_t)windows * SEGMENT_SPAN - 1) >= low)
      windows--;
    // each thread sieves its window and encodes the primes it found; they're
    // appended here in window order
    sieve_job job = {1, windows, low, NULL, 0, 0, new_limit};
    run_job(&job);

    for (int window = 0; window < windows; window++) {
      if (!append_window_primes(thread_found(window))) {
        base_gap_bytes = bytes_before;
        largest_base_prime = largest_before;
        base_prime_count = count_before;
        checkpoint_count = checkpoints_before;
        return 0;
      }
    }
    low += (uint64_t)windows * SEGMENT_SPAN;
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

// tests only: walks every base prime and checks the storage is consistent:
// the primes strictly increase, the largest is below the limit, the count and
// the largest agree with what's stored, and each checkpoint is exactly where
// it should be (at every interval-th prime, from 3). returns 1 if all hold
int sieve_test_base_primes_consistent(void) {
  if (base_prime_count == 0)
    return checkpoint_count == 0;
  base_prime_cursor cursor = first_base_prime();
  size_t index = 0, checkpoints_seen = 0;
  for (;;) {
    if (index % BASE_PRIME_CHECKPOINT_INTERVAL == 0) {
      if (checkpoints_seen >= checkpoint_count)
        return 0;
      base_prime_cursor expected = base_prime_checkpoints[checkpoints_seen++];
      if (expected.byte_index != cursor.byte_index || expected.prime != cursor.prime)
        return 0;
    }
    index++;
    uint64_t previous = cursor.prime;
    if (!next_base_prime(&cursor))
      break;
    if (cursor.prime <= previous)
      return 0;
  }
  return index == base_prime_count && checkpoints_seen == checkpoint_count &&
         cursor.prime == largest_base_prime && largest_base_prime < base_limit;
}

// tests only: stores `primes` (odd, ascending, starting at 3, which the
// storage assumes) as gaps in fresh storage, reads them back through the
// cursor, and returns 1 if every one comes back unchanged. the real base
// primes are put back afterwards. real base primes don't need the 9-byte
// escape until after 304,599,508,537, so tests use synthetic gaps
int sieve_test_gap_encoding_round_trip(const uint64_t *primes, size_t count) {
  uint8_t *saved_gaps = base_prime_gaps;
  size_t saved_bytes = base_gap_bytes, saved_capacity = base_gap_capacity;
  uint64_t saved_largest = largest_base_prime;
  base_prime_cursor *saved_checkpoints = base_prime_checkpoints;
  size_t saved_count = base_prime_count, saved_checkpoint_count = checkpoint_count;
  size_t saved_checkpoint_capacity = checkpoint_capacity;
  base_prime_gaps = NULL;
  base_gap_bytes = base_gap_capacity = 0;
  largest_base_prime = 0;
  base_prime_checkpoints = NULL;
  base_prime_count = checkpoint_count = checkpoint_capacity = 0;

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
  free(base_prime_checkpoints);
  base_prime_checkpoints = saved_checkpoints;
  base_prime_count = saved_count;
  checkpoint_count = saved_checkpoint_count;
  checkpoint_capacity = saved_checkpoint_capacity;
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
    uint64_t largest_needed = integer_sqrt(low_u64 + SEGMENT_SPAN - 1);
    if (!ensure_base_primes(largest_needed))
      return 0;
    mark_window(low_u64, NULL, largest_needed);
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
    mark_window(0, low, big_number_to_u64(&root));
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
