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
} proof_slot;

static proof_slot *slots = NULL;
static int slot_count = 0;

static uint32_t *input_limbs = NULL;
static size_t input_capacity = 0;
static uint32_t *output_limbs = NULL;
static size_t output_capacity = 0;

// One slot per thread. Helpers start once, when the module loads, so this only
// grows the first time (or if they started after the first call).
static int ensure_slots(void) {
  int wanted = sieve_thread_count();
  if (wanted <= slot_count)
    return 1;
  proof_slot *grown = realloc(slots, (size_t)wanted * sizeof *grown);
  if (grown == NULL)
    return 0;
  for (int index = slot_count; index < wanted; index++) {
    grown[index].prover_ready = 0;
    grown[index].state = PROOF_SLOT_IDLE;
  }
  slots = grown;
  slot_count = wanted;
  return 1;
}

int proof_slot_count(void) { return ensure_slots() ? slot_count : 0; }

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
  big_number candidate;
  big_number_init(&candidate);
  int ok = big_number_set_limbs(&candidate, input_limbs, limb_count) && ecpp_prover_reset(&target->prover, &candidate);
  big_number_free(&candidate);
  target->state = ok ? PROOF_SLOT_PROVING : PROOF_SLOT_IDLE;
  return ok;
}

// One thread's part of proof_slots_run: its own slot, and nothing else.
static void run_own_slot(int thread_index, void *context) {
  size_t work = *(const size_t *)context;
  if (thread_index >= slot_count)
    return;
  proof_slot *slot = &slots[thread_index];
  if (slot->state != PROOF_SLOT_PROVING && slot->state != PROOF_SLOT_OUT_OF_MEMORY)
    return;
  ecpp_proof_status status = ecpp_prover_run(&slot->prover, work);
  slot->state = status == ECPP_PROOF_DONE   ? PROOF_SLOT_DONE
                : status == ECPP_PROOF_MORE ? PROOF_SLOT_PROVING
                                            : PROOF_SLOT_OUT_OF_MEMORY;
}

int proof_slots_run(size_t work) {
  if (!ensure_slots())
    return 0;
  sieve_run_on_every_thread(run_own_slot, &work);
  int unfinished = 0;
  for (int index = 0; index < slot_count; index++)
    unfinished += slots[index].state == PROOF_SLOT_PROVING || slots[index].state == PROOF_SLOT_OUT_OF_MEMORY;
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
  if (slot >= 0 && slot < slot_count)
    slots[slot].state = PROOF_SLOT_IDLE;
}
