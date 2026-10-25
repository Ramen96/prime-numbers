// Names given to the app's workers (the `name` option of `new Worker`, seen
// inside as `self.name`). They label the workers in DevTools, and let the e2e
// tests tell them apart: Turbopack starts every worker through the same loader
// script, and production chunk names are hashes, so a worker's URL doesn't say
// what it is. (Sieve threads are Emscripten's, named "em-pthread".)

/** The worker that owns the sieve: one per calculation, started by the page. */
export const PRIME_WORKER_NAME = "primes";

/** A Miller–Rabin worker, started inside the prime worker (verificationPool.ts). */
export const VERIFICATION_WORKER_NAME = "verification";
