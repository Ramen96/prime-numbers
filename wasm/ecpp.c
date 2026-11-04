// Elliptic curve arithmetic for ECPP. See ecpp.h.
//
// A point is kept in Jacobian coordinates (X, Y, Z), meaning x = X / Z² and
// y = Y / Z³, with Z = 0 for the point at infinity. That avoids a modular inverse
// at every step: only the final conversion back needs one. Everything inside is
// in Montgomery form, so multiplying mod N needs no long division.

#include "ecpp.h"

// How many x to try for a point. About half of all x give one, so a prime N gets
// nowhere near this; running out only says this curve wasn't useful.
#define POINT_TRIES 10000

int ecpp_curve_init(ecpp_curve *curve, const big_number *modulus, const big_number *a, const big_number *b) {
  big_number_init(&curve->a_form);
  big_number_init(&curve->a);
  big_number_init(&curve->b);
  if (!montgomery_init(&curve->montgomery, modulus))
    return 0;
  if (big_number_divide(NULL, &curve->a, a, modulus) && big_number_divide(NULL, &curve->b, b, modulus) &&
      montgomery_to_form(&curve->montgomery, &curve->a_form, a))
    return 1;
  ecpp_curve_free(curve);
  return 0;
}

void ecpp_curve_free(ecpp_curve *curve) {
  montgomery_free(&curve->montgomery);
  big_number_free(&curve->a_form);
  big_number_free(&curve->a);
  big_number_free(&curve->b);
}

// A point, plus the working numbers one doubling or addition needs, so that a
// long multiplication doesn't allocate at every step.
typedef struct {
  big_number x, y, z;
  big_number t1, t2, t3, t4, t5, t6;
} working_point;

static big_number *working_numbers(working_point *point, size_t index) {
  big_number *numbers[] = {&point->x,  &point->y,  &point->z,  &point->t1, &point->t2,
                           &point->t3, &point->t4, &point->t5, &point->t6};
  return numbers[index];
}
#define WORKING_NUMBERS 9

static void working_point_init(working_point *point) {
  for (size_t index = 0; index < WORKING_NUMBERS; index++)
    big_number_init(working_numbers(point, index));
}

static void working_point_free(working_point *point) {
  for (size_t index = 0; index < WORKING_NUMBERS; index++)
    big_number_free(working_numbers(point, index));
}

// result = 2 · number: cheaper than a Montgomery multiplication, so it's used
// for the small constants in the formulas.
static int double_mod(big_number *result, const big_number *number, const big_number *modulus) {
  return big_number_add_mod(result, number, number, modulus);
}

// point = 2 · point, with the usual Jacobian formulas:
//   S = 4XY²    M = 3X² + aZ⁴
//   X' = M² − 2S    Y' = M(S − X') − 8Y⁴    Z' = 2YZ
// Y = 0 gives Z' = 0, the point at infinity, as it should. Returns 0 if memory runs out.
static int double_point(ecpp_curve *curve, working_point *point) {
  montgomery_context *context = &curve->montgomery;
  const big_number *modulus = &context->modulus;
  big_number *y_squared = &point->t1, *s = &point->t2, *m = &point->t3, *z_squared = &point->t4;
  return montgomery_multiply(context, y_squared, &point->y, &point->y) &&
         montgomery_multiply(context, s, &point->x, y_squared) && double_mod(s, s, modulus) &&
         double_mod(s, s, modulus) && // S = 4XY²
         montgomery_multiply(context, m, &point->x, &point->x) &&
         big_number_add_mod(&point->t5, m, m, modulus) && big_number_add_mod(m, &point->t5, m, modulus) && // 3X²
         montgomery_multiply(context, z_squared, &point->z, &point->z) &&
         montgomery_multiply(context, &point->t5, z_squared, z_squared) &&
         montgomery_multiply(context, &point->t5, &point->t5, &curve->a_form) &&
         big_number_add_mod(m, m, &point->t5, modulus) && // M = 3X² + aZ⁴
         montgomery_multiply(context, &point->z, &point->y, &point->z) &&
         double_mod(&point->z, &point->z, modulus) && // Z' = 2YZ
         montgomery_multiply(context, &point->x, m, m) && big_number_subtract_mod(&point->x, &point->x, s, modulus) &&
         big_number_subtract_mod(&point->x, &point->x, s, modulus) && // X' = M² − 2S
         big_number_subtract_mod(s, s, &point->x, modulus) && montgomery_multiply(context, &point->y, m, s) && // M(S − X')
         montgomery_multiply(context, y_squared, y_squared, y_squared) && double_mod(y_squared, y_squared, modulus) &&
         double_mod(y_squared, y_squared, modulus) && double_mod(y_squared, y_squared, modulus) && // 8Y⁴
         big_number_subtract_mod(&point->y, &point->y, y_squared, modulus);
}

