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
