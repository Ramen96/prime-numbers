// Native tests for wasm/proof_slots.c, on the sieve's own thread pool: each
// slot's certificate is the one a lone prover finds for the same candidate,
// however many slots run at once and in however small pieces; idle slots stay
// idle; slots are reused. Run single-threaded and with helpers
// (PROOF_TEST_HELPERS=n), and under ThreadSanitizer (npm run test:native:tsan).
//
// Run with: npm run test:native

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

#include "../../wasm/ecpp_prover.h"
#include "../../wasm/primality.h"
#include "../../wasm/proof_slots.h"

#ifdef SIEVE_THREADS
int sieve_start_helpers(int count);
#endif

static int checks_run = 0;
static int checks_failed = 0;

static void expect(int condition, const char *name, size_t detail) {
  checks_run++;
  if (condition)
    return;
  if (++checks_failed <= 20)
    printf("FAILED %s (%zu)\n", name, detail);
}

// The first BPSW pass after 7 · 10^(digits − 1) + offset.
static void probable_prime_near(big_number *result, int digits, uint64_t offset) {
  big_number ten;
  big_number_init(&ten);
  big_number_set_u64(&ten, 10);
  big_number_set_u64(result, 7);
  for (int index = 1; index < digits; index++)
    big_number_multiply(result, result, &ten);
  big_number_add_small(result, offset | 1);
  while (bpsw(result, NULL) != PRIMALITY_PROBABLE_PRIME)
    big_number_add_small(result, 2);
  big_number_free(&ten);
}

static void start(int slot, const big_number *candidate) {
  uint32_t *input = proof_input_buffer(candidate->limb_count);
  for (size_t index = 0; index < candidate->limb_count; index++)
    input[index] = candidate->limbs[index];
  expect(proof_slot_start(slot, candidate->limb_count), "a slot starts", (size_t)slot);
}

// Whether a slot's value equals a big number, limb by limb.
static int value_is(int slot, size_t step, int field, const big_number *expected) {
  size_t count = proof_slot_value(slot, step, field);
  if (count != expected->limb_count)
    return 0;
  for (size_t index = 0; index < count; index++)
    if (proof_output_buffer()[index] != expected->limbs[index])
      return 0;
  return 1;
}

// The slot's certificate against a lone prover's for the same candidate.
static void check_against_lone_prover(ecpp_prover *lone, int slot, const big_number *candidate) {
  ecpp_prover_reset(lone, candidate);
  while (ecpp_prover_run(lone, 1u << 20) == ECPP_PROOF_MORE)
    ;
  expect(proof_slot_step_count(slot) == ecpp_prover_step_count(lone), "as many steps as a lone prover", (size_t)slot);
  for (size_t step = 0; step < ecpp_prover_step_count(lone) && step < proof_slot_step_count(slot); step++) {
    const ecpp_certificate_step *values = ecpp_prover_step(lone, step);
    const big_number *fields[] = {&values->number, &values->curve_a, &values->curve_b, &values->point_x, &values->point_y, &values->order_prime};
    for (int field = 0; field < 6; field++)
      expect(value_is(slot, step, field, fields[field]), "the same certificate as a lone prover", step);
  }
  expect(proof_slot_step_count(slot) == 0 || value_is(slot, 0, 0, candidate), "the first step is the candidate", (size_t)slot);
}

int main(void) {
#ifdef SIEVE_THREADS
  const char *requested = getenv("PROOF_TEST_HELPERS");
  if (requested)
    printf("threads: %d helpers started\n", sieve_start_helpers(atoi(requested)));
#endif
  int slots = proof_slot_count();
  expect(slots >= 1, "at least one slot", (size_t)slots);
  ecpp_prover lone;
  expect(ecpp_prover_init(&lone, 0), "a lone prover starts", 0);

  big_number *candidates = calloc((size_t)slots, sizeof *candidates);
  for (int round = 0; round < 3; round++) {
    // every slot at once, run in small pieces
    for (int slot = 0; slot < slots; slot++) {
      big_number_init(&candidates[slot]);
      probable_prime_near(&candidates[slot], 28 + 6 * ((slot + round) % 6), (uint64_t)(slot * 1000003 + round * 7));
      start(slot, &candidates[slot]);
      expect(proof_slot_state_of(slot) == PROOF_SLOT_PROVING, "a started slot is proving", (size_t)slot);
    }
    int pieces = 0;
    while (proof_slots_run(2) > 0)
      pieces++;
    expect(pieces > 0, "the work took more than one piece", (size_t)pieces);
    for (int slot = 0; slot < slots; slot++) {
      expect(proof_slot_state_of(slot) == PROOF_SLOT_DONE, "every slot finished", (size_t)slot);
      check_against_lone_prover(&lone, slot, &candidates[slot]);
      proof_slot_clear(slot);
      expect(proof_slot_state_of(slot) == PROOF_SLOT_IDLE && proof_slot_step_count(slot) == 0, "a cleared slot is idle", (size_t)slot);
      big_number_free(&candidates[slot]);
    }
  }

  // only the last slot started: the others stay idle while it's proven
  big_number_init(&candidates[0]);
  probable_prime_near(&candidates[0], 40, 12345);
  start(slots - 1, &candidates[0]);
  while (proof_slots_run(1000) > 0)
    ;
  for (int slot = 0; slot < slots - 1; slot++)
    expect(proof_slot_state_of(slot) == PROOF_SLOT_IDLE, "an idle slot stays idle", (size_t)slot);
  expect(proof_slot_state_of(slots - 1) == PROOF_SLOT_DONE, "the started slot finished", (size_t)(slots - 1));
  check_against_lone_prover(&lone, slots - 1, &candidates[0]);
  big_number_free(&candidates[0]);

  // what doesn't exist: no slot, no step, no field
  expect(!proof_slot_start(slots, 1) && !proof_slot_start(-1, 1), "no such slot", 0);
  expect(proof_slot_value(slots - 1, 1000000, 0) == 0 && proof_slot_value(slots - 1, 0, 6) == 0, "no such step or field", 0);

  free(candidates);
  ecpp_prover_free(&lone);
  printf("native proof slot tests (%d slots): %d checks, %d failed\n", slots, checks_run, checks_failed);
  return checks_failed > 0;
}