// point = point + (x2, y2), an affine point in Montgomery form:
//   U = x2·Z²    S = y2·Z³    H = U − X    R = S − Y
//   X' = R² − H³ − 2XH²    Y' = R(XH² − X') − YH³    Z' = HZ
// H = 0 means the same x: the same point (double it) or its negative (infinity).
// Returns 0 if memory runs out.
static int add_affine(ecpp_curve *curve, working_point *point, const big_number *x2, const big_number *y2) {
  montgomery_context *context = &curve->montgomery;
  const big_number *modulus = &context->modulus;
  if (point->z.limb_count == 0) { // infinity + P = P
    big_number one;
    big_number_init(&one);
    int ok = big_number_copy(&point->x, x2) && big_number_copy(&point->y, y2) && big_number_set_u64(&one, 1) &&
             montgomery_to_form(context, &point->z, &one);
    big_number_free(&one);
    return ok;
  }
  big_number *h = &point->t1, *r = &point->t2, *h_squared = &point->t3, *x_h_squared = &point->t4, *h_cubed = &point->t5;
  if (!montgomery_multiply(context, h_squared, &point->z, &point->z) ||
      !montgomery_multiply(context, h, x2, h_squared) || // U = x2·Z²
      !montgomery_multiply(context, r, h_squared, &point->z) || !montgomery_multiply(context, r, r, y2) || // S = y2·Z³
      !big_number_subtract_mod(h, h, &point->x, modulus) || !big_number_subtract_mod(r, r, &point->y, modulus))
    return 0;
  if (h->limb_count == 0) {
    if (r->limb_count == 0)
      return double_point(curve, point);
    point->z.limb_count = 0; // the point at infinity
    return 1;
  }
  return montgomery_multiply(context, &point->z, h, &point->z) && // Z' = HZ
         montgomery_multiply(context, h_squared, h, h) && montgomery_multiply(context, h_cubed, h_squared, h) &&
         montgomery_multiply(context, x_h_squared, &point->x, h_squared) && montgomery_multiply(context, &point->x, r, r) &&
         big_number_subtract_mod(&point->x, &point->x, h_cubed, modulus) &&
         big_number_subtract_mod(&point->x, &point->x, x_h_squared, modulus) &&
         big_number_subtract_mod(&point->x, &point->x, x_h_squared, modulus) && // X' = R² − H³ − 2XH²
         big_number_subtract_mod(x_h_squared, x_h_squared, &point->x, modulus) &&
         montgomery_multiply(context, x_h_squared, r, x_h_squared) &&
         montgomery_multiply(context, h_cubed, &point->y, h_cubed) &&
         big_number_subtract_mod(&point->y, x_h_squared, h_cubed, modulus); // Y' = R(XH² − X') − YH³
}

