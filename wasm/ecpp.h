// Elliptic curve arithmetic for proving primes (ECPP, Phase 5), on curves
// y² = x³ + ax + b modulo a number N that's only probably prime.
//
// This is the prover's side. It only has to be right when N is prime: anything
// it gets wrong otherwise is refused by the independent checker
// (lib/primes/primalityCertificate.ts). When N is composite it must still end,
// and it may notice: a denominator with no inverse is reported as such.

#ifndef ECPP_H
#define ECPP_H

#include <stddef.h>

#include "bignum.h"

typedef struct {
  montgomery_context montgomery; // arithmetic modulo N
  big_number a_form;             // a, in Montgomery form
  big_number a;
  big_number b;
} ecpp_curve;

// Results of the operations below.
typedef enum {
  ECPP_FOUND,          // a point (or a root) was found
  ECPP_IDENTITY,       // the result is the point at infinity
  ECPP_NOT_INVERTIBLE, // a denominator shares a factor with N: N is composite
  ECPP_NOT_FOUND,      // no point turned up in the tries allowed
  ECPP_OUT_OF_MEMORY,
} ecpp_status;

// N must be odd and above 1. a and b may be any size. Returns 0 if not, or if
// memory runs out.
int ecpp_curve_init(ecpp_curve *curve, const big_number *modulus, const big_number *a, const big_number *b);
void ecpp_curve_free(ecpp_curve *curve);

// (out_x, out_y) = scalar · (x, y), with coordinates below N: ECPP_FOUND, or
// ECPP_IDENTITY (out_x and out_y unchanged), or ECPP_NOT_INVERTIBLE. scalar 0 is
// the identity. The outputs may be the same numbers as the inputs.
ecpp_status ecpp_multiply(ecpp_curve *curve, big_number *out_x, big_number *out_y, const big_number *x,
                          const big_number *y, const big_number *scalar);

// The first point on the curve with x at or above start_x and y not 0, trying a
// limited number of x. N must be odd and above 2. y is the root
// big_number_square_root_mod finds, so it's a real point whatever N is.
ecpp_status ecpp_find_point(ecpp_curve *curve, big_number *out_x, big_number *out_y, const big_number *start_x);

#endif
