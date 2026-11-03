// Hilbert class polynomials, for ECPP. See classpoly.h.
//
// Reals are fixed point: a sign, and a big_number holding value · 2^precision. The
// numbers vary hugely in size (j is about e^(π√|D| / a)), but fixed point keeps the
// same absolute accuracy for all of them, and absolute accuracy is what rounding
// to an integer needs.
//
// How j is computed. With q = e^(2πiτ) and Δ the modular discriminant,
//
//   j(τ) = (256f + 1)³ / f,  where f = Δ(2τ) / Δ(τ) = q · ∏ (1 + qⁿ)²⁴.
//
// f can be far too small to divide by in fixed point, so 1 / f is written as
// (1 / q) · (1 / ∏ (1 + qⁿ)²⁴), with 1 / q computed directly as its own exponential.

#include "classpoly.h"

#include <stdlib.h>

// Extra bits beyond the estimated size of the largest coefficient, and how close
// to an integer a coefficient must come: within 2^−ROUNDING_BITS.
#define GUARD_BITS 64
#define ROUNDING_BITS 32

// ── fixed-point reals ─────────────────────────────────────────────────────

typedef struct {
  big_number magnitude;
  int negative; // never set on zero
} fixed;

static void fixed_init(fixed *number) {
  big_number_init(&number->magnitude);
  number->negative = 0;
}

static void fixed_free(fixed *number) { big_number_free(&number->magnitude); }

static int fixed_copy(fixed *result, const fixed *number) {
  if (result != number && !big_number_copy(&result->magnitude, &number->magnitude))
    return 0;
  result->negative = number->negative;
  return 1;
}

static int fixed_is_zero(const fixed *number) { return number->magnitude.limb_count == 0; }

// number = 2^precision, which is 1 in fixed point.
static int fixed_set_one(fixed *number, size_t precision) {
  number->negative = 0;
  return big_number_set_u64(&number->magnitude, 1) && big_number_shift_left(&number->magnitude, &number->magnitude, precision);
}

// result = first + second, or first − second when `subtract` is set.
static int fixed_add(fixed *result, const fixed *first, const fixed *second, int subtract) {
  int second_negative = second->negative != subtract;
  if (first->negative == second_negative) {
    int negative = first->negative;
    if (!big_number_add(&result->magnitude, &first->magnitude, &second->magnitude))
      return 0;
    result->negative = negative && result->magnitude.limb_count > 0;
    return 1;
  }
  int first_larger = big_number_compare(&first->magnitude, &second->magnitude) >= 0;
  int negative = first_larger ? first->negative : second_negative;
  if (!big_number_subtract(&result->magnitude, first_larger ? &first->magnitude : &second->magnitude,
                           first_larger ? &second->magnitude : &first->magnitude))
    return 0;
  result->negative = negative && result->magnitude.limb_count > 0;
  return 1;
}

// result = first · second, truncated.
static int fixed_multiply(fixed *result, const fixed *first, const fixed *second, size_t precision) {
  int negative = first->negative != second->negative;
  if (!big_number_multiply(&result->magnitude, &first->magnitude, &second->magnitude) ||
      !big_number_shift_right(&result->magnitude, &result->magnitude, precision))
    return 0;
  result->negative = negative && result->magnitude.limb_count > 0;
  return 1;
}

// result = top / bottom, truncated. bottom isn't zero.
static int fixed_divide(fixed *result, const fixed *top, const fixed *bottom, size_t precision) {
  big_number shifted;
  big_number_init(&shifted);
  int negative = top->negative != bottom->negative;
  int ok = big_number_shift_left(&shifted, &top->magnitude, precision) &&
           big_number_divide(&result->magnitude, NULL, &shifted, &bottom->magnitude);
  big_number_free(&shifted);
  if (ok)
    result->negative = negative && result->magnitude.limb_count > 0;
  return ok;
}

