// The ECPP prover (CLAUDE.md, Road to completion, step 3): a primality proof for
// a number past a(13), as a chain of certificate steps in the format the checker
// reads (lib/primes/primalityCertificate.ts).
//
// Each step (N, a, b, x, y, q) says that the point (x, y) has order q on
// y² = x³ + ax + b mod N, with q > (N^¼ + 1)². If q is prime, so is N; q is the
// next step's N, and the chain ends at a number below a(13), which deterministic
// Miller–Rabin proves. The checker re-checks every step, so nothing here has to be
// trusted for correctness.
//
// The search never gives up. A step's options come from discriminants taken in
// order (in bands of |D|, cheapest class polynomials first, with no last band), and
// a branch that gets stuck gives way to the next option, its parent to the next of
// its own, and so on; if every option at the top is stuck, the effort allowed per
// step doubles and the search starts again. So a prime only waits on the hardware,
// and a candidate that isn't settled stays pending (A1).
//
// The work is done a bounded amount at a time (ecpp_prover_run), so the caller
// can stop, report progress and resume.

#ifndef ECPP_PROVER_H
#define ECPP_PROVER_H

#include <stddef.h>
#include <stdint.h>

#include "bignum.h"
#include "classpoly.h"

typedef struct {
  big_number number, curve_a, curve_b, point_x, point_y, order_prime;
} ecpp_certificate_step;

typedef enum {
  // The steps are complete: the last step's order_prime (or the candidate itself,
  // with no steps) is below a(13).
  ECPP_PROOF_DONE,
  // Not finished yet: call ecpp_prover_run again to go on.
  ECPP_PROOF_MORE,
  // Memory ran out. The search can go on (ecpp_prover_run again) once memory
  // is free; nothing is lost and nothing is decided.
  ECPP_PROOF_OUT_OF_MEMORY,
} ecpp_proof_status;

// Everything below is private to ecpp_prover.c; the struct is here so it can live
// on the caller's stack or in a worker's state.

typedef struct {
  int64_t discriminant;
  size_t class_number;
} ecpp_discriminant;

typedef struct {
  int64_t discriminant;
  class_polynomial polynomial;
} ecpp_cached_polynomial;

typedef struct ecpp_proof_node ecpp_proof_node;

typedef struct {
  // Discriminants in the order they're tried, built a band at a time.
  ecpp_discriminant *discriminants;
  size_t discriminant_count, discriminant_capacity;
  int64_t next_band_start; // |D| where the next band begins
  // Class polynomials built so far, kept for the next candidates.
  ecpp_cached_polynomial *polynomials;
  size_t polynomial_count, polynomial_capacity;
  // The primes used to strip small factors from curve orders.
  uint32_t *small_primes;
  size_t small_prime_count;
  // The search: the chain so far, one node per number.
  ecpp_proof_node *nodes;
  size_t depth, node_capacity;
  // How many discriminants one node may examine before it gives way. Doubles
  // whenever the whole search is stuck.
  size_t effort_limit;
  size_t initial_effort_limit;
  // The finished certificate, once ECPP_PROOF_DONE.
  ecpp_certificate_step *steps;
  size_t step_count;
} ecpp_prover;

// Sets up a prover, with nothing to prove yet. effort_limit is how many
// discriminants one step may examine before giving way; 0 means the default.
// Returns 1, or 0 if memory runs out.
int ecpp_prover_init(ecpp_prover *prover, size_t effort_limit);

// Starts on a new candidate: odd, above 3, not a multiple of 3, and believed prime
// (it passed BPSW). Keeps the tables and class polynomials. Returns 1, or 0 if
// memory runs out.
int ecpp_prover_reset(ecpp_prover *prover, const big_number *candidate);

// Goes on with the proof for about `work` units (a unit is one discriminant
// examined, or one curve built).
ecpp_proof_status ecpp_prover_run(ecpp_prover *prover, size_t work);

// The certificate, once ecpp_prover_run has returned ECPP_PROOF_DONE.
size_t ecpp_prover_step_count(const ecpp_prover *prover);
const ecpp_certificate_step *ecpp_prover_step(const ecpp_prover *prover, size_t index);

void ecpp_prover_free(ecpp_prover *prover);

#endif
