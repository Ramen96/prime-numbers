// Proof slots (CLAUDE.md, Road to completion, step 4b): one ECPP prover per
// thread, so several candidates are proven at once on the sieve's threads.
//
// JavaScript starts a candidate in a slot, then calls proof_slots_run with a
// bounded amount of work, again and again, so it can stop, report progress and
// go on (ecpp_prover.h). Each slot is worked on by one thread only, its own,
// and a slot's prover keeps its tables and class polynomials for the next
// candidate. A finished slot's certificate is read out as limbs, a value at a
// time, for the worker to check (lib/primes/primalityCertificate.ts) before
// the prime is shown.
//
// Every function here is for the calling thread, between sieve calls, like
// every other sieve call.

#ifndef PROOF_SLOTS_H
#define PROOF_SLOTS_H

#include <stddef.h>
#include <stdint.h>

// A slot's state, as proof_slot_state returns it.
typedef enum {
  PROOF_SLOT_IDLE = 0,          // nothing started
  PROOF_SLOT_PROVING = 1,       // started, not finished
  PROOF_SLOT_DONE = 2,          // the certificate is ready
  PROOF_SLOT_OUT_OF_MEMORY = 3, // memory ran out last time; the next run tries again
} proof_slot_state;

// How many slots there are: one per thread. 0 if memory runs out.
int proof_slot_count(void);

// Room for a candidate of `limb_count` limbs, for JavaScript to write into
// before proof_slot_start. NULL if memory runs out.
uint32_t *proof_input_buffer(size_t limb_count);

// Starts proving the candidate in the input buffer in `slot`: odd, above 3, not
// a multiple of 3, and a BPSW pass. Returns 1, or 0 if memory runs out or the
// slot doesn't exist.
int proof_slot_start(int slot, size_t limb_count);

// Works on every started, unfinished slot at once, each on its own thread, for
// about `work` units each (ecpp_prover_run). Returns how many are still unfinished.
int proof_slots_run(size_t work);

int proof_slot_state_of(int slot);

// The finished certificate: how many steps, and one value of one step (0 the
// number, 1 a, 2 b, 3 x, 4 y, 5 q) into the output buffer, returning its limb
// count (or SIZE_MAX if memory runs out). The buffer's address can change with
// each call, so read proof_output_buffer after it.
size_t proof_slot_step_count(int slot);
size_t proof_slot_value(int slot, size_t step, int field);
uint32_t *proof_output_buffer(void);

// Back to idle, keeping the prover's tables for the next candidate.
void proof_slot_clear(int slot);

#endif