// result = number · factor, for an ordinary small factor above 0.
static int fixed_multiply_small(fixed *result, const fixed *number, uint64_t factor) {
  big_number small;
  big_number_init(&small);
  int negative = number->negative;
  int ok = big_number_set_u64(&small, factor) && big_number_multiply(&result->magnitude, &number->magnitude, &small);
  big_number_free(&small);
  if (ok)
    result->negative = negative;
  return ok;
}

// result = number / divisor, truncated, for an ordinary small divisor above 0.
static int fixed_divide_small(fixed *result, const fixed *number, uint64_t divisor) {
  big_number small;
  big_number_init(&small);
  int negative = number->negative;
  int ok = big_number_set_u64(&small, divisor) && big_number_divide(&result->magnitude, NULL, &number->magnitude, &small);
  big_number_free(&small);
  if (ok)
    result->negative = negative && result->magnitude.limb_count > 0;
  return ok;
}

// ── fixed-point complex numbers ───────────────────────────────────────────

typedef struct {
  fixed real, imaginary;
} complex_number;

static void complex_init(complex_number *number) {
  fixed_init(&number->real);
  fixed_init(&number->imaginary);
}

static void complex_free(complex_number *number) {
  fixed_free(&number->real);
  fixed_free(&number->imaginary);
}

static int complex_copy(complex_number *result, const complex_number *number) {
  return fixed_copy(&result->real, &number->real) && fixed_copy(&result->imaginary, &number->imaginary);
}

static int complex_set_one(complex_number *number, size_t precision) {
  number->imaginary.magnitude.limb_count = 0;
  number->imaginary.negative = 0;
  return fixed_set_one(&number->real, precision);
}

static int complex_add(complex_number *result, const complex_number *first, const complex_number *second, int subtract) {
  return fixed_add(&result->real, &first->real, &second->real, subtract) &&
         fixed_add(&result->imaginary, &first->imaginary, &second->imaginary, subtract);
}

// result = first · second. result may be either input.
static int complex_multiply(complex_number *result, const complex_number *first, const complex_number *second, size_t precision) {
  fixed real_real, imaginary_imaginary, real_imaginary, imaginary_real;
  fixed_init(&real_real);
  fixed_init(&imaginary_imaginary);
  fixed_init(&real_imaginary);
  fixed_init(&imaginary_real);
  int ok = fixed_multiply(&real_real, &first->real, &second->real, precision) &&
           fixed_multiply(&imaginary_imaginary, &first->imaginary, &second->imaginary, precision) &&
           fixed_multiply(&real_imaginary, &first->real, &second->imaginary, precision) &&
           fixed_multiply(&imaginary_real, &first->imaginary, &second->real, precision) &&
           fixed_add(&result->real, &real_real, &imaginary_imaginary, 1) &&
           fixed_add(&result->imaginary, &real_imaginary, &imaginary_real, 0);
  fixed_free(&real_real);
  fixed_free(&imaginary_imaginary);
  fixed_free(&real_imaginary);
  fixed_free(&imaginary_real);
  return ok;
}

// result = 1 / number, which isn't zero: conjugate / |number|².
static int complex_inverse(complex_number *result, const complex_number *number, size_t precision) {
  fixed real_squared, imaginary_squared, size_squared;
  fixed_init(&real_squared);
  fixed_init(&imaginary_squared);
  fixed_init(&size_squared);
  int ok = fixed_multiply(&real_squared, &number->real, &number->real, precision) &&
           fixed_multiply(&imaginary_squared, &number->imaginary, &number->imaginary, precision) &&
           fixed_add(&size_squared, &real_squared, &imaginary_squared, 0);
  if (ok) {
    int imaginary_was_negative = number->imaginary.negative;
    ok = fixed_divide(&result->real, &number->real, &size_squared, precision) &&
         fixed_divide(&result->imaginary, &number->imaginary, &size_squared, precision);
    if (ok)
      result->imaginary.negative = !imaginary_was_negative && !fixed_is_zero(&result->imaginary);
  }
  fixed_free(&real_squared);
  fixed_free(&imaginary_squared);
  fixed_free(&size_squared);
  return ok;
}

// ── π and e^z ─────────────────────────────────────────────────────────────

