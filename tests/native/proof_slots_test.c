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

int sieve_thread_count(void);
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


// ── external stripping (step 11d) ─────────────────────────────────────────
//
// A stand-in for the GPU: trial division to built-in stripping's bound below 830
// bits (every candidate here), so certificates must be exactly a lone prover's.

#define STAND_IN_BOUND 100000
static uint32_t stand_in_primes[9592];
static size_t stand_in_prime_count = 0;

static void build_stand_in_primes(void) {
  static unsigned char composite[STAND_IN_BOUND];
  for (uint32_t value = 2; value < STAND_IN_BOUND; value++) {
    if (composite[value])
      continue;
    stand_in_primes[stand_in_prime_count++] = value;
    for (uint64_t multiple = (uint64_t)value * value; multiple < STAND_IN_BOUND; multiple += value)
      composite[multiple] = 1;
  }
}

// What the stand-in finds for a slot's batch: pairs (request, prime), and with
// `lies`, two false ones (a prime that doesn't divide request 0, a request that
// doesn't exist). Returns the pair count; the pairs are in `pairs`.
static size_t stand_in_answer(int slot, int lies, uint32_t **pairs) {
  size_t requests = proof_slot_strip_request_count(slot), count = 0, room = 64;
  *pairs = malloc(room * 2 * sizeof **pairs);
  big_number order;
  big_number_init(&order);
  for (size_t request = 0; request < requests; request++) {
    size_t limbs = proof_slot_strip_request(slot, request);
    expect(limbs > 0 && limbs != SIZE_MAX, "a request can be read", request);
    big_number_set_limbs(&order, proof_output_buffer(), limbs);
    for (size_t index = 0; index < stand_in_prime_count; index++) {
      if (big_number_mod_small(&order, stand_in_primes[index]) != 0)
        continue;
      if (count + 3 > room)
        *pairs = realloc(*pairs, (room *= 2) * 2 * sizeof **pairs);
      (*pairs)[2 * count] = (uint32_t)request;
      (*pairs)[2 * count + 1] = stand_in_primes[index];
      count++;
    }
    if (lies && request == 0) {
      uint32_t liar = 3;
      while (big_number_mod_small(&order, liar) == 0)
        liar += 2;
      (*pairs)[2 * count] = 0;
      (*pairs)[2 * count + 1] = liar;
      count++;
    }
  }
  if (lies) {
    (*pairs)[2 * count] = (uint32_t)requests + 5;
    (*pairs)[2 * count + 1] = 7;
    count++;
  }
  big_number_free(&order);
  return count;
}

static int report(int slot, uint32_t batch, const uint32_t *pairs, size_t count) {
  uint32_t *input = proof_input_buffer(2 * count);
  for (size_t index = 0; index < 2 * count; index++)
    input[index] = pairs[index];
  return proof_slot_report_factors(slot, batch, count);
}

// Answers every slot with a batch it hasn't been answered for. Returns how many lies were told.
static size_t answer_batches(int slots, int lies) {
  size_t told = 0;
  for (int slot = 0; slot < slots; slot++) {
    uint32_t batch = proof_slot_strip_batch(slot);
    if (batch == 0)
      continue;
    uint32_t *pairs;
    size_t count = stand_in_answer(slot, lies, &pairs);
    expect(report(slot, batch, pairs, count), "factors are reported", (size_t)slot);
    expect(proof_slot_strip_batch(slot) == 0, "a reported batch is done", (size_t)slot);
    free(pairs);
    told += lies ? 2 : 0;
  }
  return told;
}

#define EXTERNAL_RUNS_ALLOWED 200000 // far more than any of these needs, so a bug fails instead of hanging