ecpp_status ecpp_multiply(ecpp_curve *curve, big_number *out_x, big_number *out_y, const big_number *x,
                          const big_number *y, const big_number *scalar) {
  montgomery_context *context = &curve->montgomery;
  working_point point;
  working_point_init(&point);
  big_number x_form, y_form, z_inverse, z_power;
  big_number_init(&x_form);
  big_number_init(&y_form);
  big_number_init(&z_inverse);
  big_number_init(&z_power);
  ecpp_status status = ECPP_OUT_OF_MEMORY;
  if (!montgomery_to_form(context, &x_form, x) || !montgomery_to_form(context, &y_form, y))
    goto done;

  // left to right, from the point at infinity (Z = 0)
  for (size_t bit = big_number_bit_length(scalar); bit-- > 0;) {
    if (point.z.limb_count > 0 && !double_point(curve, &point))
      goto done;
    if ((scalar->limbs[bit / 32] >> (bit % 32)) & 1) {
      if (!add_affine(curve, &point, &x_form, &y_form))
        goto done;
    }
  }
  if (point.z.limb_count == 0) {
    status = ECPP_IDENTITY;
    goto done;
  }

  // back to ordinary affine coordinates: x = X / Z², y = Y / Z³
  if (!montgomery_from_form(context, &z_power, &point.z))
    goto done;
  int inverted = big_number_inverse_mod(&z_inverse, &z_power, &context->modulus);
  if (inverted < 0) {
    status = ECPP_NOT_INVERTIBLE;
    goto done;
  }
  if (inverted == 0 || !montgomery_to_form(context, &z_inverse, &z_inverse) ||
      !montgomery_multiply(context, &z_power, &z_inverse, &z_inverse) || // 1 / Z²
      !montgomery_multiply(context, &point.x, &point.x, &z_power) ||
      !montgomery_multiply(context, &z_power, &z_power, &z_inverse) || // 1 / Z³
      !montgomery_multiply(context, &point.y, &point.y, &z_power) || !montgomery_from_form(context, out_x, &point.x) ||
      !montgomery_from_form(context, out_y, &point.y))
    goto done;
  status = ECPP_FOUND;
done:
  working_point_free(&point);
  big_number_free(&x_form);
  big_number_free(&y_form);
  big_number_free(&z_inverse);
  big_number_free(&z_power);
  return status;
}

ecpp_status ecpp_find_point(ecpp_curve *curve, big_number *out_x, big_number *out_y, const big_number *start_x) {
  const big_number *modulus = &curve->montgomery.modulus;
  big_number x, right_side, root;
  big_number_init(&x);
  big_number_init(&right_side);
  big_number_init(&root);
  ecpp_status status = ECPP_OUT_OF_MEMORY;
  if (!big_number_divide(NULL, &x, start_x, modulus))
    goto done;
  for (int attempt = 0; attempt < POINT_TRIES; attempt++) {
    // x³ + ax + b, by Horner: ((x² + a)·x + b) mod N
    if (!big_number_multiply(&right_side, &x, &x) || !big_number_add(&right_side, &right_side, &curve->a) ||
        !big_number_multiply(&right_side, &right_side, &x) || !big_number_add(&right_side, &right_side, &curve->b) ||
        !big_number_divide(NULL, &right_side, &right_side, modulus))
      goto done;
    if (right_side.limb_count > 0) { // 0 would give y = 0: a point of order 2
      int found = big_number_square_root_mod(&root, &right_side, modulus);
      if (found == 0)
        goto done;
      if (found > 0) {
        if (!big_number_copy(out_x, &x) || !big_number_copy(out_y, &root))
          goto done;
        status = ECPP_FOUND;
        goto done;
      }
    }
    if (!big_number_add_small(&x, 1) || !big_number_divide(NULL, &x, &x, modulus))
      goto done;
  }
  status = ECPP_NOT_FOUND;
done:
  big_number_free(&x);
  big_number_free(&right_side);
  big_number_free(&root);
  return status;
}

// ── curves with a known order ─────────────────────────────────────────────

// result = value mod n, for a small value of either sign.
static int signed_to_mod(big_number *result, int64_t value, const big_number *n) {
  big_number magnitude;
  big_number_init(&magnitude);
  int ok = big_number_set_u64(&magnitude, value < 0 ? (uint64_t)-value : (uint64_t)value) &&
           big_number_divide(NULL, &magnitude, &magnitude, n);
  if (ok && value < 0 && magnitude.limb_count > 0)
    ok = big_number_subtract(result, n, &magnitude);
  else if (ok)
    ok = big_number_copy(result, &magnitude);
  big_number_free(&magnitude);
  return ok;
}

