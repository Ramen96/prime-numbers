// Proof slots: one ECPP prover per thread. See proof_slots.h.

#include "proof_slots.h"

#include <stdlib.h>

#include "ecpp_prover.h"

// From sieve.c: the thread pool.
int sieve_thread_count(void);
void sieve_run_on_every_thread(void (*task)(int thread_index, void *context), void *context);

typedef struct {
  ecpp_prover prover;
  int prover_ready; // ecpp_prover_init has run
  proof_slot_state state;
  // the batch out to be stripped (proof_slot_strip_batch): 0 when none is
  uint32_t strip_batch;
} proof_slot;

static proof_slot *slots = NULL;
static int slot_count = 0;
// Which of its provers each thread runs first, alternating run by run, so both get
// their turn when both have work. One entry per thread, touched only by that thread.
static unsigned char *first_prover = NULL;

static uint32_t *input_limbs = NULL;
static size_t input_capacity = 0;
static uint32_t *output_limbs = NULL;
static size_t output_capacity = 0;

// proof_slots_set_external_stripping's settings, for provers made later too.
static size_t discriminants_per_batch = 0;
static size_t external_from_bits = 0;
// The last batch number given out, by any slot, so an answer for an old batch isn't
// taken for a newer one. Numbers go round from 1 to 2^32 − 2 (0 is none, 2^32 − 1
// marks a batch not yet numbered): an answer would have to come back about four
// billion batches late to be mistaken, and a late answer is still checked factor
// by factor, so the worst it could do is be counted as rejected.
static uint32_t last_batch = 0;

// PROVERS_PER_THREAD slots per thread: thread t's are t · PROVERS_PER_THREAD and
// the ones after it, so the layout holds if more threads start later. Helpers start
// once, when the module loads, so this only grows the first time (or if they
// started after the first call).
static int ensure_slots(void) {
  int wanted = sieve_thread_count() * PROVERS_PER_THREAD;
  if (wanted <= slot_count)
    return 1;
  unsigned char *grown_first = realloc(first_prover, (size_t)(wanted / PROVERS_PER_THREAD));
  if (grown_first == NULL)
    return 0;
  for (int thread = slot_count / PROVERS_PER_THREAD; thread < wanted / PROVERS_PER_THREAD; thread++)
    grown_first[thread] = 0;
  first_prover = grown_first;
  proof_slot *grown = realloc(slots, (size_t)wanted * sizeof *grown);
  if (grown == NULL)
    return 0;
  for (int index = slot_count; index < wanted; index++) {
    grown[index].prover_ready = 0;
    grown[index].state = PROOF_SLOT_IDLE;
    grown[index].strip_batch = 0;
  }
  slots = grown;
  slot_count = wanted;
  return 1;
}

int proof_slot_count(void) { return ensure_slots() ? slot_count : 0; }

int proof_slots_per_thread(void) { return PROVERS_PER_THREAD; }

// Grows a limb buffer to at least `limb_count`. NULL if memory runs out.
static uint32_t *grow_buffer(uint32_t **buffer, size_t *capacity, size_t limb_count) {
  if (limb_count > *capacity) {
    uint32_t *grown = realloc(*buffer, limb_count * sizeof *grown);
    if (grown == NULL)
      return NULL;
    *buffer = grown;
    *capacity = limb_count;
  }
  return *buffer;
}

uint32_t *proof_input_buffer(size_t limb_count) {
  return grow_buffer(&input_limbs, &input_capacity, limb_count > 0 ? limb_count : 1);
}

uint32_t *proof_output_buffer(void) { return output_limbs; }

int proof_slot_start(int slot, size_t limb_count) {
  if (!ensure_slots() || slot < 0 || slot >= slot_count || limb_count > input_capacity)
    return 0;
  proof_slot *target = &slots[slot];
  if (!target->prover_ready) {
    if (!ecpp_prover_init(&target->prover, 0))
      return 0;
    target->prover_ready = 1;
  }
  ecpp_prover_set_external_stripping(&target->prover, discriminants_per_batch, external_from_bits);
  target->strip_batch = 0;
  big_number candidate;
  big_number_init(&candidate);
  int ok = big_number_set_limbs(&candidate, input_limbs, limb_count) && ecpp_prover_reset(&target->prover, &candidate);
  big_number_free(&candidate);
  target->state = ok ? PROOF_SLOT_PROVING : PROOF_SLOT_IDLE;
  return ok;
}

