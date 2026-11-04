// The ECPP prover. See ecpp_prover.h.

#include "ecpp_prover.h"

#include <stdlib.h>
#include <string.h>

#include "ecpp.h"
#include "primality.h"

// Default for how many discriminants one step may examine before giving way to
// its parent. At 200 digits a step needs about 500 (measured in step 2c), and the
// limit doubles whenever the whole search is stuck, so this only sets the start.
#define DEFAULT_EFFORT_LIMIT 2048

// How many options a step gathers before descending into the one with the
// smallest q. More options cost more discriminants up front; a smaller q makes
// the rest of the chain shorter.
#define OPTIONS_WANTED 4

// Small factors stripped from each curve order, by trial division with the primes
// below this. What's left must be prime for the order to be usable.
#define STRIP_BOUND 100000

// The first band of discriminants is |D| below this; each band after it is twice
// as wide as the one before.
#define FIRST_BAND_END 4096

// a(13) = 3,317,044,064,679,887,385,961,981 (OEIS A014233): below it, Miller–Rabin
// with the first 13 prime bases proves primality, so the chain may end there.
static const uint32_t proven_bound_limbs[] = {0x2410a5fd, 0x51adc5b2, 0x0002be69};

// One number in the chain, with the options found for it so far.
typedef struct {
  big_number q, order;
  int64_t discriminant;
  int tried;
} proof_option;

struct ecpp_proof_node {
  big_number n;
  proof_option *options;
  size_t option_count, option_capacity;
  size_t next_discriminant; // index into prover->discriminants
  size_t discriminants_examined;
  // the curve for the option this node is descending into
  big_number curve_a, curve_b, point_x, point_y;
  size_t chosen_option;
};

// ── tables ────────────────────────────────────────────────────────────────

static int build_small_primes(ecpp_prover *prover) {
  uint8_t *composite = calloc(STRIP_BOUND, 1);
  if (composite == NULL)
    return 0;
  size_t count = 0;
  for (size_t value = 2; value < STRIP_BOUND; value++)
    if (!composite[value]) {
      count++;
      for (size_t multiple = value * value; multiple < STRIP_BOUND; multiple += value)
        composite[multiple] = 1;
    }
  prover->small_primes = malloc(count * sizeof *prover->small_primes);
  if (prover->small_primes != NULL) {
    prover->small_prime_count = 0;
    for (size_t value = 2; value < STRIP_BOUND; value++)
      if (!composite[value])
        prover->small_primes[prover->small_prime_count++] = (uint32_t)value;
  }
  free(composite);
  return prover->small_primes != NULL;
}

static int is_square_free(int64_t value) {
  for (int64_t divisor = 2; divisor * divisor <= value; divisor++)
    if (value % (divisor * divisor) == 0)
      return 0;
  return 1;
}

// Fundamental discriminants: −d with d ≡ 3 mod 4 square-free, or d = 4m with
// m ≡ 1 or 2 mod 4 square-free. Others give the same orders as a fundamental one.
static int is_fundamental(int64_t size) {
  if (size % 4 == 3)
    return is_square_free(size);
  if (size % 4 == 0) {
    int64_t quarter = size / 4;
    return (quarter % 4 == 1 || quarter % 4 == 2) && is_square_free(quarter);
  }
  return 0;
}

static int compare_discriminants(const void *first, const void *second) {
  const ecpp_discriminant *left = first, *right = second;
  if (left->class_number != right->class_number)
    return left->class_number < right->class_number ? -1 : 1;
  // smaller |D| first: smaller polynomial coefficients
  return left->discriminant > right->discriminant ? -1 : left->discriminant < right->discriminant;
}

// Adds the next band of discriminants, sorted by class number. |D| is int64_t,
// which a band can't reach: listing one band's forms takes about |D|² / 2 steps,
// so |D| near 2^62 would be about 10^37 steps away.
static int add_band(ecpp_prover *prover) {
  int64_t start = prover->next_band_start, end = start < FIRST_BAND_END ? FIRST_BAND_END : 2 * start;
  size_t first_new = prover->discriminant_count;
  for (int64_t size = start; size < end; size++) {
    if (!is_fundamental(size))
      continue;
    class_form *forms = NULL;
    size_t class_number = 0;
    if (!class_forms(-size, &forms, &class_number))
      return 0;
    free(forms);
    if (prover->discriminant_count == prover->discriminant_capacity) {
      size_t larger = prover->discriminant_capacity == 0 ? 1024 : 2 * prover->discriminant_capacity;
      ecpp_discriminant *grown = realloc(prover->discriminants, larger * sizeof *grown);
      if (grown == NULL) {
        prover->discriminant_count = first_new; // the band is redone next time
        return 0;
      }
      prover->discriminants = grown;
      prover->discriminant_capacity = larger;
    }
    prover->discriminants[prover->discriminant_count++] = (ecpp_discriminant){-size, class_number};
  }
  qsort(prover->discriminants + first_new, prover->discriminant_count - first_new, sizeof *prover->discriminants,
        compare_discriminants);
  prover->next_band_start = end;
  return 1;
}

