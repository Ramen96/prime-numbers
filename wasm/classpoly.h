// Hilbert class polynomials, for ECPP with any discriminant (CLAUDE.md, Road to
// completion, step 2).
//
// For a discriminant D < 0, the curves with complex multiplication by D have
// j-invariants that are exactly the roots of one polynomial with integer
// coefficients, H_D. Its degree is the class number h of D, and its roots are
// j(τ) for each reduced form (a, b, c) of discriminant D, with
// τ = (−b + √D) / 2a. So H_D is built by computing those j to high precision,
// multiplying out ∏ (x − j), and rounding each coefficient to an integer.
//
// Nothing here has to be trusted. It's computed in fixed point and accepted when
// every coefficient lands very close to an integer, which isn't a proof. A wrong
// polynomial would only give a curve that fails its point check, and every proof
// is checked independently (lib/primes/primalityCertificate.ts).

#ifndef CLASSPOLY_H
#define CLASSPOLY_H

#include <stddef.h>
#include <stdint.h>

#include "bignum.h"

// A form a·x² + b·x·y + c·y². A fixed width the hardware can't reach: listing the
// forms takes about |D| steps, so |D| near 2^62 would need about 10^18 steps
// before a single j was computed, and a, |b| and c are all at most about |D|.
typedef struct {
  int64_t a, b, c;
} class_form;

// The monic polynomial x^degree + coefficients[degree − 1]·x^(degree − 1) + … +
// coefficients[0], with each coefficient's sign stored apart from its size.
typedef struct {
  size_t degree;
  big_number *magnitudes;
  uint8_t *negative;
} class_polynomial;

// A discriminant is negative and 0 or 1 mod 4.
int class_discriminant_is_valid(int64_t discriminant);

// All primitive reduced forms of a valid D, into a new array to free(). A form
// with b ≠ 0 usually has a partner (a, −b, c), which comes right after it. Their
// count is the class number. Returns 1, or 0 if memory runs out.
int class_forms(int64_t discriminant, class_form **out_forms, size_t *out_count);

// H_D for a valid D. Returns 1, 0 if memory runs out, or -1 for an invalid D.
int class_polynomial_build(class_polynomial *polynomial, int64_t discriminant);

// The same, starting from `start_bits` of precision instead of an estimate of
// what's needed, doubling until the coefficients round cleanly. There is no upper
// limit. out_bits (may be NULL) receives the precision that worked.
int class_polynomial_build_from(class_polynomial *polynomial, int64_t discriminant, size_t start_bits, size_t *out_bits);

void class_polynomial_free(class_polynomial *polynomial);

// A root of the polynomial mod an odd n > 2, into `root`, for when it splits into
// distinct linear factors mod n. H_D does that mod a prime n with 4n = t² + |D|v²,
// which is the only time ECPP asks. Any other n is safe: it ends, and any root it
// returns is still checked. Returns 1 with a root that's been checked against the
// polynomial, -1 if none was found, or 0 if memory runs out.
int class_polynomial_root(big_number *root, const class_polynomial *polynomial, const big_number *n);

#endif
