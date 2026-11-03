// Native tests for wasm/ecpp.c: on small curves, every point and multiple
// against plain affine arithmetic in integers. Large moduli are compared with
// the checker's arithmetic in tests/wasm/ecpp.test.ts.
//
// Run with: npm run test:native

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

#include "../../wasm/ecpp.h"

static int checks_run = 0;
static int checks_failed = 0;

static void expect(int condition, const char *name, uint64_t p, uint64_t a, uint64_t b, uint64_t value) {
  checks_run++;
  if (condition)
    return;
  if (++checks_failed <= 20)
    fprintf(stderr, "FAIL %s: p=%llu a=%llu b=%llu value=%llu\n", name, (unsigned long long)p, (unsigned long long)a,
            (unsigned long long)b, (unsigned long long)value);
}

// ── plain affine arithmetic modulo a small prime ─────────────────────────

typedef struct {
  int64_t x, y;
  int is_identity;
} plain_point;

static int64_t mod_of(int64_t value, int64_t p) { return ((value % p) + p) % p; }

static int64_t inverse_of(int64_t value, int64_t p) {
  int64_t result = 1, power = mod_of(value, p);
  for (int64_t exponent = p - 2; exponent > 0; exponent >>= 1) {
    if (exponent & 1)
      result = result * power % p;
    power = power * power % p;
  }
  return result;
}

static plain_point plain_add(plain_point first, plain_point second, int64_t a, int64_t p) {
  if (first.is_identity)
    return second;
  if (second.is_identity)
    return first;
  if (first.x == second.x && mod_of(first.y + second.y, p) == 0)
    return (plain_point){0, 0, 1};
  int64_t slope = first.x == second.x ? mod_of(3 * first.x * first.x + a, p) * inverse_of(2 * first.y, p) % p
                                      : mod_of(second.y - first.y, p) * inverse_of(second.x - first.x, p) % p;
  int64_t x = mod_of(slope * slope - first.x - second.x, p);
  return (plain_point){x, mod_of(slope * (first.x - x) - first.y, p), 0};
}

// ─────────────────────────────────────────────────────────────────────────

static void set(big_number *number, uint64_t value) {
  if (!big_number_set_u64(number, value))
    exit(1);
}

// Every multiple of every point on y² = x³ + ax + b mod p, up to past its order.
static void check_small_curve(int64_t p, int64_t a, int64_t b) {
  big_number modulus, a_number, b_number, x, y, scalar, out_x, out_y;
  big_number *numbers[] = {&modulus, &a_number, &b_number, &x, &y, &scalar, &out_x, &out_y};
  for (size_t index = 0; index < 8; index++)
    big_number_init(numbers[index]);
  set(&modulus, (uint64_t)p);
  set(&a_number, (uint64_t)a);
  set(&b_number, (uint64_t)b);
  ecpp_curve curve;
  if (!ecpp_curve_init(&curve, &modulus, &a_number, &b_number))
    exit(1);

  int64_t point_count = 1; // the identity
  for (int64_t px = 0; px < p; px++)
    for (int64_t py = 0; py < p; py++)
      if (mod_of(py * py - (px * px % p * px + a * px + b), p) == 0)
        point_count++;

  for (int64_t px = 0; px < p; px++) {
    for (int64_t py = 0; py < p; py++) {
      if (mod_of(py * py - (px * px % p * px + a * px + b), p) != 0)
        continue;
      set(&x, (uint64_t)px);
      set(&y, (uint64_t)py);
      plain_point base = {px, py, 0}, running = {0, 0, 1};
      for (int64_t multiple = 0; multiple <= point_count + 2; multiple++) {
        set(&scalar, (uint64_t)multiple);
        ecpp_status status = ecpp_multiply(&curve, &out_x, &out_y, &x, &y, &scalar);
        if (running.is_identity) {
          expect(status == ECPP_IDENTITY, "multiple is the identity", (uint64_t)p, (uint64_t)a, (uint64_t)b, (uint64_t)multiple);
        } else {
          expect(status == ECPP_FOUND, "multiple is a point", (uint64_t)p, (uint64_t)a, (uint64_t)b, (uint64_t)multiple);
          expect(big_number_to_u64(&out_x) == (uint64_t)running.x && big_number_to_u64(&out_y) == (uint64_t)running.y,
                 "multiple matches affine", (uint64_t)p, (uint64_t)a, (uint64_t)b, (uint64_t)multiple);
        }
        running = plain_add(running, base, a, p);
      }
      // the group's order always takes a point to the identity
      set(&scalar, (uint64_t)point_count);
      expect(ecpp_multiply(&curve, &out_x, &out_y, &x, &y, &scalar) == ECPP_IDENTITY, "the group order gives the identity",
             (uint64_t)p, (uint64_t)a, (uint64_t)b, (uint64_t)point_count);
    }
  }

  // ecpp_find_point gives a real point at or after where it starts
  for (int64_t start = 0; start < p; start += 1 + p / 8) {
    set(&x, (uint64_t)start);
    ecpp_status status = ecpp_find_point(&curve, &out_x, &out_y, &x);
    if (status == ECPP_FOUND) {
      int64_t fx = (int64_t)big_number_to_u64(&out_x), fy = (int64_t)big_number_to_u64(&out_y);
      expect(fy != 0 && mod_of(fy * fy - (fx * fx % p * fx + a * fx + b), p) == 0, "a found point is on the curve",
             (uint64_t)p, (uint64_t)a, (uint64_t)b, (uint64_t)start);
    }
  }

  ecpp_curve_free(&curve);
  for (size_t index = 0; index < 8; index++)
    big_number_free(numbers[index]);
}

