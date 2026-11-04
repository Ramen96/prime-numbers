// Native tests for wasm/ecpp_prover.c: the shape of every certificate (each step's
// q is the next step's number, q is large enough, the chain ends below a(13)), that
// running in small pieces finds the same certificate as running at once, that a
// tiny effort limit (so the search must back up and double it) still finishes,
// and that a composite is never "done". The independent checker judges the
// certificates themselves in tests/wasm/ecpp_prover.test.ts.
//
// Run with: npm run test:native

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

#include "../../wasm/ecpp_prover.h"
#include "../../wasm/primality.h"

static int checks_run = 0;
static int checks_failed = 0;

static void expect(int condition, const char *name, size_t detail) {
  checks_run++;
  if (condition)
    return;
  if (++checks_failed <= 20)
    printf("FAILED %s (%zu)\n", name, detail);
}

static const uint32_t proven_bound_limbs[] = {0x2410a5fd, 0x51adc5b2, 0x0002be69};

// The first BPSW pass at or after 7 · 10^(digits − 1) + offset.
static void probable_prime_near(big_number *result, int digits, uint64_t offset) {
  big_number ten;
  big_number_init(&ten);
  big_number_set_u64(&ten, 10);
  big_number_set_u64(result, 7);
  for (int index = 1; index < digits; index++)
    big_number_multiply(result, result, &ten);
  big_number_add_small(result, offset | 1);
  while (bpsw(result, NULL) != PRIMALITY_PROBABLE_PRIME)
    big_number_add_small(result, 2);
  big_number_free(&ten);
}

static ecpp_proof_status run_to_end(ecpp_prover *prover, size_t piece) {
  ecpp_proof_status status;
  while ((status = ecpp_prover_run(prover, piece)) == ECPP_PROOF_MORE)
    ;
  return status;
}

static void check_shape(const ecpp_prover *prover, const big_number *candidate, size_t detail) {
  big_number bound, root, power;
  big_number_init(&bound);
  big_number_init(&root);
  big_number_init(&power);
  big_number_set_limbs(&bound, proven_bound_limbs, 3);
  size_t count = ecpp_prover_step_count(prover);
  expect(count > 0 || big_number_compare(candidate, &bound) < 0, "a candidate past a(13) has steps", detail);
  for (size_t index = 0; index < count; index++) {
    const ecpp_certificate_step *step = ecpp_prover_step(prover, index);
    const big_number *expected_number = index == 0 ? candidate : &ecpp_prover_step(prover, index - 1)->order_prime;
    expect(big_number_compare(&step->number, expected_number) == 0, "each step's number is the last step's q", detail);
    expect(big_number_compare(&step->order_prime, &step->number) < 0, "q is below the number", detail);
    big_number_floor_square_root(&root, &step->order_prime);
    big_number_subtract_small(&root, 1);
    big_number_multiply(&power, &root, &root);
    big_number_multiply(&power, &power, &power);
    expect(big_number_compare(&power, &step->number) > 0, "q > (N^¼ + 1)²", detail);
    expect(big_number_compare(&step->curve_a, &step->number) < 0 && big_number_compare(&step->curve_b, &step->number) < 0 &&
               big_number_compare(&step->point_x, &step->number) < 0 && big_number_compare(&step->point_y, &step->number) < 0,
           "curve values are reduced", detail);
  }
  if (count > 0) {
    const big_number *last = &ecpp_prover_step(prover, count - 1)->order_prime;
    expect(big_number_compare(last, &bound) < 0 && miller_rabin(last, NULL) == PRIMALITY_PRIME, "the chain ends at a proven prime below a(13)",
           detail);
  }
  big_number_free(&bound);
  big_number_free(&root);
  big_number_free(&power);
}

static int same_certificate(const ecpp_prover *first, const ecpp_prover *second) {
  if (ecpp_prover_step_count(first) != ecpp_prover_step_count(second))
    return 0;
  for (size_t index = 0; index < ecpp_prover_step_count(first); index++) {
    const ecpp_certificate_step *left = ecpp_prover_step(first, index), *right = ecpp_prover_step(second, index);
    if (big_number_compare(&left->order_prime, &right->order_prime) != 0 || big_number_compare(&left->curve_a, &right->curve_a) != 0 ||
        big_number_compare(&left->curve_b, &right->curve_b) != 0 || big_number_compare(&left->point_x, &right->point_x) != 0 ||
        big_number_compare(&left->point_y, &right->point_y) != 0)
      return 0;
  }
  return 1;
}

int main(void) {
  ecpp_prover whole, pieces, tiny;
  expect(ecpp_prover_init(&whole, 0) && ecpp_prover_init(&pieces, 0) && ecpp_prover_init(&tiny, 1), "provers start", 0);
  big_number candidate;
  big_number_init(&candidate);

  // many primes from 26 to 60 digits, one prover reused for all of them
  for (int digits = 26; digits <= 60; digits += 2) {
    for (uint64_t offset = 0; offset < 3; offset++) {
      probable_prime_near(&candidate, digits, offset * 1000003);
      expect(ecpp_prover_reset(&whole, &candidate), "reset", (size_t)digits);
      expect(run_to_end(&whole, 1u << 30) == ECPP_PROOF_DONE, "proved at once", (size_t)digits);
      check_shape(&whole, &candidate, (size_t)digits);
    }
    // in one-unit pieces: the same certificate
    expect(ecpp_prover_reset(&pieces, &candidate), "reset", (size_t)digits);
    expect(run_to_end(&pieces, 1) == ECPP_PROOF_DONE, "proved in pieces", (size_t)digits);
    expect(same_certificate(&whole, &pieces), "pieces find the same certificate", (size_t)digits);
    // a step may examine 1 discriminant at first: it has to back up and double that
    expect(ecpp_prover_reset(&tiny, &candidate), "reset", (size_t)digits);
    expect(run_to_end(&tiny, 1u << 30) == ECPP_PROOF_DONE, "proved from a tiny effort limit", (size_t)digits);
    check_shape(&tiny, &candidate, (size_t)digits);
  }

  // below a(13): done at once, with no steps
  big_number_set_u64(&candidate, 1000000007);
  expect(ecpp_prover_reset(&whole, &candidate) && ecpp_prover_run(&whole, 1) == ECPP_PROOF_DONE && ecpp_prover_step_count(&whole) == 0,
         "below a(13) there's nothing to do", 0);

  // a composite (a product of two 15-digit primes, past a(13)) is never done: it stays pending
  big_number first, second;
  big_number_init(&first);
  big_number_init(&second);
  probable_prime_near(&first, 15, 0);
  probable_prime_near(&second, 15, 999999);
  big_number_multiply(&candidate, &first, &second);
  expect(ecpp_prover_reset(&whole, &candidate) && ecpp_prover_run(&whole, 200000) == ECPP_PROOF_MORE, "a composite is never done", 0);
  big_number_free(&first);
  big_number_free(&second);

  big_number_free(&candidate);
  ecpp_prover_free(&whole);
  ecpp_prover_free(&pieces);
  ecpp_prover_free(&tiny);
  printf("native ecpp prover tests: %d checks, %d failed\n", checks_run, checks_failed);
  return checks_failed > 0;
}