// t and v with t² + |D|v² = 4n, by Cornacchia's algorithm as adapted for 4n
// (Cohen, A Course in Computational Algebraic Number Theory, 1.5.3): start from a
// square root of D with the same parity as D, and run Euclid's algorithm on
// (2n, root) until the remainder is at most √(4n). That remainder is t.
static ecpp_status solve_for_t_and_v(const big_number *n, int64_t discriminant, big_number *t, big_number *v) {
  big_number d_mod, root, a, b, remainder, four_n, limit, rest, divisor, quotient, leftover, check;
  big_number *numbers[] = {&d_mod, &root, &a, &b, &remainder, &four_n, &limit, &rest, &divisor, &quotient, &leftover, &check};
  for (size_t index = 0; index < sizeof numbers / sizeof *numbers; index++)
    big_number_init(numbers[index]);
  ecpp_status status = ECPP_OUT_OF_MEMORY;

  if (!signed_to_mod(&d_mod, discriminant, n))
    goto done;
  int symbol = big_number_jacobi(&d_mod, n);
  if (symbol == -2)
    goto done;
  if (symbol != 1) {
    status = ECPP_NOT_FOUND;
    goto done;
  }
  int found = big_number_square_root_mod(&root, &d_mod, n);
  if (found == 0)
    goto done;
  if (found < 0) {
    status = ECPP_NOT_FOUND;
    goto done;
  }
  // the root's parity must match D's: n − root has the other parity, n being odd
  int d_is_odd = (int)(discriminant & 1);
  if (big_number_is_odd(&root) != d_is_odd && !big_number_subtract(&root, n, &root))
    goto done;

  if (!big_number_shift_left(&a, n, 1) || !big_number_copy(&b, &root) || !big_number_shift_left(&four_n, n, 2) ||
      !big_number_floor_square_root(&limit, &four_n))
    goto done;
  while (big_number_compare(&b, &limit) > 0) {
    if (!big_number_divide(NULL, &remainder, &a, &b) || !big_number_copy(&a, &b) || !big_number_copy(&b, &remainder))
      goto done;
  }

  // v² = (4n − t²) / |D|, which must be an exact division giving a perfect square
  if (!big_number_multiply(&rest, &b, &b) || !big_number_set_u64(&divisor, (uint64_t)-(int64_t)discriminant))
    goto done;
  if (big_number_compare(&rest, &four_n) > 0) {
    status = ECPP_NOT_FOUND;
    goto done;
  }
  if (!big_number_subtract(&rest, &four_n, &rest) || !big_number_divide(&quotient, &leftover, &rest, &divisor) ||
      !big_number_floor_square_root(v, &quotient) || !big_number_multiply(&check, v, v))
    goto done;
  if (leftover.limb_count > 0 || big_number_compare(&check, &quotient) != 0) {
    status = ECPP_NOT_FOUND;
    goto done;
  }
  status = big_number_copy(t, &b) ? ECPP_FOUND : ECPP_OUT_OF_MEMORY;
done:
  for (size_t index = 0; index < sizeof numbers / sizeof *numbers; index++)
    big_number_free(numbers[index]);
  return status;
}

// orders[*count] = n + 1 + trace, and orders[*count + 1] = n + 1 − trace, for a
// trace no larger than n + 1, as every trace here is (Hasse: at most 2√n).
static int add_order_pair(const big_number *n_plus_one, const big_number *trace, big_number orders[], size_t *count) {
  if (!big_number_add(&orders[*count], n_plus_one, trace) || !big_number_subtract(&orders[*count + 1], n_plus_one, trace))
    return 0;
  *count += 2;
  return 1;
}