// Runs one slot's prover for up to `work` units and records its state; returns the
// units it used.
static size_t run_slot(proof_slot *slot, size_t work) {
  if (slot->state != PROOF_SLOT_PROVING && slot->state != PROOF_SLOT_OUT_OF_MEMORY && slot->state != PROOF_SLOT_WAITING)
    return 0;
  ecpp_proof_status status = ecpp_prover_run(&slot->prover, work);
  switch (status) {
  case ECPP_PROOF_DONE:
    slot->state = PROOF_SLOT_DONE;
    break;
  case ECPP_PROOF_MORE:
    slot->state = PROOF_SLOT_PROVING;
    break;
  case ECPP_PROOF_NEEDS_STRIPPING:
    // a new batch is out (the batch number is given out by the calling thread,
    // after the run: see number_new_batches)
    slot->state = PROOF_SLOT_PROVING;
    slot->strip_batch = UINT32_MAX;
    break;
  case ECPP_PROOF_WAITING:
    slot->state = PROOF_SLOT_WAITING;
    break;
  default:
    slot->state = PROOF_SLOT_OUT_OF_MEMORY;
  }
  return slot->prover.work_done;
}

// One thread's part of proof_slots_run: its own provers, and nothing else. They share
// the run's `work`: when one hands out a batch and has to wait for it, the thread goes
// on with the other instead of idling until the run ends (step 11d measured two
// thirds of the threads idle that way). It stops when the work is used up, or when a
// pass over both made no progress (each finished, waiting, or out of memory).
static void run_own_slots(int thread_index, void *context) {
  size_t budget = *(const size_t *)context;
  if ((thread_index + 1) * PROVERS_PER_THREAD > slot_count)
    return;
  proof_slot *own = &slots[thread_index * PROVERS_PER_THREAD];
  int first = first_prover[thread_index];
  first_prover[thread_index] = (unsigned char)((first + 1) % PROVERS_PER_THREAD);
  for (int progressed = 1; budget > 0 && progressed;) {
    progressed = 0;
    for (int turn = 0; turn < PROVERS_PER_THREAD && budget > 0; turn++) {
      size_t used = run_slot(&own[(first + turn) % PROVERS_PER_THREAD], budget);
      budget -= used < budget ? used : budget;
      progressed |= used > 0;
    }
  }
}

// Numbers the batches handed out in the last run (marked UINT32_MAX by their
// threads), on the calling thread, so last_batch is touched by one thread only.
static void number_new_batches(void) {
  for (int index = 0; index < slot_count; index++) {
    if (slots[index].strip_batch != UINT32_MAX)
      continue;
    last_batch = last_batch == UINT32_MAX - 1 ? 1 : last_batch + 1;
    slots[index].strip_batch = last_batch;
  }
}

int proof_slots_run(size_t work) {
  if (!ensure_slots())
    return 0;
  sieve_run_on_every_thread(run_own_slots, &work);
  number_new_batches();
  int unfinished = 0;
  for (int index = 0; index < slot_count; index++) {
    proof_slot_state state = slots[index].state;
    unfinished += state == PROOF_SLOT_PROVING || state == PROOF_SLOT_OUT_OF_MEMORY || state == PROOF_SLOT_WAITING;
  }
  return unfinished;
}

int proof_slot_state_of(int slot) {
  return slot >= 0 && slot < slot_count ? (int)slots[slot].state : (int)PROOF_SLOT_IDLE;
}

size_t proof_slot_step_count(int slot) {
  if (proof_slot_state_of(slot) != PROOF_SLOT_DONE)
    return 0;
  return ecpp_prover_step_count(&slots[slot].prover);
}