static uint64_t integer_square_root(uint64_t value) {
  uint64_t root = 0;
  while ((root + 1) * (root + 1) <= value)
    root++;
  return root;
}

// result = result ± multiplier · atan(1 / inverse), by its Taylor series.
static int add_arctangent(fixed *result, uint64_t inverse, uint64_t multiplier, int subtract, size_t precision) {
  fixed power, term;
  fixed_init(&power);
  fixed_init(&term);
  int ok = fixed_set_one(&power, precision) && fixed_multiply_small(&power, &power, multiplier) &&
           fixed_divide_small(&power, &power, inverse);
  int negative_term = subtract;
  for (uint64_t odd = 1; ok && !fixed_is_zero(&power); odd += 2) {
    ok = fixed_divide_small(&term, &power, odd) && fixed_add(result, result, &term, negative_term) &&
         fixed_divide_small(&power, &power, inverse * inverse);
    negative_term = !negative_term;
  }
  fixed_free(&power);
  fixed_free(&term);
  return ok;
}

// result = π, by Machin's formula: π = 16·atan(1/5) − 4·atan(1/239).
static int compute_pi(fixed *result, size_t precision) {
  size_t working = precision + 32;
  result->magnitude.limb_count = 0;
  result->negative = 0;
  int ok = add_arctangent(result, 5, 16, 0, working) && add_arctangent(result, 239, 4, 1, working) &&
           big_number_shift_right(&result->magnitude, &result->magnitude, working - precision);
  return ok;
}

// result = e^z: halve z until it's tiny, sum the Taylor series, and square back.
static int complex_exponential(complex_number *result, const complex_number *z, size_t precision) {
  size_t largest_bits = big_number_bit_length(&z->real.magnitude);
  size_t imaginary_bits = big_number_bit_length(&z->imaginary.magnitude);
  if (imaginary_bits > largest_bits)
    largest_bits = imaginary_bits;
  // halvings: enough to bring z below 1, then about √precision more, which balances
  // the terms of the series against the squarings
  size_t halvings = (largest_bits > precision ? largest_bits - precision : 0) + (size_t)integer_square_root(precision) + 1;
  size_t working = precision + halvings + 32;
  size_t shift = working - precision - halvings;

  complex_number small, term, sum;
  complex_init(&small);
  complex_init(&term);
  complex_init(&sum);
  int ok = big_number_shift_left(&small.real.magnitude, &z->real.magnitude, shift) &&
           big_number_shift_left(&small.imaginary.magnitude, &z->imaginary.magnitude, shift) &&
           complex_set_one(&term, working) && complex_set_one(&sum, working);
  small.real.negative = z->real.negative && !fixed_is_zero(&small.real);
  small.imaginary.negative = z->imaginary.negative && !fixed_is_zero(&small.imaginary);
  for (uint64_t index = 1; ok && (!fixed_is_zero(&term.real) || !fixed_is_zero(&term.imaginary)); index++) {
    ok = complex_multiply(&term, &term, &small, working) && fixed_divide_small(&term.real, &term.real, index) &&
         fixed_divide_small(&term.imaginary, &term.imaginary, index) && complex_add(&sum, &sum, &term, 0);
  }
  for (size_t round = 0; ok && round < halvings; round++)
    ok = complex_multiply(&sum, &sum, &sum, working);
  ok = ok && big_number_shift_right(&result->real.magnitude, &sum.real.magnitude, working - precision) &&
       big_number_shift_right(&result->imaginary.magnitude, &sum.imaginary.magnitude, working - precision);
  if (ok) {
    result->real.negative = sum.real.negative && !fixed_is_zero(&result->real);
    result->imaginary.negative = sum.imaginary.negative && !fixed_is_zero(&result->imaginary);
  }
  complex_free(&small);
  complex_free(&term);
  complex_free(&sum);
  return ok;
}

// ── reduced forms ─────────────────────────────────────────────────────────

int class_discriminant_is_valid(int64_t discriminant) {
  if (discriminant >= 0 || discriminant <= -(INT64_C(1) << 62))
    return 0;
  int64_t remainder = (-discriminant) % 4;
  return remainder == 0 || remainder == 3;
}