// H_D, built the first time it's needed and kept. NULL if memory runs out.
static const class_polynomial *polynomial_for(ecpp_prover *prover, int64_t discriminant) {
  for (size_t index = 0; index < prover->polynomial_count; index++)
    if (prover->polynomials[index].discriminant == discriminant)
      return &prover->polynomials[index].polynomial;
  if (prover->polynomial_count == prover->polynomial_capacity) {
    size_t larger = prover->polynomial_capacity == 0 ? 64 : 2 * prover->polynomial_capacity;
    ecpp_cached_polynomial *grown = realloc(prover->polynomials, larger * sizeof *grown);
    if (grown == NULL)
      return NULL;
    prover->polynomials = grown;
    prover->polynomial_capacity = larger;
  }
  ecpp_cached_polynomial *entry = &prover->polynomials[prover->polynomial_count];
  if (class_polynomial_build(&entry->polynomial, discriminant) != 1)
    return NULL;
  entry->discriminant = discriminant;
  prover->polynomial_count++;
  return &entry->polynomial;
}

// ── nodes ─────────────────────────────────────────────────────────────────

static void node_free(ecpp_proof_node *node) {
  big_number_free(&node->n);
  for (size_t index = 0; index < node->option_count; index++) {
    big_number_free(&node->options[index].q);
    big_number_free(&node->options[index].order);
  }
  free(node->options);
  big_number_free(&node->curve_a);
  big_number_free(&node->curve_b);
  big_number_free(&node->point_x);
  big_number_free(&node->point_y);
}

// Pushes a node for n onto the chain. Returns 1, or 0 if memory runs out.
static int push_node(ecpp_prover *prover, const big_number *n) {
  if (prover->depth == prover->node_capacity) {
    size_t larger = prover->node_capacity == 0 ? 64 : 2 * prover->node_capacity;
    ecpp_proof_node *grown = realloc(prover->nodes, larger * sizeof *grown);
    if (grown == NULL)
      return 0;
    prover->nodes = grown;
    prover->node_capacity = larger;
  }
  ecpp_proof_node *node = &prover->nodes[prover->depth];
  memset(node, 0, sizeof *node);
  big_number_init(&node->n);
  big_number_init(&node->curve_a);
  big_number_init(&node->curve_b);
  big_number_init(&node->point_x);
  big_number_init(&node->point_y);
  if (!big_number_copy(&node->n, n)) {
    node_free(node);
    return 0;
  }
  prover->depth++;
  return 1;
}

static void pop_node(ecpp_prover *prover) { node_free(&prover->nodes[--prover->depth]); }

static size_t untried_options(const ecpp_proof_node *node) {
  size_t count = 0;
  for (size_t index = 0; index < node->option_count; index++)
    count += !node->options[index].tried;
  return count;
}

// ── one discriminant ──────────────────────────────────────────────────────

// Divides out every small prime factor of value.
static int strip_small_factors(ecpp_prover *prover, big_number *value) {
  big_number divisor;
  big_number_init(&divisor);
  int ok = 1;
  for (size_t index = 0; ok && index < prover->small_prime_count; index++) {
    uint32_t prime = prover->small_primes[index];
    if (big_number_compare_u64(value, prime) <= 0)
      break;
    if (big_number_mod_small(value, prime) != 0)
      continue;
    ok = big_number_set_u64(&divisor, prime);
    while (ok && big_number_compare_u64(value, prime) > 0 && big_number_mod_small(value, prime) == 0)
      ok = big_number_divide(value, NULL, value, &divisor);
  }
  big_number_free(&divisor);
  return ok;
}

// Whether q > (n^¼ + 1)², as the checker decides it: (floor(√q) − 1)⁴ > n.
// -1 if memory runs out.
static int order_is_large_enough(const big_number *q, const big_number *n) {
  big_number root, power;
  big_number_init(&root);
  big_number_init(&power);
  int result = -1;
  if (big_number_floor_square_root(&root, q)) {
    if (big_number_compare_u64(&root, 1) <= 0)
      result = 0;
    else if (big_number_subtract_small(&root, 1) && big_number_multiply(&power, &root, &root) &&
             big_number_multiply(&power, &power, &power))
      result = big_number_compare(&power, n) > 0;
  }
  big_number_free(&root);
  big_number_free(&power);
  return result;
}