// Every slot proves a candidate with external stripping, answered every `answer_every`
// runs (so slots wait in between), lying or not; certificates must be a lone prover's.
static void check_external_round(ecpp_prover *lone, int slots, int answer_every, int lies, int round) {
  big_number *candidates = calloc((size_t)slots, sizeof *candidates);
  size_t *rejected_before = calloc((size_t)slots, sizeof *rejected_before);
  for (int slot = 0; slot < slots; slot++) {
    big_number_init(&candidates[slot]);
    probable_prime_near(&candidates[slot], 30 + 7 * ((slot + round) % 5), (uint64_t)(slot * 7919 + round * 104729));
    start(slot, &candidates[slot]);
    rejected_before[slot] = proof_slot_rejected_claims(slot);
  }
  size_t lies_told = 0;
  int runs = 0, saw_waiting = 0, saw_batch = 0;
  uint32_t seen_batches[64] = {0};
  while (proof_slots_run(4) > 0 && ++runs < EXTERNAL_RUNS_ALLOWED) {
    for (int slot = 0; slot < slots; slot++) {
      saw_waiting |= proof_slot_state_of(slot) == PROOF_SLOT_WAITING;
      if (proof_slot_state_of(slot) == PROOF_SLOT_WAITING)
        expect(proof_slot_progress(slot) > 0, "a waiting slot shows its progress", (size_t)slot);
      uint32_t batch = proof_slot_strip_batch(slot);
      saw_batch |= batch != 0;
      // batches out at once have different numbers
      for (int other = 0; other < slot && other < 64; other++)
        expect(batch == 0 || seen_batches[other] != batch, "batch numbers differ between slots", (size_t)batch);
      if (slot < 64)
        seen_batches[slot] = batch;
    }
    if (runs % answer_every == 0)
      lies_told += answer_batches(slots, lies);
  }
  expect(runs < EXTERNAL_RUNS_ALLOWED, "external stripping finishes", (size_t)runs);
  expect(saw_batch, "batches are handed out", (size_t)round);
  if (answer_every > 1)
    expect(saw_waiting, "a slot waits for its batch", (size_t)round);
  size_t rejected = 0;
  for (int slot = 0; slot < slots; slot++) {
    expect(proof_slot_state_of(slot) == PROOF_SLOT_DONE, "every external slot finished", (size_t)slot);
    check_against_lone_prover(lone, slot, &candidates[slot]);
    rejected += proof_slot_rejected_claims(slot) - rejected_before[slot];
    proof_slot_clear(slot);
    big_number_free(&candidates[slot]);
  }
  expect(rejected == lies_told, "every false claim is counted, and only those", rejected);
  free(candidates);
  free(rejected_before);
}

// Runs until `slot` has a batch out; returns its number (0 if it finished first).
static uint32_t run_until_batch(int slot) {
  for (int runs = 0; runs < EXTERNAL_RUNS_ALLOWED; runs++) {
    uint32_t batch = proof_slot_strip_batch(slot);
    if (batch != 0 || proof_slot_state_of(slot) == PROOF_SLOT_DONE)
      return batch;
    proof_slots_run(4);
  }
  return 0;
}

