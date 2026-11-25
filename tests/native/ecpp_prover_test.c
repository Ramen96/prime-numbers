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

#include "../../wasm/ecpp.h"
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

int ecpp_prover_test_discriminant_root(ecpp_prover *prover, const big_number *n, int64_t discriminant, big_number *root);
size_t ecpp_prover_test_allow_more_effort(ecpp_prover *prover);

// Fundamental discriminants, as the prover lists them (written again here).
static int is_square_free_size(int64_t value) {
  for (int64_t divisor = 2; divisor * divisor <= value; divisor++)
    if (value % (divisor * divisor) == 0)
      return 0;
  return 1;
}
static int is_fundamental_size(int64_t size) {
  if (size % 4 == 3)
    return is_square_free_size(size);
  if (size % 4 == 0)
    return (size / 4 % 4 == 1 || size / 4 % 4 == 2) && is_square_free_size(size / 4);
  return 0;
}

// Whether a and b give the same orders, in the same order.
static int same_orders(const big_number *a, size_t a_count, const big_number *b, size_t b_count) {
  if (a_count != b_count)
    return 0;
  for (size_t index = 0; index < a_count; index++)
    if (big_number_compare(&a[index], &b[index]) != 0)
      return 0;
  return 1;
}

// The genus check and square roots by multiplication (discriminant_root): for
// primes n, a skipped discriminant never has orders (so skipping loses nothing),
// and a root it gives squares to D mod n and finds exactly the orders the plain
// search finds.
static void check_discriminant_roots(void) {
  ecpp_prover prover;
  expect(ecpp_prover_init(&prover, 0), "a prover starts", 0);
  big_number n, root, square, remainder, d_mod;
  big_number plain[ECPP_MOST_ORDERS], from_root[ECPP_MOST_ORDERS];
  big_number *numbers[] = {&n, &root, &square, &remainder, &d_mod};
  for (size_t index = 0; index < 5; index++)
    big_number_init(numbers[index]);
  for (size_t index = 0; index < ECPP_MOST_ORDERS; index++) {
    big_number_init(&plain[index]);
    big_number_init(&from_root[index]);
  }
  size_t skipped = 0, rooted = 0, with_orders = 0;
  for (int digits = 30; digits <= 60; digits += 15) {
    for (uint64_t offset = 0; offset < 2; offset++) {
      probable_prime_near(&n, digits, offset * 999983);
      for (int64_t size = 3; size < 3000; size++) {
        if (!is_fundamental_size(size))
          continue;
        int64_t d = -size;
        size_t plain_count = 0, root_count = 0;
        ecpp_status plain_status = ecpp_find_orders(&n, d, plain, &plain_count);
        int result = ecpp_prover_test_discriminant_root(&prover, &n, d, &root);
        expect(result >= 0, "no memory trouble", (size_t)size);
        if (result == 0) {
          skipped++;
          expect(plain_status == ECPP_NOT_FOUND, "a skipped discriminant never has orders", (size_t)size);
          continue;
        }
        rooted++;
        // root² ≡ D (mod n)
        big_number_set_u64(&d_mod, (uint64_t)size);
        big_number_subtract(&d_mod, &n, &d_mod);
        big_number_multiply(&square, &root, &root);
        big_number_divide(NULL, &remainder, &square, &n);
        expect(big_number_compare(&remainder, &d_mod) == 0, "the root squares to D mod n", (size_t)size);
        ecpp_status root_status = ecpp_find_orders_from_root(&n, d, &root, from_root, &root_count);
        expect(root_status == plain_status && same_orders(plain, plain_count, from_root, root_count),
               "the root finds exactly the plain search's orders", (size_t)size);
        with_orders += plain_status == ECPP_FOUND;
      }
    }
  }
  // the check is doing something: many skipped, many kept, some with orders
  expect(skipped > 1000 && rooted > 1000 && with_orders > 50, "skips and roots both happen", skipped);
  for (size_t index = 0; index < 5; index++)
    big_number_free(numbers[index]);
  for (size_t index = 0; index < ECPP_MOST_ORDERS; index++) {
    big_number_free(&plain[index]);
    big_number_free(&from_root[index]);
  }
  ecpp_prover_free(&prover);
}