int main(void) {
  static const int64_t primes[] = {5, 7, 11, 13, 17, 23, 29, 37, 53};
  for (size_t index = 0; index < sizeof primes / sizeof *primes; index++) {
    int64_t p = primes[index];
    for (int64_t a = 0; a < p; a += 1 + p / 6)
      for (int64_t b = 0; b < p; b += 1 + p / 6)
        if (mod_of(4 * a * a * a + 27 * b * b, p) != 0)
          check_small_curve(p, a, b);
  }

  // A composite modulus must end, and report a shared factor when it meets one:
  // a point's order usually differs modulo each factor, so many multiples are tried.
  static const uint64_t composites[] = {35, 77, 91, 143, 1001, 1000001};
  int not_invertible_seen = 0;
  for (size_t index = 0; index < sizeof composites / sizeof *composites; index++) {
    big_number modulus, a_number, b_number, x, y, scalar, out_x, out_y;
    big_number *numbers[] = {&modulus, &a_number, &b_number, &x, &y, &scalar, &out_x, &out_y};
    for (size_t each = 0; each < 8; each++)
      big_number_init(numbers[each]);
    set(&modulus, composites[index]);
    set(&b_number, 1);
    for (uint64_t a = 1; a < 40; a++) {
      set(&a_number, a);
      ecpp_curve curve;
      if (!ecpp_curve_init(&curve, &modulus, &a_number, &b_number))
        exit(1);
      set(&x, 0);
      set(&y, 1); // (0, 1) is on y² = x³ + ax + 1 for any a
      for (uint64_t multiple = 1; multiple < 200; multiple++) {
        set(&scalar, multiple);
        ecpp_status status = ecpp_multiply(&curve, &out_x, &out_y, &x, &y, &scalar);
        not_invertible_seen += status == ECPP_NOT_INVERTIBLE;
        expect(status != ECPP_OUT_OF_MEMORY && status != ECPP_NOT_FOUND, "a composite modulus ends", composites[index], a, 1, multiple);
      }
      ecpp_curve_free(&curve);
    }
    for (size_t each = 0; each < 8; each++)
      big_number_free(numbers[each]);
  }
  expect(not_invertible_seen > 0, "a composite modulus is noticed, sometimes", 0, 0, 0, 0);

  printf("native ecpp tests: %d checks, %d failed\n", checks_run, checks_failed);
  return checks_failed == 0 ? 0 : 1;
}