// Whether q can be the next number: proven prime below a(13), or a BPSW pass above.
// -1 if memory runs out.
static int is_usable_prime(const big_number *q, const big_number *proven_bound) {
  primality_verdict verdict = big_number_compare(q, proven_bound) < 0 ? miller_rabin(q, NULL) : bpsw(q, NULL);
  if (verdict == PRIMALITY_OUT_OF_MEMORY)
    return -1;
  return verdict == PRIMALITY_PRIME || verdict == PRIMALITY_PROBABLE_PRIME;
}

// Examines the node's next discriminant, adding an option for each usable order.
// Returns 1, or 0 if memory runs out (the node can try the same one again).
static int examine_next_discriminant(ecpp_prover *prover, ecpp_proof_node *node, const big_number *proven_bound) {
  while (node->next_discriminant >= prover->discriminant_count)
    if (!add_band(prover))
      return 0;
  int64_t discriminant = prover->discriminants[node->next_discriminant].discriminant;
  big_number orders[ECPP_MOST_ORDERS], q;
  for (size_t index = 0; index < ECPP_MOST_ORDERS; index++)
    big_number_init(&orders[index]);
  big_number_init(&q);
  size_t count = 0;
  int ok = 1;
  ecpp_status status = ecpp_find_orders(&node->n, discriminant, orders, &count);
  if (status == ECPP_OUT_OF_MEMORY)
    ok = 0;
  for (size_t index = 0; ok && status == ECPP_FOUND && index < count; index++) {
    if (!big_number_copy(&q, &orders[index]) || !strip_small_factors(prover, &q)) {
      ok = 0;
      break;
    }
    if (big_number_compare(&q, &node->n) >= 0)
      continue;
    int large = order_is_large_enough(&q, &node->n);
    int prime = large == 1 ? is_usable_prime(&q, proven_bound) : 0;
    if (large < 0 || prime < 0) {
      ok = 0;
      break;
    }
    if (!prime)
      continue;
    if (node->option_count == node->option_capacity) {
      size_t larger = node->option_capacity == 0 ? 8 : 2 * node->option_capacity;
      proof_option *grown = realloc(node->options, larger * sizeof *grown);
      if (grown == NULL) {
        ok = 0;
        break;
      }
      node->options = grown;
      node->option_capacity = larger;
    }
    proof_option *option = &node->options[node->option_count];
    big_number_init(&option->q);
    big_number_init(&option->order);
    option->discriminant = discriminant;
    option->tried = 0;
    if (!big_number_copy(&option->q, &q) || !big_number_copy(&option->order, &orders[index])) {
      big_number_free(&option->q);
      big_number_free(&option->order);
      ok = 0;
      break;
    }
    node->option_count++;
  }
  if (ok) {
    node->next_discriminant++;
    node->discriminants_examined++;
  }
  for (size_t index = 0; index < ECPP_MOST_ORDERS; index++)
    big_number_free(&orders[index]);
  big_number_free(&q);
  return ok;
}

// ── the search ────────────────────────────────────────────────────────────

void ecpp_prover_free(ecpp_prover *prover) {
  while (prover->depth > 0)
    pop_node(prover);
  free(prover->nodes);
  for (size_t index = 0; index < prover->step_count; index++) {
    ecpp_certificate_step *step = &prover->steps[index];
    big_number *values[] = {&step->number, &step->curve_a, &step->curve_b, &step->point_x, &step->point_y, &step->order_prime};
    for (size_t value = 0; value < 6; value++)
      big_number_free(values[value]);
  }
  free(prover->steps);
  for (size_t index = 0; index < prover->polynomial_count; index++)
    class_polynomial_free(&prover->polynomials[index].polynomial);
  free(prover->polynomials);
  free(prover->discriminants);
  free(prover->small_primes);
  memset(prover, 0, sizeof *prover);
}

int ecpp_prover_init(ecpp_prover *prover, size_t effort_limit) {
  memset(prover, 0, sizeof *prover);
  prover->next_band_start = 3;
  prover->initial_effort_limit = effort_limit > 0 ? effort_limit : DEFAULT_EFFORT_LIMIT;
  prover->effort_limit = prover->initial_effort_limit;
  if (!build_small_primes(prover)) {
    ecpp_prover_free(prover);
    return 0;
  }
  return 1;
}

// Forgets the last search and certificate, keeping the tables.
static void clear_search(ecpp_prover *prover) {
  while (prover->depth > 0)
    pop_node(prover);
  for (size_t index = 0; index < prover->step_count; index++) {
    ecpp_certificate_step *step = &prover->steps[index];
    big_number *values[] = {&step->number, &step->curve_a, &step->curve_b, &step->point_x, &step->point_y, &step->order_prime};
    for (size_t value = 0; value < 6; value++)
      big_number_free(values[value]);
  }
  free(prover->steps);
  prover->steps = NULL;
  prover->step_count = 0;
  prover->effort_limit = prover->initial_effort_limit;
}