// The effort limit doubles when the search is stuck, but never wraps to 0 (which
// would let no step examine anything) and never gets smaller. Written with SIZE_MAX,
// so it means the same here as in wasm32.
static void check_effort_never_wraps(void) {
  ecpp_prover prover;
  expect(ecpp_prover_init(&prover, 2048), "a prover starts", 0);
  for (size_t expected = 4096; expected <= 2048u * 1024; expected *= 2)
    expect(ecpp_prover_test_allow_more_effort(&prover) == expected, "the effort limit doubles", expected);
  ecpp_prover_free(&prover);

  expect(ecpp_prover_init(&prover, SIZE_MAX / 4 + 1), "a prover starts", 0);
  size_t top = SIZE_MAX / 2 + 1;
  expect(ecpp_prover_test_allow_more_effort(&prover) == top, "the effort limit doubles to the top", top);
  for (int call = 0; call < 100; call++) {
    size_t limit = ecpp_prover_test_allow_more_effort(&prover);
    expect(limit == top, "the effort limit stays at the top, never wrapping to 0", limit);
  }
  ecpp_prover_free(&prover);
}

// ── external stripping (step 11b) ─────────────────────────────────────────
//
// Stand-in strippers answer the prover's requests the way the GPU will: exactly
// (trial division to built-in stripping's bound, so certificates must match
// built-in stripping's exactly), lying (adding factors that don't divide), or
// partly (only primes below 100, as a GPU missing most factors would).

typedef enum { STAND_IN_EXACT, STAND_IN_LYING, STAND_IN_PARTIAL } stand_in;

#define STAND_IN_BOUND 100000 // built-in stripping's bound below 830 bits (every candidate here)
static uint32_t stand_in_primes[9592];
static size_t stand_in_prime_count = 0;

static void build_stand_in_primes(void) {
  static unsigned char composite[STAND_IN_BOUND];
  for (uint32_t value = 2; value < STAND_IN_BOUND; value++) {
    if (composite[value])
      continue;
    stand_in_primes[stand_in_prime_count++] = value;
    for (uint64_t multiple = (uint64_t)value * value; multiple < STAND_IN_BOUND; multiple += value)
      composite[multiple] = 1;
  }
}

// Answers every request handed out, `times` times over (2: a batch sent again after a pause).
static void answer_requests(ecpp_prover *prover, stand_in kind, int times) {
  size_t count = ecpp_prover_strip_request_count(prover);
  expect(count > 0, "a waiting prover has requests out", 0);
  for (int round = 0; round < times; round++)
    for (size_t index = 0; index < count; index++) {
      const big_number *order = ecpp_prover_strip_request(prover, index);
      uint32_t bound = kind == STAND_IN_PARTIAL ? 100 : STAND_IN_BOUND;
      uint32_t not_a_factor = 0;
      for (size_t prime = 0; prime < stand_in_prime_count && stand_in_primes[prime] < bound; prime++) {
        if (big_number_mod_small(order, stand_in_primes[prime]) == 0)
          expect(ecpp_prover_report_factor(prover, index, stand_in_primes[prime]), "report a factor", index);
        else if (not_a_factor == 0)
          not_a_factor = stand_in_primes[prime];
      }
      if (kind == STAND_IN_LYING) {
        ecpp_prover_report_factor(prover, index, 0);
        ecpp_prover_report_factor(prover, index, 1);
        ecpp_prover_report_factor(prover, index, not_a_factor);
        ecpp_prover_report_factor(prover, index + 1000000, 2); // no such request
      }
    }
  ecpp_prover_stripping_done(prover);
  expect(ecpp_prover_strip_request_count(prover) == 0, "nothing is out once stripped", 0);
}

// Runs a proof to the end with external stripping. switch_at: hand out that many
// batches, then switch to built-in stripping with the last one still out (0: never).
// Gives up (ECPP_PROOF_MORE) after far more work than any such proof here needs,
// so a stripper that breaks the search fails the test instead of hanging it. A
// stripper missing most factors needs many more curves, so more work.
#define EXTERNAL_RUN_CALLS 500
#define PARTIAL_RUN_CALLS 50000
// Also checks, every call, that the prover reports the work it used, that it works
// nothing ahead while a batch is out (the run after a hand-out waits at once), and
// that only numbers of at least `from_bits` bits hand out batches.
static ecpp_proof_status run_external(ecpp_prover *prover, stand_in kind, int times, int switch_at, size_t *batches) {
  *batches = 0;
  size_t budget = kind == STAND_IN_PARTIAL ? PARTIAL_RUN_CALLS : EXTERNAL_RUN_CALLS;
  int batch_out = 0;
  for (size_t calls = 0; calls < budget; calls++) {
    ecpp_proof_status status = ecpp_prover_run(prover, 1000);
    expect(prover->work_done <= 1000, "a run uses no more than its work", prover->work_done);
    if (status == ECPP_PROOF_MORE) {
      expect(prover->work_done == 1000, "a run that goes on used all its work", prover->work_done);
      expect(!batch_out, "nothing is worked ahead while a batch is out", calls);
      continue;
    }
    if (status == ECPP_PROOF_NEEDS_STRIPPING) {
      expect(ecpp_prover_current_bit_length(prover) >= prover->external_from_bits, "only numbers from from_bits hand out batches",
             ecpp_prover_current_bit_length(prover));
      batch_out = 1;
      if (++*batches == (size_t)switch_at) {
        ecpp_prover_set_external_stripping(prover, 0, 0);
        batch_out = 0;
      }
      continue; // the next run waits for it
    }
    if (status == ECPP_PROOF_WAITING) {
      expect(prover->work_done == 0, "a waiting prover does nothing", prover->work_done);
      answer_requests(prover, kind, times);
      batch_out = 0;
      continue;
    }
    return status;
  }
  return ECPP_PROOF_MORE;
}