static int64_t greatest_common_divisor(int64_t first, int64_t second) {
  first = first < 0 ? -first : first;
  second = second < 0 ? -second : second;
  while (second != 0) {
    int64_t rest = first % second;
    first = second;
    second = rest;
  }
  return first;
}

// Adds a form to a growing array. Returns 0 if memory runs out.
static int push_form(class_form **forms, size_t *count, size_t *capacity, int64_t a, int64_t b, int64_t c) {
  if (*count == *capacity) {
    size_t larger = *capacity == 0 ? 16 : *capacity * 2;
    class_form *grown = realloc(*forms, larger * sizeof **forms);
    if (grown == NULL)
      return 0;
    *forms = grown;
    *capacity = larger;
  }
  (*forms)[(*count)++] = (class_form){a, b, c};
  return 1;
}

// Reduced means |b| ≤ a ≤ c, with b ≥ 0 when |b| = a or a = c. So for each b ≥ 0 of
// the right parity with 3b² ≤ |D|, every a dividing (b² + |D|) / 4 between b and
// its square root gives a form, and the partner with −b unless |b| = a or a = c.
int class_forms(int64_t discriminant, class_form **out_forms, size_t *out_count) {
  int64_t size = -discriminant;
  class_form *forms = NULL;
  size_t count = 0, capacity = 0;
  for (int64_t b = size & 1; 3 * b * b <= size; b += 2) {
    int64_t product = (b * b + size) / 4;
    for (int64_t a = b > 1 ? b : 1; a * a <= product; a++) {
      if (product % a != 0)
        continue;
      int64_t c = product / a;
      if (greatest_common_divisor(greatest_common_divisor(a, b), c) != 1)
        continue;
      if (!push_form(&forms, &count, &capacity, a, b, c) ||
          (0 < b && b < a && a < c && !push_form(&forms, &count, &capacity, a, -b, c))) {
        free(forms);
        return 0;
      }
    }
  }
  *out_forms = forms;
  *out_count = count;
  return 1;
}

// ── j and H_D ─────────────────────────────────────────────────────────────

// result = j(τ) for a form with b ≥ 0, given π and √|D|.
static int j_of_form(complex_number *result, const class_form *form, const fixed *pi, const fixed *root, size_t precision) {
  complex_number exponent, q, one_over_q, power, factor, product, squared, f, base, inverse;
  complex_number *numbers[] = {&exponent, &q, &one_over_q, &power, &factor, &product, &squared, &f, &base, &inverse};
  size_t number_count = sizeof numbers / sizeof *numbers;
  for (size_t index = 0; index < number_count; index++)
    complex_init(numbers[index]);

  // 2πiτ = −z with z = π√|D| / a + iπb / a, so q = e^(−z) and 1 / q = e^z
  int ok = fixed_multiply(&exponent.real, pi, root, precision) &&
           fixed_divide_small(&exponent.real, &exponent.real, (uint64_t)form->a) &&
           (form->b == 0 || (fixed_multiply_small(&exponent.imaginary, pi, (uint64_t)form->b) &&
                             fixed_divide_small(&exponent.imaginary, &exponent.imaginary, (uint64_t)form->a))) &&
           complex_exponential(&one_over_q, &exponent, precision);
  if (ok) {
    exponent.real.negative = !fixed_is_zero(&exponent.real);
    exponent.imaginary.negative = !fixed_is_zero(&exponent.imaginary);
    ok = complex_exponential(&q, &exponent, precision);
  }

  // product = ∏ (1 + qⁿ): the powers vanish below the precision, so this ends
  ok = ok && complex_set_one(&product, precision) && complex_copy(&power, &q);
  while (ok && (!fixed_is_zero(&power.real) || !fixed_is_zero(&power.imaginary))) {
    ok = complex_set_one(&factor, precision) && complex_add(&factor, &factor, &power, 0) &&
         complex_multiply(&product, &product, &factor, precision) && complex_multiply(&power, &power, &q, precision);
  }
  // product²⁴: squared, times itself (³), then squared three times
  ok = ok && complex_multiply(&squared, &product, &product, precision) && complex_multiply(&product, &squared, &product, precision);
  for (int round = 0; ok && round < 3; round++)
    ok = complex_multiply(&product, &product, &product, precision);

  // j = (256f + 1)³ · (1 / q) · (1 / product²⁴)
  ok = ok && complex_multiply(&f, &q, &product, precision) && fixed_multiply_small(&base.real, &f.real, 256) &&
       fixed_multiply_small(&base.imaginary, &f.imaginary, 256) && complex_set_one(&factor, precision) &&
       complex_add(&base, &base, &factor, 0) && complex_inverse(&inverse, &product, precision) &&
       complex_multiply(result, &base, &base, precision) && complex_multiply(result, result, &base, precision) &&
       complex_multiply(result, result, &one_over_q, precision) && complex_multiply(result, result, &inverse, precision);

  for (size_t index = 0; index < number_count; index++)
    complex_free(numbers[index]);
  return ok;
}