static void check_external_stripping(ecpp_prover *lone, int slots) {
  build_stand_in_primes();
  proof_slots_set_external_stripping(1, 0);
  check_external_round(lone, slots, 1, 0, 0);
  proof_slots_set_external_stripping(4, 0);
  check_external_round(lone, slots, 1, 0, 1);
  check_external_round(lone, slots, 5, 0, 2); // slots wait between answers
  check_external_round(lone, slots, 3, 1, 3); // lying

  // a late answer: slot 0's batch answered only after the slot has a new candidate
  big_number first, second;
  big_number_init(&first);
  big_number_init(&second);
  probable_prime_near(&first, 45, 31337);
  probable_prime_near(&second, 50, 27182);
  start(0, &first);
  uint32_t old_batch = run_until_batch(0);
  expect(old_batch != 0, "the first candidate hands out a batch", 0);
  uint32_t *old_pairs;
  size_t old_count = stand_in_answer(0, 0, &old_pairs);
  proof_slot_clear(0);
  expect(proof_slot_strip_batch(0) == 0 && proof_slot_strip_request_count(0) == 0, "a cleared slot has no batch out", 0);
  start(0, &second);
  uint32_t new_batch = run_until_batch(0);
  expect(new_batch != 0 && new_batch != old_batch, "the new candidate's batch has a new number", new_batch);
  size_t rejected_before = proof_slot_rejected_claims(0);
  expect(report(0, old_batch, old_pairs, old_count), "a late answer is accepted", 0);
  expect(proof_slot_strip_batch(0) == new_batch, "a late answer leaves the new batch out", 0);
  expect(proof_slot_rejected_claims(0) == rejected_before, "a late answer isn't counted as false", 0);
  free(old_pairs);
  int runs = 0;
  while (proof_slots_run(4) > 0 && ++runs < EXTERNAL_RUNS_ALLOWED)
    answer_batches(slots, 0);
  check_against_lone_prover(lone, 0, &second);
  expect(proof_slot_rejected_claims(0) == rejected_before, "nothing is rejected after a late answer", 0);
  proof_slot_clear(0);

  // switching back to the CPU with every slot's batch out (and an answer still to come)
  big_number *candidates = calloc((size_t)slots, sizeof *candidates);
  uint32_t *batches = calloc((size_t)slots, sizeof *batches);
  for (int slot = 0; slot < slots; slot++) {
    big_number_init(&candidates[slot]);
    probable_prime_near(&candidates[slot], 40, (uint64_t)slot * 65537 + 3);
    start(slot, &candidates[slot]);
  }
  for (int slot = 0; slot < slots; slot++)
    batches[slot] = run_until_batch(slot);
  proof_slots_set_external_stripping(0, 0);
  for (int slot = 0; slot < slots; slot++) {
    expect(proof_slot_strip_batch(slot) == 0, "back on the CPU, no batch is out", (size_t)slot);
    rejected_before = proof_slot_rejected_claims(slot);
    uint32_t pair[2] = {0, 3};
    expect(report(slot, batches[slot], pair, 1), "an answer after switching back is accepted", (size_t)slot);
    expect(proof_slot_rejected_claims(slot) == rejected_before, "and ignored", (size_t)slot);
  }
  runs = 0;
  while (proof_slots_run(4) > 0 && ++runs < EXTERNAL_RUNS_ALLOWED)
    ;
  for (int slot = 0; slot < slots; slot++) {
    expect(proof_slot_strip_batch(slot) == 0, "on the CPU, no batch is handed out", (size_t)slot);
    check_against_lone_prover(lone, slot, &candidates[slot]);
    proof_slot_clear(slot);
    big_number_free(&candidates[slot]);
  }
  free(candidates);
  free(batches);
  big_number_free(&first);
  big_number_free(&second);
}

