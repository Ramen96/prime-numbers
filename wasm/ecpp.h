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
#include "classpoly.h"

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

// ── curves with a known order ─────────────────────────────────────────────
//
// A curve's order isn't known in general. But for a discriminant D, the curves
// with complex multiplication by D have j-invariants that are roots of the class
// polynomial H_D (classpoly.h), and their orders follow from solving
// 4N = t² + |D|v². Discriminants are int64_t, as in classpoly.h.

// The most orders one D gives: 6 for D = −3, 4 for D = −4, 2 for the rest.
#define ECPP_MOST_ORDERS 6

// Fills orders[0 .. *count) with N's possible curve orders for D. orders must be
// initialized numbers. ECPP_NOT_FOUND if 4N = t² + |D|v² has no solution: for a
// prime N, D isn't a square mod N, or (with class number above 1) it is, but N
// isn't of that form.
ecpp_status ecpp_find_orders(const big_number *n, int64_t discriminant, big_number orders[ECPP_MOST_ORDERS], size_t *count);

// A curve for D and a point on it with order q, where q divides `order`. j is a
// root of `polynomial`, H_D, built once by the caller (class_polynomial_build) and
// reused across numbers; it may be NULL for D = −3 and −4, which have their own
// families of curves. The twist is found by trial, and the point is (order / q)·P
// for a point P, so it's checked: q·Q is the identity and Q isn't. ECPP_NOT_FOUND
// if no twist gave it, which for a prime N means `order` isn't this D's, or the
// attempts ran out.
ecpp_status ecpp_curve_with_order(const big_number *n, int64_t discriminant, const class_polynomial *polynomial,
                                  const big_number *order, const big_number *q, big_number *out_a, big_number *out_b,
                                  big_number *out_x, big_number *out_y);

#endif
