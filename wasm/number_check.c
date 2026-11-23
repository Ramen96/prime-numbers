// See number_check.h.

#include "number_check.h"

#include <stdlib.h>

#include "bignum.h"
#include "primality.h"

static uint32_t *input_limbs = NULL;
static size_t input_capacity = 0;
static uint32_t last_evidence = 0;

uint32_t *number_check_input_buffer(size_t limb_count) {
  size_t wanted = limb_count > 0 ? limb_count : 1;
  if (wanted > input_capacity) {
    uint32_t *grown = realloc(input_limbs, wanted * sizeof *grown);
    if (grown == NULL)
      return NULL;
    input_limbs = grown;
    input_capacity = wanted;
  }
  return input_limbs;
}

int check_number(size_t limb_count) {
  last_evidence = 0;
  if (limb_count > input_capacity)
    return -1;
  big_number candidate;
  big_number_init(&candidate);
  if (!big_number_set_limbs(&candidate, input_limbs, limb_count)) {
    big_number_free(&candidate);
    return PRIMALITY_OUT_OF_MEMORY;
  }
  uint32_t evidence = 0;
  primality_verdict verdict = miller_rabin(&candidate, &evidence);
  // From a(13) up no set of Miller–Rabin bases proves anything (a(13) passes all
  // 13), so BPSW decides: its composite verdicts are proofs, its pass isn't.
  if (verdict == PRIMALITY_BEYOND_PROVEN_BOUND)
    verdict = bpsw(&candidate, &evidence);
  big_number_free(&candidate);
  if (verdict == PRIMALITY_COMPOSITE_BY_FACTOR || verdict == PRIMALITY_COMPOSITE_BY_WITNESS)
    last_evidence = evidence;
  return (int)verdict;
}

uint32_t number_check_evidence(void) { return last_evidence; }