ecpp_status ecpp_find_orders(const big_number *n, int64_t discriminant, big_number orders[ECPP_MOST_ORDERS], size_t *count) {
  big_number t, v, n_plus_one, three_v, trace;
  big_number_init(&t);
  big_number_init(&v);
  big_number_init(&n_plus_one);
  big_number_init(&three_v);
  big_number_init(&trace);
  *count = 0;
  ecpp_status status = solve_for_t_and_v(n, discriminant, &t, &v);
  if (status != ECPP_FOUND)
    goto done;
  status = ECPP_OUT_OF_MEMORY;
  if (!big_number_copy(&n_plus_one, n) || !big_number_add_small(&n_plus_one, 1) || !add_order_pair(&n_plus_one, &t, orders, count))
    goto done;
  if (discriminant == -4) {
    // 4n = t² + 4v², so n = (t/2)² + v²: the other traces are ±2v
    if (!big_number_shift_left(&trace, &v, 1) || !add_order_pair(&n_plus_one, &trace, orders, count))
      goto done;
  } else if (discriminant == -3) {
    // the other traces are ±(t + 3v)/2 and ±(t − 3v)/2 (t and v have the same parity)
    if (!big_number_copy(&three_v, &v) || !big_number_shift_left(&three_v, &v, 1) || !big_number_add(&three_v, &three_v, &v) ||
        !big_number_add(&trace, &t, &three_v) || !big_number_shift_right(&trace, &trace, 1) ||
        !add_order_pair(&n_plus_one, &trace, orders, count))
      goto done;
    int t_larger = big_number_compare(&t, &three_v) >= 0;
    if (!big_number_subtract(&trace, t_larger ? &t : &three_v, t_larger ? &three_v : &t) ||
        !big_number_shift_right(&trace, &trace, 1) || !add_order_pair(&n_plus_one, &trace, orders, count))
      goto done;
  }
  status = ECPP_FOUND;
done:
  big_number_free(&t);
  big_number_free(&v);
  big_number_free(&n_plus_one);
  big_number_free(&three_v);
  big_number_free(&trace);
  return status;
}

// Points to try on one curve, for when (order / q)·P is the identity: that happens
// with chance about 1/q, so essentially never at these sizes.
#define POINTS_PER_CURVE 8

// Whether this curve has a point of order q: ECPP_FOUND with it in (out_x, out_y),
// or ECPP_NOT_FOUND if q·Q isn't the identity, which means it's the wrong twist.
static ecpp_status point_of_order(const big_number *n, const big_number *a, const big_number *b, const big_number *cofactor,
                                  const big_number *q, big_number *out_x, big_number *out_y) {
  ecpp_curve curve;
  if (!ecpp_curve_init(&curve, n, a, b))
    return ECPP_OUT_OF_MEMORY;
  big_number start, x, y, qx, qy;
  big_number_init(&start);
  big_number_init(&x);
  big_number_init(&y);
  big_number_init(&qx);
  big_number_init(&qy);
  ecpp_status status = ECPP_NOT_FOUND;
  uint64_t next_x = 1;
  for (int attempt = 0; attempt < POINTS_PER_CURVE; attempt++) {
    if (!big_number_set_u64(&start, next_x)) {
      status = ECPP_OUT_OF_MEMORY;
      break;
    }
    status = ecpp_find_point(&curve, &x, &y, &start);
    if (status != ECPP_FOUND)
      break;
    next_x = big_number_to_u64(&x) + 1; // x stays small: about half of all x work
    status = ecpp_multiply(&curve, &qx, &qy, &x, &y, cofactor);
    if (status == ECPP_IDENTITY) {
      status = ECPP_NOT_FOUND;
      continue; // an unlucky point: try another
    }
    if (status != ECPP_FOUND)
      break;
    big_number unused_x, unused_y;
    big_number_init(&unused_x);
    big_number_init(&unused_y);
    ecpp_status order_status = ecpp_multiply(&curve, &unused_x, &unused_y, &qx, &qy, q);
    big_number_free(&unused_x);
    big_number_free(&unused_y);
    if (order_status == ECPP_IDENTITY) {
      status = big_number_copy(out_x, &qx) && big_number_copy(out_y, &qy) ? ECPP_FOUND : ECPP_OUT_OF_MEMORY;
    } else {
      status = order_status == ECPP_FOUND ? ECPP_NOT_FOUND : order_status;
    }
    break;
  }
  big_number_free(&start);
  big_number_free(&x);
  big_number_free(&y);
  big_number_free(&qx);
  big_number_free(&qy);
  ecpp_curve_free(&curve);
  return status;
}