int ecpp_prover_reset(ecpp_prover *prover, const big_number *candidate) {
  clear_search(prover);
  return push_node(prover, candidate);
}

// Copies the chain into steps: one step for every node but the last.
static int collect_steps(ecpp_prover *prover) {
  size_t count = prover->depth - 1;
  prover->steps = count > 0 ? calloc(count, sizeof *prover->steps) : NULL;
  if (count > 0 && prover->steps == NULL)
    return 0;
  for (size_t index = 0; index < count; index++) {
    ecpp_certificate_step *step = &prover->steps[index];
    big_number *values[] = {&step->number, &step->curve_a, &step->curve_b, &step->point_x, &step->point_y, &step->order_prime};
    for (size_t value = 0; value < 6; value++)
      big_number_init(values[value]);
  }
  prover->step_count = count;
  for (size_t index = 0; index < count; index++) {
    const ecpp_proof_node *node = &prover->nodes[index];
    ecpp_certificate_step *step = &prover->steps[index];
    if (!big_number_copy(&step->number, &node->n) || !big_number_copy(&step->curve_a, &node->curve_a) ||
        !big_number_copy(&step->curve_b, &node->curve_b) || !big_number_copy(&step->point_x, &node->point_x) ||
        !big_number_copy(&step->point_y, &node->point_y) ||
        !big_number_copy(&step->order_prime, &node->options[node->chosen_option].q))
      return 0;
  }
  return 1;
}

// Tries the node's untried option with the smallest q: builds its curve, and on
// success pushes q. Returns 1 (whether the curve was found or not), or 0 if memory
// runs out.
static int descend(ecpp_prover *prover, ecpp_proof_node *node) {
  size_t best = node->option_count;
  for (size_t index = 0; index < node->option_count; index++)
    if (!node->options[index].tried && (best == node->option_count || big_number_compare(&node->options[index].q, &node->options[best].q) < 0))
      best = index;
  proof_option *option = &node->options[best];
  const class_polynomial *polynomial = NULL;
  if (option->discriminant < -4 && (polynomial = polynomial_for(prover, option->discriminant)) == NULL)
    return 0;
  ecpp_status status = ecpp_curve_with_order(&node->n, option->discriminant, polynomial, &option->order, &option->q, &node->curve_a,
                                             &node->curve_b, &node->point_x, &node->point_y);
  if (status == ECPP_OUT_OF_MEMORY)
    return 0;
  option->tried = 1;
  if (status != ECPP_FOUND)
    return 1; // not usable after all (for a composite n, a factor may be the reason)
  node->chosen_option = best;
  // push_node may move the nodes, so `node` isn't used after it
  return push_node(prover, &option->q);
}

ecpp_proof_status ecpp_prover_run(ecpp_prover *prover, size_t work) {
  if (prover->step_count > 0 || prover->depth == 0)
    return ECPP_PROOF_DONE;
  big_number proven_bound;
  big_number_init(&proven_bound);
  if (!big_number_set_limbs(&proven_bound, proven_bound_limbs, 3))
    return ECPP_PROOF_OUT_OF_MEMORY;
  ecpp_proof_status status = ECPP_PROOF_MORE;
  for (size_t done = 0; done < work; done++) {
    ecpp_proof_node *node = &prover->nodes[prover->depth - 1];
    if (big_number_compare(&node->n, &proven_bound) < 0) {
      status = collect_steps(prover) ? ECPP_PROOF_DONE : ECPP_PROOF_OUT_OF_MEMORY;
      break;
    }
    int ok;
    size_t untried = untried_options(node);
    if (untried < OPTIONS_WANTED && node->discriminants_examined < prover->effort_limit) {
      ok = examine_next_discriminant(prover, node, &proven_bound);
    } else if (untried > 0) {
      ok = descend(prover, node);
    } else if (prover->depth > 1) {
      // stuck: give way to the parent's next option
      pop_node(prover);
      ok = 1;
    } else {
      // the whole search is stuck: allow every step more, and retry the top's options
      prover->effort_limit *= 2;
      for (size_t index = 0; index < node->option_count; index++)
        node->options[index].tried = 0;
      ok = 1;
    }
    if (!ok) {
      status = ECPP_PROOF_OUT_OF_MEMORY;
      break;
    }
  }
  big_number_free(&proven_bound);
  return status;
}

size_t ecpp_prover_step_count(const ecpp_prover *prover) { return prover->step_count; }

const ecpp_certificate_step *ecpp_prover_step(const ecpp_prover *prover, size_t index) { return &prover->steps[index]; }
