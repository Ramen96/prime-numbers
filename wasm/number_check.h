// The prime checker (/is-prime): one number's verdict, for the checker's worker.
// Below a(13), deterministic Miller–Rabin settles it either way. From a(13) up,
// BPSW: a composite verdict is a proof, a pass only a probable prime, which the
// page proves with a proof slot if asked. Every verdict's evidence is checked
// again in TypeScript (lib/primeCheck.ts, answerHolds) before it's shown.
//
// For the calling thread, between sieve calls, like every other export.

#ifndef NUMBER_CHECK_H
#define NUMBER_CHECK_H

#include <stddef.h>
#include <stdint.h>

// Room for the number, `limb_count` 32-bit limbs, least significant first, for
// JavaScript to write into before check_number. NULL if memory runs out.
uint32_t *number_check_input_buffer(size_t limb_count);

// The verdict for the number in the input buffer, as a primality_verdict:
//   below a(13): PRIMALITY_BELOW_TWO, _PRIME, _COMPOSITE_BY_FACTOR or _BY_WITNESS;
//   from a(13) up: PRIMALITY_PROBABLE_PRIME (not a proof), or _COMPOSITE_BY_FACTOR,
//   _BY_WITNESS, _BY_SQUARE or _BY_LUCAS;
//   PRIMALITY_OUT_OF_MEMORY if memory ran out: not settled, never "composite".
// -1 if the input buffer wasn't made for `limb_count` limbs (a caller's mistake).
// Any size. It can't be interrupted: the worker is ended to stop it.
int check_number(size_t limb_count);

// The factor or witness base behind the last check_number's composite verdict,
// 0 when that verdict has none.
uint32_t number_check_evidence(void);

#endif