// The curve y² = x³ + 3kc²x + 2kc³, where k = j / (1728 − j) gives the j-invariant
// (j below n), and a non-residue c gives the quadratic twist. ECPP_NOT_FOUND if
// 1728 − j shares a factor with n, which for a prime n means j = 1728: D = −4's.
static ecpp_status curve_from_j(const big_number *n, const big_number *j, const big_number *c, big_number *a, big_number *b) {
  big_number j_mod, denominator, k, c_squared, three, two;
  big_number *numbers[] = {&j_mod, &denominator, &k, &c_squared, &three, &two};
  for (size_t index = 0; index < 6; index++)
    big_number_init(numbers[index]);
  ecpp_status status = ECPP_OUT_OF_MEMORY;
  if (big_number_copy(&j_mod, j) && signed_to_mod(&denominator, 1728, n) &&
      big_number_subtract_mod(&denominator, &denominator, &j_mod, n)) {
    int inverse = big_number_inverse_mod(&denominator, &denominator, n);
    if (inverse < 0)
      status = ECPP_NOT_FOUND;
    else if (inverse == 1 && big_number_multiply(&k, &j_mod, &denominator) && big_number_divide(NULL, &k, &k, n) &&
             big_number_multiply(&c_squared, c, c) && big_number_set_u64(&three, 3) && big_number_set_u64(&two, 2) &&
             big_number_multiply(a, &three, &k) && big_number_multiply(a, a, &c_squared) &&
             big_number_divide(NULL, a, a, n) && big_number_multiply(b, &two, &k) &&
             big_number_multiply(b, b, &c_squared) && big_number_multiply(b, b, c) && big_number_divide(NULL, b, b, n))
      status = ECPP_FOUND;
  }
  for (size_t index = 0; index < 6; index++)
    big_number_free(numbers[index]);
  return status;
}

// Non-residues to look through for a twist. Half of all numbers are, so a prime n
// finds one almost at once; running out just means this D isn't used.
#define NON_RESIDUE_TRIES 1000

// c = the first non-residue of n from 2 up: ECPP_NOT_FOUND if none turned up.
static ecpp_status first_non_residue(const big_number *n, big_number *c) {
  for (uint64_t value = 2; value < NON_RESIDUE_TRIES; value++) {
    if (!big_number_set_u64(c, value))
      return ECPP_OUT_OF_MEMORY;
    int symbol = big_number_jacobi(c, n);
    if (symbol == -2)
      return ECPP_OUT_OF_MEMORY;
    if (symbol == -1)
      return ECPP_FOUND;
  }
  return ECPP_NOT_FOUND;
}

// For D = −3 the curves y² = x³ + b fall into 6 twists, by b's class modulo sixth
// powers; for D = −4, y² = x³ + ax into 4, by a's class modulo fourth powers. Small
// values of b can all miss a twist (mod some N, 2, 3, 5, 7 and 11 lie in only a few
// classes), so the values tried are the powers wᵏ of one w that generates the
// classes: wᵏ for k = 0 … 5 (or 3) is each class exactly once. For a prime N, w
// generates them when it's not a square and (for D = −3) not a cube.
static ecpp_status family_generator(const big_number *n, int64_t discriminant, big_number *w) {
  montgomery_context montgomery;
  if (!montgomery_init(&montgomery, n))
    return ECPP_OUT_OF_MEMORY;
  big_number exponent, power, remainder, three;
  big_number_init(&exponent);
  big_number_init(&power);
  big_number_init(&remainder);
  big_number_init(&three);
  ecpp_status status = ECPP_NOT_FOUND;
  int need_cube_test = discriminant == -3;
  // (n − 1) / 3, for the test of cubes; n ≡ 1 mod 3 whenever D = −3 has orders
  if (!big_number_copy(&exponent, n) || !big_number_subtract_small(&exponent, 1) || !big_number_set_u64(&three, 3) ||
      !big_number_divide(&exponent, &remainder, &exponent, &three)) {
    status = ECPP_OUT_OF_MEMORY;
    goto done;
  }
  if (need_cube_test && remainder.limb_count > 0)
    goto done;
  for (uint64_t value = 2; value < NON_RESIDUE_TRIES; value++) {
    if (!big_number_set_u64(w, value)) {
      status = ECPP_OUT_OF_MEMORY;
      break;
    }
    int symbol = big_number_jacobi(w, n);
    if (symbol == -2) {
      status = ECPP_OUT_OF_MEMORY;
      break;
    }
    if (symbol != -1)
      continue;
    if (!need_cube_test) {
      status = ECPP_FOUND;
      break;
    }
    if (!montgomery_power(&montgomery, &power, w, &exponent)) {
      status = ECPP_OUT_OF_MEMORY;
      break;
    }
    if (big_number_compare_u64(&power, 1) != 0) {
      status = ECPP_FOUND;
      break;
    }
  }
done:
  big_number_free(&exponent);
  big_number_free(&power);
  big_number_free(&remainder);
  big_number_free(&three);
  montgomery_free(&montgomery);
  return status;
}