size_t proof_slot_value(int slot, size_t step, int field) {
  if (step >= proof_slot_step_count(slot) || field < 0 || field > 5)
    return 0;
  const ecpp_certificate_step *values = ecpp_prover_step(&slots[slot].prover, step);
  const big_number *fields[] = {&values->number, &values->curve_a, &values->curve_b,
                                &values->point_x, &values->point_y, &values->order_prime};
  const big_number *value = fields[field];
  if (value->limb_count > 0 && grow_buffer(&output_limbs, &output_capacity, value->limb_count) == NULL)
    return SIZE_MAX;
  for (size_t index = 0; index < value->limb_count; index++)
    output_limbs[index] = value->limbs[index];
  return value->limb_count;
}

void proof_slot_clear(int slot) {
  if (slot >= 0 && slot < slot_count) {
    slots[slot].state = PROOF_SLOT_IDLE;
    slots[slot].strip_batch = 0;
  }
}

size_t proof_slot_progress(int slot) {
  int state = proof_slot_state_of(slot);
  if (state != PROOF_SLOT_PROVING && state != PROOF_SLOT_WAITING)
    return 0;
  return ecpp_prover_current_bit_length(&slots[slot].prover);
}

void proof_slots_set_external_stripping(size_t per_batch, size_t from_bits) {
  discriminants_per_batch = per_batch;
  external_from_bits = from_bits;
  for (int index = 0; index < slot_count; index++) {
    if (slots[index].prover_ready)
      ecpp_prover_set_external_stripping(&slots[index].prover, per_batch, from_bits);
    // back to the CPU: what's out is stripped here at the next run, so an answer
    // for it now would only be counted as rejected
    if (per_batch == 0)
      slots[index].strip_batch = 0;
  }
}

// The slot, if it has a batch out; NULL otherwise.
static proof_slot *slot_with_batch(int slot) {
  if (slot < 0 || slot >= slot_count || slots[slot].strip_batch == 0)
    return NULL;
  proof_slot_state state = slots[slot].state;
  return state == PROOF_SLOT_PROVING || state == PROOF_SLOT_WAITING || state == PROOF_SLOT_OUT_OF_MEMORY ? &slots[slot] : NULL;
}

uint32_t proof_slot_strip_batch(int slot) {
  proof_slot *target = slot_with_batch(slot);
  return target ? target->strip_batch : 0;
}

size_t proof_slot_strip_request_count(int slot) {
  proof_slot *target = slot_with_batch(slot);
  return target ? ecpp_prover_strip_request_count(&target->prover) : 0;
}

size_t proof_slot_strip_request(int slot, size_t index) {
  proof_slot *target = slot_with_batch(slot);
  const big_number *order = target ? ecpp_prover_strip_request(&target->prover, index) : NULL;
  if (order == NULL)
    return 0;
  if (grow_buffer(&output_limbs, &output_capacity, order->limb_count) == NULL)
    return SIZE_MAX;
  for (size_t limb = 0; limb < order->limb_count; limb++)
    output_limbs[limb] = order->limbs[limb];
  return order->limb_count;
}

int proof_slot_report_factors(int slot, uint32_t batch, size_t pair_count) {
  proof_slot *target = slot_with_batch(slot);
  if (target == NULL || batch != target->strip_batch)
    return 1; // not this slot's batch now: a late answer, nothing to do
  if (2 * pair_count > input_capacity)
    return 0; // the pairs weren't written through proof_input_buffer(2 * pair_count)
  for (size_t pair = 0; pair < pair_count; pair++)
    if (!ecpp_prover_report_factor(&target->prover, input_limbs[2 * pair], input_limbs[2 * pair + 1]))
      return 0; // what was divided out stays divided: reporting it again divides nothing twice
  ecpp_prover_stripping_done(&target->prover);
  target->strip_batch = 0;
  return 1;
}

size_t proof_slot_rejected_claims(int slot) {
  if (slot < 0 || slot >= slot_count || !slots[slot].prover_ready)
    return 0;
  return ecpp_prover_rejected_claims(&slots[slot].prover);
}
