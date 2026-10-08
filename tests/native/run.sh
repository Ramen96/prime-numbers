#!/bin/sh
# Builds wasm/sieve.c natively and runs its tests.
#
#   sh tests/native/run.sh fast   # npm run test:native
#   sh tests/native/run.sh slow   # npm run test:native:slow (around 2^64)
#   sh tests/native/run.sh tsan   # npm run test:native:tsan (ThreadSanitizer, ~25 min)
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
sources="wasm/sieve.c wasm/bignum.c -lm"
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
  ;;
*)
  echo "usage: sh tests/native/run.sh fast|slow|tsan" >&2
  exit 2
  ;;
esac