ecpp_status ecpp_curve_with_order(const big_number *n, int64_t discriminant, const class_polynomial *polynomial,
                                  const big_number *order, const big_number *q, big_number *out_a, big_number *out_b,
                                  big_number *out_x, big_number *out_y) {
  big_number cofactor, leftover, a, b, c, j, w, family_value;
  big_number_init(&j);
  big_number_init(&w);
  big_number_init(&family_value);
  big_number_init(&cofactor);
  big_number_init(&leftover);
  big_number_init(&a);
  big_number_init(&b);
  big_number_init(&c);
  ecpp_status status = ECPP_OUT_OF_MEMORY;
  if (!big_number_divide(&cofactor, &leftover, order, q))
    goto done;
  if (leftover.limb_count > 0) {
    status = ECPP_NOT_FOUND; // q doesn't divide the order
    goto done;
  }

  int special_family = discriminant == -3 || discriminant == -4;
  if (special_family) {
    status = family_generator(n, discriminant, &w);
    if (status != ECPP_FOUND)
      goto done;
  } else {
    // j: a root of H_D mod n, which exists for a prime n that has this D's orders
    if (polynomial == NULL) {
      status = ECPP_NOT_FOUND;
      goto done;
    }
    int found = class_polynomial_root(&j, polynomial, n);
    if (found <= 0) {
      status = found == 0 ? ECPP_OUT_OF_MEMORY : ECPP_NOT_FOUND;
      goto done;
    }
  }
  // the twists to try: every class wᵏ for the two special families; otherwise c = 1,
  // and then the first non-residue c
  int tries = discriminant == -3 ? 6 : discriminant == -4 ? 4 : 2;
  status = ECPP_NOT_FOUND;
  for (int attempt = 1; attempt <= tries && status == ECPP_NOT_FOUND; attempt++) {
    ecpp_status curve_status = ECPP_FOUND;
    if (special_family) {
      // family_value = w^(attempt − 1): 1, w, w², …
      int ok = attempt == 1 ? big_number_set_u64(&family_value, 1)
                            : big_number_multiply(&family_value, &family_value, &w) &&
                                  big_number_divide(NULL, &family_value, &family_value, n);
      if (discriminant == -3)
        ok = ok && big_number_set_u64(&a, 0) && big_number_copy(&b, &family_value);
      else
        ok = ok && big_number_copy(&a, &family_value) && big_number_set_u64(&b, 0);
      if (!ok)
        curve_status = ECPP_OUT_OF_MEMORY;
    } else {
      if (attempt == 1)
        curve_status = big_number_set_u64(&c, 1) ? ECPP_FOUND : ECPP_OUT_OF_MEMORY;
      else
        curve_status = first_non_residue(n, &c);
      if (curve_status == ECPP_FOUND)
        curve_status = curve_from_j(n, &j, &c, &a, &b);
    }
    if (curve_status != ECPP_FOUND) {
      status = curve_status;
      break;
    }
    status = point_of_order(n, &a, &b, &cofactor, q, out_x, out_y);
  }
  if (status == ECPP_FOUND && (!big_number_copy(out_a, &a) || !big_number_copy(out_b, &b)))
    status = ECPP_OUT_OF_MEMORY;
done:
  big_number_free(&j);
  big_number_free(&w);
  big_number_free(&family_value);
  big_number_free(&cofactor);
  big_number_free(&leftover);
  big_number_free(&a);
  big_number_free(&b);
  big_number_free(&c);
  return status;
}