// A thread's two provers share each run's work (step 11d): while slot 0 waits for a
// batch nobody answers, or is idle, slot 1, on the same thread, gets the whole run,
// so with one unit a run it finishes in about as many runs as a lone prover needs
// units, not twice as many.
static void check_second_prover(ecpp_prover *lone) {
  expect(proof_slots_per_thread() == PROVERS_PER_THREAD && proof_slot_count() == sieve_thread_count() * PROVERS_PER_THREAD,
         "two provers per thread", (size_t)proof_slot_count());
  big_number waiting, working;
  big_number_init(&waiting);
  big_number_init(&working);
  probable_prime_near(&waiting, 110, 4242); // about 365 bits: hands out batches
  probable_prime_near(&working, 85, 777);   // about 280 bits: below the threshold, strips here
  proof_slots_set_external_stripping(4, 300);

  // the units it needs, counted on a lone prover (nothing shares its thread)
  int units = 0;
  ecpp_prover_set_external_stripping(lone, 4, 300);
  ecpp_prover_reset(lone, &working);
  while (ecpp_prover_run(lone, 1) == ECPP_PROOF_MORE && units < EXTERNAL_RUNS_ALLOWED)
    units++;
  ecpp_prover_set_external_stripping(lone, 0, 0);

  start(1, &working); // slot 0 idle
  int alone = 0;
  while (proof_slot_state_of(1) != PROOF_SLOT_DONE && alone < EXTERNAL_RUNS_ALLOWED) {
    proof_slots_run(1);
    alone++;
  }
  expect(alone <= units + 2, "an idle prover leaves its thread to the other", (size_t)alone * 100000 + (size_t)units);
  check_against_lone_prover(lone, 1, &working);
  proof_slot_clear(1);

  start(0, &waiting);
  start(1, &working);
  int together = 0;
  while (proof_slot_state_of(1) != PROOF_SLOT_DONE && together < EXTERNAL_RUNS_ALLOWED) {
    proof_slots_run(1);
    together++;
  }
  expect(proof_slot_state_of(0) == PROOF_SLOT_WAITING && proof_slot_strip_batch(0) != 0, "the first waits for its batch", 0);
  // the first runs, until slot 0 hands out its batch, are shared: a few more (181 against
  // 172 units when measured; one prover a run would take twice as many, 346)
  expect(together <= units + 20, "a waiting prover leaves its thread to the other", (size_t)together * 100000 + (size_t)units);
  expect(units > 50, "enough units to tell", (size_t)units);
  check_against_lone_prover(lone, 1, &working);
  proof_slot_clear(1);
  int runs = 0;
  while (proof_slots_run(2) > 0 && ++runs < EXTERNAL_RUNS_ALLOWED)
    answer_batches(proof_slot_count(), 0);
  check_against_lone_prover(lone, 0, &waiting);
  proof_slot_clear(0);
  proof_slots_set_external_stripping(0, 0);
  big_number_free(&waiting);
  big_number_free(&working);
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
      expect(proof_slot_progress(slot) == big_number_bit_length(&candidates[slot]),
             "progress starts at the candidate's size", (size_t)slot);
    }
    int pieces = 0;
    int went_down = 0;
    while (proof_slots_run(2) > 0) {
      pieces++;
      // between runs: every unfinished slot is somewhere in its chain, never past its candidate
      for (int slot = 0; slot < slots; slot++) {
        size_t progress = proof_slot_progress(slot);
        size_t candidate_bits = big_number_bit_length(&candidates[slot]);
        if (proof_slot_state_of(slot) == PROOF_SLOT_PROVING)
          expect(progress > 0 && progress <= candidate_bits, "progress is within the candidate's size", progress);
        else
          expect(progress == 0, "a slot that isn't proving has no progress", (size_t)slot);
        went_down |= progress > 0 && progress < candidate_bits;
      }
    }
    expect(pieces > 0, "the work took more than one piece", (size_t)pieces);
    expect(went_down, "some chain was seen part way down", (size_t)round);
    for (int slot = 0; slot < slots; slot++) {
      expect(proof_slot_state_of(slot) == PROOF_SLOT_DONE, "every slot finished", (size_t)slot);
      check_against_lone_prover(&lone, slot, &candidates[slot]);
      expect(proof_slot_progress(slot) == 0, "a finished slot has no progress", (size_t)slot);
      proof_slot_clear(slot);
      expect(proof_slot_state_of(slot) == PROOF_SLOT_IDLE && proof_slot_step_count(slot) == 0, "a cleared slot is idle", (size_t)slot);
      expect(proof_slot_progress(slot) == 0, "a cleared slot has no progress", (size_t)slot);
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

  check_external_stripping(&lone, slots);
  check_second_prover(&lone);

  // what doesn't exist: no slot, no step, no field
  expect(!proof_slot_start(slots, 1) && !proof_slot_start(-1, 1), "no such slot", 0);
  expect(proof_slot_progress(slots) == 0 && proof_slot_progress(-1) == 0, "no such slot has no progress", 0);
  expect(proof_slot_value(slots - 1, 1000000, 0) == 0 && proof_slot_value(slots - 1, 0, 6) == 0, "no such step or field", 0);
  expect(proof_slot_strip_batch(slots) == 0 && proof_slot_strip_request_count(-1) == 0 && proof_slot_strip_request(slots, 0) == 0,
         "no such slot has no batch", 0);
  expect(proof_slot_report_factors(slots, 1, 0) == 1 && proof_slot_rejected_claims(-1) == 0, "reporting to no slot does nothing", 0);

  free(candidates);
  ecpp_prover_free(&lone);
  printf("native proof slot tests (%d slots): %d checks, %d failed\n", slots, checks_run, checks_failed);
  return checks_failed > 0;
}