// A generous estimate of the bits needed: H_D's largest coefficient is about
// e^(π√|D| Σ 1/a), π / ln 2 is below 5, and multiplying the factors out adds a few
// bits for each. It only sets the starting point: too little is found out and doubled.
static size_t estimated_bits(int64_t discriminant, const class_form *forms, size_t count) {
  uint64_t root = integer_square_root((uint64_t)-discriminant) + 1;
  uint64_t bits = GUARD_BITS;
  for (size_t index = 0; index < count; index++)
    bits += 5 * root / (uint64_t)forms[index].a + 8;
  return (size_t)bits;
}

// Rounds one coefficient of the product. Returns 1, 0 if memory runs out, or -1 if
// it isn't close enough to a real integer, which means more precision is needed.
static int round_coefficient(big_number *out_magnitude, uint8_t *out_negative, const complex_number *value, size_t precision) {
  big_number half, rounded, back, difference;
  big_number_init(&half);
  big_number_init(&rounded);
  big_number_init(&back);
  big_number_init(&difference);
  int result = 0;
  if (big_number_set_u64(&half, 1) && big_number_shift_left(&half, &half, precision - 1) &&
      big_number_add(&rounded, &value->real.magnitude, &half) && big_number_shift_right(&rounded, &rounded, precision) &&
      big_number_shift_left(&back, &rounded, precision)) {
    int back_larger = big_number_compare(&back, &value->real.magnitude) >= 0;
    if (big_number_subtract(&difference, back_larger ? &back : &value->real.magnitude,
                            back_larger ? &value->real.magnitude : &back)) {
      size_t allowed_bits = precision - ROUNDING_BITS;
      if (big_number_bit_length(&difference) > allowed_bits || big_number_bit_length(&value->imaginary.magnitude) > allowed_bits) {
        result = -1;
      } else if (big_number_copy(out_magnitude, &rounded)) {
        *out_negative = value->real.negative && rounded.limb_count > 0;
        result = 1;
      }
    }
  }
  big_number_free(&half);
  big_number_free(&rounded);
  big_number_free(&back);
  big_number_free(&difference);
  return result;
}

