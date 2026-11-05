#!/bin/sh
# Builds wasm/sieve.c (and bignum.c, primality.c) natively and runs their tests.
#
#   sh tests/native/run.sh fast   # npm run test:native
#   sh tests/native/run.sh slow   # npm run test:native:slow (around 2^64)
#   sh tests/native/run.sh tsan   # npm run test:native:tsan (ThreadSanitizer, ~25 min)
#   sh tests/native/run.sh asan   # npm run test:native:asan (AddressSanitizer, about a minute)
#
# Every suite runs single-threaded (as public/sieve.wasm does) and threaded
# (as public/sieve-threads/ does). Threaded runs use a checkpoint every 7
# base primes instead of every 65,536, so thread slices start and end in
# thousands of places, and split every window however small
# (SIEVE_TEST_HELPERS); one run instead leaves the threshold to be measured,
# as the app does (SIEVE_TEST_MEASURE).
set -e
mkdir -p .cache
warnings="-std=c11 -Wall -Wextra"
sources="wasm/sieve.c wasm/bignum.c wasm/primality.c -lm"
prover_sources="wasm/ecpp_prover.c wasm/ecpp.c wasm/classpoly.c wasm/primality.c wasm/bignum.c -lm"
slot_sources="wasm/proof_slots.c wasm/sieve.c wasm/ecpp_prover.c wasm/ecpp.c wasm/classpoly.c wasm/primality.c wasm/bignum.c -lm"
threaded="-DSIEVE_THREADS -DBASE_PRIME_CHECKPOINT_INTERVAL=7 -pthread"

case "$1" in
fast)
  cc -O2 $warnings -DSIEVE_TEST_HOOKS -o .cache/sieve_test tests/native/sieve_test.c $sources
  .cache/sieve_test
  cc -O2 $warnings -DSIEVE_TEST_HOOKS $threaded -o .cache/sieve_test_threads tests/native/sieve_test.c $sources
  SIEVE_TEST_HELPERS=3 .cache/sieve_test_threads
  SIEVE_TEST_HELPERS=8 .cache/sieve_test_threads
  cc -O2 $warnings -DSIEVE_TEST_HOOKS -DSIEVE_THREADS -pthread -o .cache/sieve_test_measured tests/native/sieve_test.c $sources
  SIEVE_TEST_HELPERS=8 SIEVE_TEST_MEASURE=1 .cache/sieve_test_measured
  cc -O2 $warnings -o .cache/bignum_test tests/native/bignum_test.c wasm/bignum.c -lm
  .cache/bignum_test
  cc -O2 $warnings -o .cache/primality_test tests/native/primality_test.c wasm/primality.c wasm/bignum.c -lm
  .cache/primality_test
  cc -O2 $warnings -o .cache/ecpp_test tests/native/ecpp_test.c wasm/ecpp.c wasm/classpoly.c wasm/bignum.c -lm
  .cache/ecpp_test
  cc -O2 $warnings -o .cache/classpoly_test tests/native/classpoly_test.c wasm/classpoly.c wasm/bignum.c -lm
  .cache/classpoly_test
  cc -O2 $warnings -o .cache/ecpp_prover_test tests/native/ecpp_prover_test.c $prover_sources
  .cache/ecpp_prover_test
  cc -O2 $warnings -o .cache/proof_slots_test tests/native/proof_slots_test.c $slot_sources
  .cache/proof_slots_test
  cc -O2 $warnings -DSIEVE_THREADS -pthread -o .cache/proof_slots_test_threads tests/native/proof_slots_test.c $slot_sources
  PROOF_TEST_HELPERS=3 .cache/proof_slots_test_threads
  PROOF_TEST_HELPERS=8 .cache/proof_slots_test_threads
  ;;
slow)
  cc -O2 $warnings -DSIEVE_TEST_HOOKS -o .cache/sieve_slow_test tests/native/sieve_slow_test.c $sources
  .cache/sieve_slow_test
  cc -O2 $warnings -DSIEVE_TEST_HOOKS $threaded -o .cache/sieve_slow_test_threads tests/native/sieve_slow_test.c $sources
  SIEVE_TEST_HELPERS=8 .cache/sieve_slow_test_threads
  ;;
tsan)
  cc -O1 -g $warnings -fsanitize=thread -DSIEVE_TEST_HOOKS $threaded -o .cache/sieve_test_tsan tests/native/sieve_test.c $sources
  SIEVE_TEST_HELPERS=3 .cache/sieve_test_tsan
  SIEVE_TEST_HELPERS=8 .cache/sieve_test_tsan
  SIEVE_TEST_HELPERS=8 SIEVE_TEST_MEASURE=1 .cache/sieve_test_tsan
  cc -O1 -g $warnings -fsanitize=thread -DSIEVE_THREADS -pthread -o .cache/proof_slots_test_tsan tests/native/proof_slots_test.c $slot_sources
  PROOF_TEST_HELPERS=8 .cache/proof_slots_test_tsan
  ;;
asan)
  sanitizers="-O1 -g -fsanitize=address"
  cc $sanitizers $warnings -o .cache/bignum_test_asan tests/native/bignum_test.c wasm/bignum.c -lm
  .cache/bignum_test_asan
  cc $sanitizers $warnings -o .cache/primality_test_asan tests/native/primality_test.c wasm/primality.c wasm/bignum.c -lm
  .cache/primality_test_asan
  cc $sanitizers $warnings -o .cache/ecpp_test_asan tests/native/ecpp_test.c wasm/ecpp.c wasm/classpoly.c wasm/bignum.c -lm
  .cache/ecpp_test_asan
  cc $sanitizers $warnings -o .cache/classpoly_test_asan tests/native/classpoly_test.c wasm/classpoly.c wasm/bignum.c -lm
  .cache/classpoly_test_asan
  cc $sanitizers $warnings -o .cache/ecpp_prover_test_asan tests/native/ecpp_prover_test.c $prover_sources
  .cache/ecpp_prover_test_asan
  cc $sanitizers $warnings -DSIEVE_THREADS -pthread -o .cache/proof_slots_test_asan tests/native/proof_slots_test.c $slot_sources
  PROOF_TEST_HELPERS=8 .cache/proof_slots_test_asan
  cc $sanitizers $warnings -DSIEVE_TEST_HOOKS $threaded -o .cache/sieve_test_asan tests/native/sieve_test.c $sources
  SIEVE_TEST_HELPERS=8 .cache/sieve_test_asan
  ;;
*)
  echo "usage: sh tests/native/run.sh fast|slow|tsan|asan" >&2
  exit 2
  ;;
esac
