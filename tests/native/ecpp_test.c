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

// ── curves with a known order ─────────────────────────────────────────────

static int is_small_prime(int64_t value) {
  if (value < 2)
    return 0;
  for (int64_t divisor = 2; divisor * divisor <= value; divisor++)
    if (value % divisor == 0)
      return 0;
  return 1;
}

static int legendre(int64_t value, int64_t p) {
  int64_t result = 1, power = mod_of(value, p);
  for (int64_t exponent = (p - 1) / 2; exponent > 0; exponent >>= 1) {
    if (exponent & 1)
      result = result * power % p;
    power = power * power % p;
  }
  return result == 0 ? 0 : result == 1 ? 1 : -1;
}

// #E(F_p), by Legendre symbols: each x gives 1 + (rhs / p) points, plus infinity.
static int64_t count_points(int64_t a, int64_t b, int64_t p) {
  int64_t count = 1;
  for (int64_t x = 0; x < p; x++) {
    int64_t rhs = mod_of(((x * x % p) * x + a * x + b) % p, p);
    count += 1 + legendre(rhs, p);
  }
  return count;
}

static int64_t largest_prime_factor(int64_t value) {
  int64_t largest = 1;
  for (int64_t divisor = 2; divisor * divisor <= value; divisor++)
    while (value % divisor == 0) {
      largest = divisor;
      value /= divisor;
    }
  return value > 1 ? value : largest;
}

static void check_known_orders(void) {
  big_number orders[ECPP_MOST_ORDERS], n, q, order, out_a, out_b, out_x, out_y;
  big_number *numbers[] = {&n, &q, &order, &out_a, &out_b, &out_x, &out_y};
  for (size_t index = 0; index < ECPP_MOST_ORDERS; index++)
    big_number_init(&orders[index]);
  for (size_t index = 0; index < 7; index++)
    big_number_init(numbers[index]);

  for (int64_t p = 5; p < 6000; p += 2) {
    if (!is_small_prime(p))
      continue;
    set(&n, (uint64_t)p);
    for (int which = 0; which < ECPP_DISCRIMINANT_COUNT; which++) {
      int d = ecpp_discriminants[which];
      size_t count = 0;
      ecpp_status status = ecpp_find_orders(&n, d, orders, &count);
      // class number 1: a solution exists exactly when D is a square mod p
      int d_is_square = legendre(d, p) == 1;
      expect((status == ECPP_FOUND) == d_is_square, "orders exist exactly when D is a square", (uint64_t)p, (uint64_t)-d, 0, 0);
      if (status != ECPP_FOUND)
        continue;
      size_t expected_count = d == -3 ? 6 : d == -4 ? 4 : 2;
      expect(count == expected_count, "how many orders", (uint64_t)p, (uint64_t)-d, 0, count);
      for (size_t index = 0; index < count; index++) {
        int64_t order_value = (int64_t)big_number_to_u64(&orders[index]);
        // Hasse: |p + 1 − order| ≤ 2√p
        int64_t trace = p + 1 - order_value;
        expect(trace * trace <= 4 * p, "orders are within Hasse's bound", (uint64_t)p, (uint64_t)-d, 0, (uint64_t)order_value);
        int64_t q_value = largest_prime_factor(order_value);
        // only when q alone pins the order down, so that the count must match
        if (q_value * q_value <= 16 * p)
          continue;
        set(&q, (uint64_t)q_value);
        status = ecpp_curve_with_order(&n, d, &orders[index], &q, &out_a, &out_b, &out_x, &out_y);
        expect(status == ECPP_FOUND, "a curve is found for every order", (uint64_t)p, (uint64_t)-d, 0, (uint64_t)order_value);
        if (status != ECPP_FOUND)
          continue;
        int64_t a = (int64_t)big_number_to_u64(&out_a), b = (int64_t)big_number_to_u64(&out_b);
        expect(count_points(a, b, p) == order_value, "the curve really has that order, by counting", (uint64_t)p, (uint64_t)a, (uint64_t)b, (uint64_t)order_value);
        int64_t x = (int64_t)big_number_to_u64(&out_x), y = (int64_t)big_number_to_u64(&out_y);
        expect(mod_of(y * y - ((x * x % p) * x + a * x + b), p) == 0, "the point is on the curve", (uint64_t)p, (uint64_t)a, (uint64_t)b, (uint64_t)x);
        plain_point base = {x, y, 0}, running = {0, 0, 1};
        for (int64_t step = 0; step < q_value; step++) {
          running = plain_add(running, base, a, p);
          if (step < q_value - 1 && running.is_identity)
            break;
        }
        expect(running.is_identity, "the point has order q, by adding", (uint64_t)p, (uint64_t)a, (uint64_t)b, (uint64_t)q_value);
      }
    }
  }

  // BPSW's passes are only probably prime, so a composite must end safely too, and
  // whatever it reports must really solve 4n = t² + |D|v². The first order is n + 1 + t.
  for (int64_t composite = 9; composite < 6000; composite += 2) {
    if (is_small_prime(composite))
      continue;
    set(&n, (uint64_t)composite);
    for (int which = 0; which < ECPP_DISCRIMINANT_COUNT; which++) {
      int d = ecpp_discriminants[which];
      size_t count = 0;
      if (ecpp_find_orders(&n, d, orders, &count) != ECPP_FOUND)
        continue;
      int64_t t = (int64_t)big_number_to_u64(&orders[0]) - composite - 1;
      int64_t rest = 4 * composite - t * t;
      int64_t v_squared = rest / -d, v = 0;
      while (v * v < v_squared)
        v++;
      expect(rest % -d == 0 && v * v == v_squared, "a composite's t and v solve the equation", (uint64_t)composite, (uint64_t)-d, (uint64_t)t, (uint64_t)v_squared);
    }
  }

  for (size_t index = 0; index < ECPP_MOST_ORDERS; index++)
    big_number_free(&orders[index]);
  for (size_t index = 0; index < 7; index++)
    big_number_free(numbers[index]);
}

int main(void) {
  check_known_orders();
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