// One attempt at a given precision. Returns 1, 0 if memory runs out, or -1 if the
// coefficients didn't round cleanly.
static int build_at_precision(class_polynomial *polynomial, int64_t discriminant, const class_form *forms, size_t count, size_t precision) {
  fixed pi, root;
  fixed_init(&pi);
  fixed_init(&root);
  big_number scaled;
  big_number_init(&scaled);
  complex_number j, product;
  complex_init(&j);
  complex_init(&product);
  complex_number *coefficients = malloc((count + 1) * sizeof *coefficients);
  int result = 0;
  if (coefficients == NULL)
    goto release;
  for (size_t index = 0; index <= count; index++)
    complex_init(&coefficients[index]);

  // √|D| · 2^precision = √(|D| · 2^(2·precision))
  if (!compute_pi(&pi, precision) || !big_number_set_u64(&scaled, (uint64_t)-discriminant) ||
      !big_number_shift_left(&scaled, &scaled, 2 * precision) || !big_number_floor_square_root(&root.magnitude, &scaled) ||
      !complex_set_one(&coefficients[0], precision))
    goto done;

  // multiply out ∏ (x − j), one root at a time, from the top coefficient down
  for (size_t index = 0; index < count; index++) {
    if (forms[index].b >= 0) {
      if (!j_of_form(&j, &forms[index], &pi, &root, precision))
        goto done;
    } else {
      // the partner of the form before it: its j is that j's complex conjugate
      j.imaginary.negative = !j.imaginary.negative && !fixed_is_zero(&j.imaginary);
    }
    if (!complex_copy(&coefficients[index + 1], &coefficients[index]))
      goto done;
    for (size_t power = index; power > 0; power--) {
      if (!complex_multiply(&product, &coefficients[power], &j, precision) ||
          !complex_add(&coefficients[power], &coefficients[power - 1], &product, 1))
        goto done;
    }
    if (!complex_multiply(&product, &coefficients[0], &j, precision))
      goto done;
    product.real.negative = !product.real.negative && !fixed_is_zero(&product.real);
    product.imaginary.negative = !product.imaginary.negative && !fixed_is_zero(&product.imaginary);
    if (!complex_copy(&coefficients[0], &product))
      goto done;
  }

  // the coefficient of x^count is exactly 1, by construction
  result = precision > ROUNDING_BITS ? 1 : -1;
  for (size_t index = 0; index < count && result == 1; index++)
    result = round_coefficient(&polynomial->magnitudes[index], &polynomial->negative[index], &coefficients[index], precision);
done:
  for (size_t index = 0; index <= count; index++)
    complex_free(&coefficients[index]);
  free(coefficients);
release:
  fixed_free(&pi);
  fixed_free(&root);
  big_number_free(&scaled);
  complex_free(&j);
  complex_free(&product);
  return result;
}

void class_polynomial_free(class_polynomial *polynomial) {
  if (polynomial->magnitudes != NULL)
    for (size_t index = 0; index < polynomial->degree; index++)
      big_number_free(&polynomial->magnitudes[index]);
  free(polynomial->magnitudes);
  free(polynomial->negative);
  polynomial->magnitudes = NULL;
  polynomial->negative = NULL;
  polynomial->degree = 0;
}

// start_bits of 0 means the estimate.
static int build_polynomial(class_polynomial *polynomial, int64_t discriminant, size_t start_bits, size_t *out_bits) {
  polynomial->degree = 0;
  polynomial->magnitudes = NULL;
  polynomial->negative = NULL;
  if (!class_discriminant_is_valid(discriminant))
    return -1;
  class_form *forms = NULL;
  size_t count = 0;
  if (!class_forms(discriminant, &forms, &count))
    return 0;
  int result = 0;
  polynomial->magnitudes = malloc(count * sizeof *polynomial->magnitudes);
  polynomial->negative = calloc(count, sizeof *polynomial->negative);
  if (polynomial->magnitudes != NULL && polynomial->negative != NULL) {
    polynomial->degree = count;
    for (size_t index = 0; index < count; index++)
      big_number_init(&polynomial->magnitudes[index]);
    size_t precision = start_bits > 0 ? start_bits : estimated_bits(discriminant, forms, count);
    while ((result = build_at_precision(polynomial, discriminant, forms, count, precision)) == -1)
      precision *= 2;
    if (result == 1 && out_bits != NULL)
      *out_bits = precision;
  }
  free(forms);
  if (result != 1)
    class_polynomial_free(polynomial);
  return result;
}

int class_polynomial_build(class_polynomial *polynomial, int64_t discriminant) {
  return build_polynomial(polynomial, discriminant, 0, NULL);
}

int class_polynomial_build_from(class_polynomial *polynomial, int64_t discriminant, size_t start_bits, size_t *out_bits) {
  return build_polynomial(polynomial, discriminant, start_bits, out_bits);
}