static void check_external_stripping(void) {
  build_stand_in_primes();
  ecpp_prover built_in, external;
  expect(ecpp_prover_init(&built_in, 0) && ecpp_prover_init(&external, 0), "provers start", 0);
  big_number candidate;
  big_number_init(&candidate);
  size_t total_batches = 0;
  for (int digits = 30; digits <= 120; digits += 10) {
    for (uint64_t offset = 0; offset < 2; offset++) {
      size_t detail = (size_t)digits * 10 + offset, batches;
      probable_prime_near(&candidate, digits, offset * 7000003);
      expect(ecpp_prover_reset(&built_in, &candidate) && run_to_end(&built_in, 1u << 30) == ECPP_PROOF_DONE, "built in", detail);

      // exactly: the same certificate as built in, a batch of 1 or 4 discriminants
      for (size_t per_batch = 1; per_batch <= 4; per_batch += 3) {
        ecpp_prover_set_external_stripping(&external, per_batch, 0);
        expect(ecpp_prover_reset(&external, &candidate) && run_external(&external, STAND_IN_EXACT, 1, 0, &batches) == ECPP_PROOF_DONE,
               "external, exact", detail);
        expect(same_certificate(&built_in, &external), "exact external stripping finds built-in's certificate", detail);
        total_batches += batches;
      }
      // a batch reported twice (sent again after a pause): the same, nothing rejected
      size_t rejected = ecpp_prover_rejected_claims(&external);
      expect(ecpp_prover_reset(&external, &candidate) && run_external(&external, STAND_IN_EXACT, 2, 0, &batches) == ECPP_PROOF_DONE,
             "external, reported twice", detail);
      expect(same_certificate(&built_in, &external), "a batch reported twice changes nothing", detail);
      expect(ecpp_prover_rejected_claims(&external) == rejected, "a factor reported twice isn't rejected", detail);
      // lying: every false claim rejected and counted, and still built-in's certificate
      expect(ecpp_prover_reset(&external, &candidate) && run_external(&external, STAND_IN_LYING, 1, 0, &batches) == ECPP_PROOF_DONE,
             "external, lying", detail);
      expect(same_certificate(&built_in, &external), "false factors change nothing", detail);
      expect(ecpp_prover_rejected_claims(&external) > rejected, "false factors are counted", detail);
      // switching to built in with a batch out: finishes, with built-in's certificate
      expect(ecpp_prover_reset(&external, &candidate) && run_external(&external, STAND_IN_EXACT, 1, 2, &batches) == ECPP_PROOF_DONE,
             "switched to built in", detail);
      expect(same_certificate(&built_in, &external), "switching to built in mid-batch changes nothing", detail);
      ecpp_prover_set_external_stripping(&external, 4, 0);
      // only numbers from a size hand out batches: the rest strip here; the same certificate
      for (size_t from_bits = 120; from_bits <= 4000; from_bits = from_bits == 120 ? 4000 : 8000) {
        ecpp_prover_set_external_stripping(&external, 4, from_bits);
        expect(ecpp_prover_reset(&external, &candidate) && run_external(&external, STAND_IN_EXACT, 1, 0, &batches) == ECPP_PROOF_DONE,
               "external from a size", detail);
        expect(same_certificate(&built_in, &external), "a size threshold changes nothing", detail);
        if (from_bits == 4000)
          expect(batches == 0, "nothing below the threshold is handed out", batches);
      }
      ecpp_prover_set_external_stripping(&external, 4, 0);
      // partly (most factors missed): slower, but done, and a valid chain
      expect(ecpp_prover_reset(&external, &candidate) && run_external(&external, STAND_IN_PARTIAL, 1, 0, &batches) == ECPP_PROOF_DONE,
             "external, partial", detail);
      check_shape(&external, &candidate, detail);
    }
  }
  expect(total_batches > 100, "the external runs handed out batches", total_batches);
  big_number_free(&candidate);
  ecpp_prover_free(&built_in);
  ecpp_prover_free(&external);
}

int main(void) {
  setvbuf(stdout, NULL, _IONBF, 0); // so a failure shows even if a run is stopped
  check_external_stripping();
  check_discriminant_roots();
  check_effort_never_wraps();
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
