// Deterministic Miller–Rabin (CLAUDE.md, Phase 4), for the candidates a
// partial sieve leaves behind.
//
// Miller–Rabin with the first k primes as bases never calls a composite
// "prime" below a proven bound: OEIS A014233, a(k) = the smallest odd
// composite that passes all of the first k prime bases. With all 13 bases
// (2 to 41) that bound is a(13) = 3,317,044,064,679,887,385,961,981, about
// 3.3 × 10^24. Below it, the verdict is a proof either way:
//
//   prime      every base needed for the candidate's size passed;
//   composite  a small prime divides it, or a base is a "witness": a number
//              that would be impossible if the candidate were prime.
//
// From a(13) up, nothing is proven and the candidate stays pending (A1); the
// proofs of Phase 5 take over there. The same tests run at any size; only the
// conclusion is limited.
//
// Two paths, which must agree (Requirement B): uint64_t arithmetic below
// 2^64, and multi-limb Montgomery arithmetic (bignum.h) for any size.

#ifndef PRIMALITY_H
#define PRIMALITY_H

#include <stdint.h>

#include "bignum.h"

typedef enum {
  // Proven prime: one of the 13 base primes, or passed every base it needs.
  PRIMALITY_PRIME,
  // Proven composite: the evidence is a prime (2 to 41) that divides it.
  PRIMALITY_COMPOSITE_BY_FACTOR,
  // Proven composite: the evidence is a Miller–Rabin witness base.
  PRIMALITY_COMPOSITE_BY_WITNESS,
  // 0 or 1: neither prime nor composite. (The sieve never asks.)
  PRIMALITY_BELOW_TWO,
  // At least a(13) with no small factor: not proven either way. Stays pending.
  PRIMALITY_BEYOND_PROVEN_BOUND,
  // Memory ran out part way: not settled. Stays pending, never "composite".
  PRIMALITY_OUT_OF_MEMORY,
} primality_verdict;

// The verdict for a candidate below 2^64, using uint64_t arithmetic.
// `evidence` (may be NULL) receives the factor or witness for a composite.
primality_verdict miller_rabin_u64(uint64_t candidate, uint32_t *evidence);

// The verdict for a candidate of any size, always by the multi-limb path.
primality_verdict miller_rabin_multi_limb(const big_number *candidate, uint32_t *evidence);

// The verdict for a candidate of any size: the uint64_t path below 2^64, the
// multi-limb path above.
primality_verdict miller_rabin(const big_number *candidate, uint32_t *evidence);

// One strong probable-prime test: 1 if the odd candidate (> base + 1) passes
// base `base`, 0 if `base` is a witness that it's composite, -1 if memory ran
// out. On its own this proves nothing about a pass; it's the building block
// of the verdicts above (and of BPSW's base-2 test in Phase 5).
int strong_probable_prime_u64(uint64_t candidate, uint32_t base);
int strong_probable_prime(const big_number *candidate, uint32_t base);

#endif
