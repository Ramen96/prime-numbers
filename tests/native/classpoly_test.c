// Native tests for wasm/classpoly.c: class numbers against an independent count and
// published lists, H_D against published polynomials and every known j-invariant,
// and, at larger D, against brute-force counts of points on curves mod small primes.
//
// Run with: npm run test:native

#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "../../wasm/classpoly.h"

static int checks_run = 0;
static int checks_failed = 0;

static void expect(int condition, const char *name, int64_t d, int64_t value) {
  checks_run++;
  if (condition)
    return;
  if (++checks_failed <= 20)
    printf("FAILED %s: D = %" PRId64 ", value %" PRId64 "\n", name, d, value);
}

// ── class numbers ─────────────────────────────────────────────────────────

static int64_t gcd_of(int64_t first, int64_t second) {
  first = first < 0 ? -first : first;
  second = second < 0 ? -second : second;
  while (second != 0) {
    int64_t rest = first % second;
    first = second;
    second = rest;
  }
  return first;
}

// By trying every (a, b) directly against the definition of reduced.
static size_t count_forms_directly(int64_t d) {
  size_t count = 0;
  for (int64_t a = 1; 3 * a * a <= -d; a++) {
    for (int64_t b = -a + 1; b <= a; b++) {
      int64_t top = b * b - d;
      if (top % (4 * a) != 0)
        continue;
      int64_t c = top / (4 * a);
      if (c < a || (c == a && b < 0))
        continue;
      if (gcd_of(gcd_of(a, b), c) == 1)
        count++;
    }
  }
  return count;
}

static int is_square_free(int64_t value) {
  for (int64_t divisor = 2; divisor * divisor <= value; divisor++)
    if (value % (divisor * divisor) == 0)
      return 0;
  return 1;
}

static int is_fundamental(int64_t size) {
  if (size % 4 == 3)
    return is_square_free(size);
  if (size % 4 == 0)
    return (size / 4) % 4 != 0 && (size / 4) % 4 != 3 && is_square_free(size / 4);
  return 0;
}

static size_t class_number(int64_t d) {
  class_form *forms = NULL;
  size_t count = 0;
  if (!class_forms(d, &forms, &count))
    return 0;
  free(forms);
  return count;
}

static void check_class_numbers(void) {
  for (int64_t size = 3; size < 3000; size++) {
    if (size % 4 == 0 || size % 4 == 3)
      expect(class_number(-size) == count_forms_directly(-size), "class number by direct count", -size, (int64_t)class_number(-size));
  }
  // Every fundamental discriminant of class number 1, 2 and 3 (Heegner, Stark, Baker,
  // Oesterlé); the largest of each is below 1000, so the lists must match exactly.
  static const int64_t h1[] = {3, 4, 7, 8, 11, 19, 43, 67, 163};
  static const int64_t h2[] = {15, 20, 24, 35, 40, 51, 52, 88, 91, 115, 123, 148, 187, 232, 235, 267, 403, 427};
  static const int64_t h3[] = {23, 31, 59, 83, 107, 139, 211, 283, 307, 331, 379, 499, 547, 643, 883, 907};
  size_t found[4] = {0, 0, 0, 0};
  for (int64_t size = 3; size < 1000; size++) {
    if (!is_fundamental(size))
      continue;
    size_t h = class_number(-size);
    if (h > 3)
      continue;
    const int64_t *list = h == 1 ? h1 : h == 2 ? h2 : h3;
    expect(found[h] < (h == 1 ? 9u : h == 2 ? 18u : 16u) && list[found[h]] == size, "the published list of small class numbers", -size, (int64_t)h);
    found[h]++;
  }
  expect(found[1] == 9 && found[2] == 18 && found[3] == 16, "all of the published lists were found", 0, (int64_t)found[3]);
  expect(!class_discriminant_is_valid(0) && !class_discriminant_is_valid(5) && !class_discriminant_is_valid(-5) && !class_discriminant_is_valid(-6),
         "invalid discriminants are refused", 0, 0);
}

// ── known polynomials ─────────────────────────────────────────────────────

static int coefficient_is(const class_polynomial *polynomial, size_t index, int64_t expected) {
  uint64_t size = expected < 0 ? (uint64_t)-expected : (uint64_t)expected;
  return big_number_fits_u64(&polynomial->magnitudes[index]) && big_number_to_u64(&polynomial->magnitudes[index]) == size &&
         polynomial->negative[index] == (expected < 0);
}

static void check_known(int64_t d, size_t degree, const int64_t *coefficients) {
  class_polynomial polynomial;
  expect(class_polynomial_build(&polynomial, d) == 1, "builds", d, 0);
  expect(polynomial.degree == degree, "degree", d, (int64_t)polynomial.degree);
  for (size_t index = 0; index < degree && index < polynomial.degree; index++)
    expect(coefficient_is(&polynomial, index, coefficients[index]), "a published coefficient", d, (int64_t)index);
  class_polynomial_free(&polynomial);
}

