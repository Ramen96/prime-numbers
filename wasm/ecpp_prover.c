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
// below a bound. What's left must be prime for the order to be usable. The bound
// grows with the number: stripping deeper makes more orders usable, so a step
// needs fewer discriminants, but costs more per order. Measured natively (step 6,
// with the genus check in), s per proof at bound 10^5 / 10^6: 100 digits 0.11 /
// 0.15, 200 digits 1.67 / 2.30, 300 digits 14.7 / 12.1. So 10^5 below about 250
// digits, and 10^6 from there. A fixed switch point, not measured on the device,
// since measuring it there would take minutes of proofs.
#define STRIP_BOUND 1000000 // the small primes are built up to this, once
#define SMALL_STRIP_BOUND 100000
#define DEEPER_STRIP_FROM_BITS 830 // about 250 digits

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

// Divides out every prime factor of value below `bound` (at most STRIP_BOUND).
static int strip_small_factors(ecpp_prover *prover, big_number *value, uint32_t bound) {
  big_number divisor;
  big_number_init(&divisor);
  int ok = 1;
  for (size_t index = 0; ok && index < prover->small_prime_count; index++) {
    uint32_t prime = prover->small_primes[index];
    if (prime >= bound || big_number_compare_u64(value, prime) <= 0)
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

// ── the genus check, and square roots by multiplication ───────────────────
//
// Finding a discriminant's orders needs √D mod n, a full modular exponentiation,
// and was most of a proof's time (60% to 78% from 100 to 300 digits). Two facts
// make most of that unnecessary. A fundamental discriminant is a product of prime
// discriminants, so √D is the product of their roots: each is computed once per
// number, and every D after that costs a few multiplications. And for a prime n,
// 4n = t² + |D|v² needs n in the principal genus, which means every prime
// discriminant of D is a square mod n: a D with one that isn't can't give a curve,
// so it's skipped without a root or Cornacchia. Measured natively: proofs 1.6×,
// 2.1× and 2.3× faster at 100, 200 and 300 digits, with identical certificates.
// (For a composite n nothing here has to hold: the checker decides, as always.)

// Splits a fundamental discriminant into prime discriminants, whose product it is:
// −d (d ≡ 3 mod 4) is the product of p* = ±p, the sign making p* ≡ 1 mod 4; −4m adds
// −4 (m ≡ 1 mod 4) or ±8 (m = 2m′). Returns how many: at most 16, since a number
// below 2^63 has at most 15 distinct prime factors.
static size_t prime_discriminants(int64_t discriminant, int64_t factors[16]) {
  size_t count = 0;
  int64_t odd = -discriminant;
  if (odd % 4 == 0) {
    int64_t quarter = odd / 4;
    if (quarter % 4 == 1) {
      factors[count++] = -4;
      odd = quarter;
    } else {
      odd = quarter / 2;
      factors[count++] = odd % 4 == 1 ? -8 : 8;
    }
  }
  for (int64_t prime = 3; prime <= odd / prime; prime += 2)
    if (odd % prime == 0) {
      factors[count++] = prime % 4 == 1 ? prime : -prime;
      odd /= prime;
    }
  if (odd > 1)
    factors[count++] = odd % 4 == 1 ? odd : -odd;
  return count;
}

// Empties the table, for a new number.
static void genus_clear(ecpp_prover *prover) {
  for (size_t index = 0; index < prover->genus_capacity; index++)
    if (prover->genus_entries[index].prime_discriminant != 0 && prover->genus_entries[index].has_root)
      big_number_free(&prover->genus_entries[index].root);
  free(prover->genus_entries);
  prover->genus_entries = NULL;
  prover->genus_capacity = prover->genus_used = 0;
}

// Where `key` goes in a table of `capacity` slots (a power of 2): open addressing.
static size_t genus_home(int64_t key, size_t capacity) {
  return (size_t)((uint64_t)key * 0x9E3779B97F4A7C15ull >> 32) & (capacity - 1);
}

// The table's slot for `key`, empty if it isn't there yet. The table grows at half
// full. NULL if memory runs out (the table is left as it was).
static ecpp_genus_entry *genus_slot(ecpp_prover *prover, int64_t key) {
  if (2 * (prover->genus_used + 1) > prover->genus_capacity) {
    size_t larger = prover->genus_capacity == 0 ? 256 : 2 * prover->genus_capacity;
    ecpp_genus_entry *grown = calloc(larger, sizeof *grown);
    if (grown == NULL)
      return NULL;
    for (size_t index = 0; index < prover->genus_capacity; index++) {
      const ecpp_genus_entry *entry = &prover->genus_entries[index];
      if (entry->prime_discriminant == 0)
        continue;
      size_t slot = genus_home(entry->prime_discriminant, larger);
      while (grown[slot].prime_discriminant != 0)
        slot = (slot + 1) & (larger - 1);
      grown[slot] = *entry;
    }
    free(prover->genus_entries);
    prover->genus_entries = grown;
    prover->genus_capacity = larger;
  }
  size_t slot = genus_home(key, prover->genus_capacity);
  while (prover->genus_entries[slot].prime_discriminant != 0 && prover->genus_entries[slot].prime_discriminant != key)
    slot = (slot + 1) & (prover->genus_capacity - 1);
  return &prover->genus_entries[slot];
}

// value = key mod n, for |key| < n (n is past a(13), keys are below 2^63).
static int prime_discriminant_mod(big_number *value, int64_t key, const big_number *n) {
  if (!big_number_set_u64(value, key < 0 ? (uint64_t)0 - (uint64_t)key : (uint64_t)key))
    return 0;
  return key > 0 || big_number_subtract(value, n, value);
}

// 1 with root² ≡ D (mod n), the product of D's prime discriminants' cached roots;
// 0 if one of them isn't a square mod n (D can't work for a prime n, so nothing is
// spent on it); −1 if memory runs out.
static int discriminant_root(ecpp_prover *prover, const big_number *n, int64_t discriminant, big_number *root) {
  if (big_number_compare(&prover->genus_number, n) != 0) {
    genus_clear(prover);
    if (!big_number_copy(&prover->genus_number, n)) {
      big_number_set_u64(&prover->genus_number, 0); // never equal to a number being examined
      return -1;
    }
  }
  int64_t factors[16];
  size_t factor_count = prime_discriminants(discriminant, factors);
  big_number value, product;
  big_number_init(&value);
  big_number_init(&product);
  int result = 1;
  for (size_t index = 0; index < factor_count && result == 1; index++) {
    ecpp_genus_entry *entry = genus_slot(prover, factors[index]);
    if (entry == NULL) {
      result = -1;
      break;
    }
    if (entry->prime_discriminant == 0) {
      if (!prime_discriminant_mod(&value, factors[index], n)) {
        result = -1;
        break;
      }
      int symbol = big_number_jacobi(&value, n);
      if (symbol == -2) {
        result = -1;
        break;
      }
      *entry = (ecpp_genus_entry){.prime_discriminant = factors[index], .is_square = symbol == 1};
      prover->genus_used++;
    }
    if (!entry->is_square) {
      result = 0;
      break;
    }
    if (!entry->has_root) {
      big_number_init(&entry->root);
      int found = prime_discriminant_mod(&value, factors[index], n) ? big_number_square_root_mod(&entry->root, &value, n) : 0;
      if (found != 1) {
        big_number_free(&entry->root);
        if (found < 0)
          entry->is_square = 0; // no root after all: only possible for a composite n
        result = found < 0 ? 0 : -1;
        break;
      }
      entry->has_root = 1;
    }
    if (index == 0)
      result = big_number_copy(&product, &entry->root) ? 1 : -1;
    else
      result = big_number_multiply(&value, &product, &entry->root) && big_number_divide(NULL, &product, &value, n) ? 1 : -1;
  }
  if (result == 1 && !big_number_copy(root, &product))
    result = -1;
  big_number_free(&value);
  big_number_free(&product);
  return result;
}

// Allows every step more effort when the whole search is stuck: the limit doubles,
// but stops at SIZE_MAX / 2 + 1 instead of wrapping to 0, which would let no step
// examine anything and leave the prime pending forever. In wasm32 that's 2^31,
// reached after 20 doublings from 2,048. It can't be reached first anyway: a step
// examining 2^31 discriminants needs |D| up to about 2^33 (about 3 in 10 numbers
// give a fundamental discriminant), and listing a band's forms takes about
// |D|² / 2 steps, some 10^19. The cap only makes sure of it.
static void allow_more_effort(ecpp_prover *prover) {
  if (prover->effort_limit <= SIZE_MAX / 2)
    prover->effort_limit *= 2;
}

#ifdef ECPP_TEST_HOOKS
// For the native tests only (never in the shipped builds): discriminant_root on a
// prover's table, so a wrong skip, which no proof would notice, can be caught.
int ecpp_prover_test_discriminant_root(ecpp_prover *prover, const big_number *n, int64_t discriminant, big_number *root) {
  return discriminant_root(prover, n, discriminant, root);
}

// allow_more_effort, which a test can't reach by getting a search stuck 20 times.
size_t ecpp_prover_test_allow_more_effort(ecpp_prover *prover) {
  allow_more_effort(prover);
  return prover->effort_limit;
}
#endif

// Examines the node's next discriminant, adding an option for each usable order.
// Returns 1, or 0 if memory runs out (the node can try the same one again).
static int examine_next_discriminant(ecpp_prover *prover, ecpp_proof_node *node, const big_number *proven_bound) {
  while (node->next_discriminant >= prover->discriminant_count)
    if (!add_band(prover))
      return 0;
  int64_t discriminant = prover->discriminants[node->next_discriminant].discriminant;
  big_number orders[ECPP_MOST_ORDERS], q, root;
  for (size_t index = 0; index < ECPP_MOST_ORDERS; index++)
    big_number_init(&orders[index]);
  big_number_init(&q);
  big_number_init(&root);
  size_t count = 0;
  int ok = 1;
  int rooted = discriminant_root(prover, &node->n, discriminant, &root);
  ecpp_status status = rooted == 1   ? ecpp_find_orders_from_root(&node->n, discriminant, &root, orders, &count)
                       : rooted == 0 ? ECPP_NOT_FOUND
                                     : ECPP_OUT_OF_MEMORY;
  big_number_free(&root);
  if (status == ECPP_OUT_OF_MEMORY)
    ok = 0;
  uint32_t strip_bound = big_number_bit_length(&node->n) >= DEEPER_STRIP_FROM_BITS ? STRIP_BOUND : SMALL_STRIP_BOUND;
  for (size_t index = 0; ok && status == ECPP_FOUND && index < count; index++) {
    if (!big_number_copy(&q, &orders[index]) || !strip_small_factors(prover, &q, strip_bound)) {
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
  genus_clear(prover);
  big_number_free(&prover->genus_number);
  memset(prover, 0, sizeof *prover);
}

int ecpp_prover_init(ecpp_prover *prover, size_t effort_limit) {
  memset(prover, 0, sizeof *prover);
  big_number_init(&prover->genus_number);
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
      allow_more_effort(prover);
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

size_t ecpp_prover_current_bit_length(const ecpp_prover *prover) {
  // finished (the steps are filled in) or never started: nothing in progress
  if (prover->step_count > 0 || prover->depth == 0)
    return 0;
  return big_number_bit_length(&prover->nodes[prover->depth - 1].n);
}