static void check_known_polynomials(void) {
  static const int64_t known_one[][2] = {{-3, 0}, {-4, -1728}, {-7, 3375}, {-8, -8000}, {-11, 32768}, {-19, 884736},
                                         {-43, 884736000}, {-67, 147197952000}, {-163, 262537412640768000}};
  for (size_t index = 0; index < 9; index++)
    check_known(known_one[index][0], 1, &known_one[index][1]);
  static const int64_t h15[] = {-121287375, 191025};
  static const int64_t h20[] = {-681472000, -1264000};
  static const int64_t h24[] = {14670139392, -4834944};
  static const int64_t h40[] = {9103145472000, -425692800};
  static const int64_t h23[] = {12771880859375, -5151296875, 3491750};
  static const int64_t h31[] = {1566028350940383, -58682638134, 39491307};
  check_known(-15, 2, h15);
  check_known(-20, 2, h20);
  check_known(-24, 2, h24);
  check_known(-40, 2, h40);
  check_known(-23, 3, h23);
  check_known(-31, 3, h31);

  class_polynomial bad;
  expect(class_polynomial_build(&bad, 5) == -1 && class_polynomial_build(&bad, -5) == -1, "invalid D is refused", 5, 0);
}

// ── against point counts ──────────────────────────────────────────────────

static int64_t power_mod(int64_t base, int64_t exponent, int64_t p) {
  int64_t result = 1;
  base = ((base % p) + p) % p;
  for (; exponent > 0; exponent >>= 1) {
    if (exponent & 1)
      result = result * base % p;
    base = base * base % p;
  }
  return result;
}

static int is_small_prime(int64_t value) {
  if (value < 2)
    return 0;
  for (int64_t divisor = 2; divisor * divisor <= value; divisor++)
    if (value % divisor == 0)
      return 0;
  return 1;
}

// The trace of y² = x³ + ax + b over F_p, by counting points.
static int64_t trace_by_counting(int64_t a, int64_t b, int64_t p) {
  int64_t sum = 0;
  for (int64_t x = 0; x < p; x++) {
    int64_t rhs = (((x * x % p) * x + a * x + b) % p + p) % p;
    if (rhs == 0)
      continue;
    sum += power_mod(rhs, (p - 1) / 2, p) == 1 ? 1 : -1;
  }
  return -sum;
}

// For a prime p with 4p = t² + |D|v², H_D splits completely mod p: it has exactly h
// distinct roots, each the j of a curve whose trace solves that same equation.
static void check_against_counts(int64_t d, int64_t first_prime, int primes_wanted) {
  class_polynomial polynomial;
  expect(class_polynomial_build(&polynomial, d) == 1, "builds", d, 0);
  int primes_used = 0;
  for (int64_t p = first_prime; primes_used < primes_wanted; p += 2) {
    if (!is_small_prime(p))
      continue;
    int solvable = 0;
    for (int64_t v = 1; -d * v * v <= 4 * p && !solvable; v++) {
      int64_t rest = 4 * p + d * v * v, t = 0;
      while (t * t < rest)
        t++;
      solvable = t * t == rest && t != 0;
    }
    if (!solvable)
      continue;
    primes_used++;

    int64_t *reduced = malloc(polynomial.degree * sizeof *reduced);
    for (size_t index = 0; index < polynomial.degree; index++) {
      int64_t value = (int64_t)big_number_mod_small(&polynomial.magnitudes[index], (uint64_t)p);
      reduced[index] = polynomial.negative[index] && value != 0 ? p - value : value;
    }
    size_t roots = 0;
    for (int64_t j = 0; j < p; j++) {
      int64_t value = 1;
      for (size_t index = polynomial.degree; index-- > 0;)
        value = (value * j + reduced[index]) % p;
      if (value != 0)
        continue;
      roots++;
      if (j == 0 || j == 1728 % p)
        continue;
      int64_t k = j * power_mod(((1728 - j) % p + p) % p, p - 2, p) % p;
      int64_t t = trace_by_counting(3 * k % p, 2 * k % p, p);
      int64_t rest = 4 * p - t * t, v = 0;
      if (rest % -d == 0)
        while (v * v < rest / -d)
          v++;
      expect(rest % -d == 0 && v * v == rest / -d, "a root's curve has a trace that solves the equation", d, p);
    }
    expect(roots == polynomial.degree, "H_D splits completely", d, p);
    free(reduced);
  }
  class_polynomial_free(&polynomial);
}

// However low the precision starts, doubling must reach the same polynomial.
static void check_doubling(int64_t d) {
  class_polynomial estimated, doubled;
  size_t bits = 0;
  expect(class_polynomial_build(&estimated, d) == 1 && class_polynomial_build_from(&doubled, d, 8, &bits) == 1, "builds both ways", d, 0);
  expect(bits > 8, "precision doubled", d, (int64_t)bits);
  expect(estimated.degree == doubled.degree, "the same degree", d, (int64_t)doubled.degree);
  for (size_t index = 0; index < estimated.degree; index++)
    expect(big_number_compare(&estimated.magnitudes[index], &doubled.magnitudes[index]) == 0 && estimated.negative[index] == doubled.negative[index],
           "the same coefficient however precision started", d, (int64_t)index);
  class_polynomial_free(&estimated);
  class_polynomial_free(&doubled);
}

int main(void) {
  check_class_numbers();
  check_known_polynomials();
  static const int64_t discriminants[] = {-15, -20, -23, -24, -31, -39, -47, -71, -84, -104, -199, -299, -479, -719, -1555, -5923, -15667};
  for (size_t index = 0; index < sizeof discriminants / sizeof *discriminants; index++)
    check_against_counts(discriminants[index], 1009, 6);
  for (size_t index = 0; index < 9; index++)
    check_doubling(discriminants[index]);
  printf("native classpoly tests: %d checks, %d failed\n", checks_run, checks_failed);
  return checks_failed > 0;
}
