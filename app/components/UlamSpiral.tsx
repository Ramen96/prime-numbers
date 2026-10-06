import { primalityTableBelow } from "@/lib/primes/sieveOfEratosthenes";

/** Odd, so 1 sits exactly in the centre. */
const SIDE_LENGTH = 121;

/**
 * Where each number lands when 1, 2, 3, … are written in a square spiral
 * outward from the centre: right 1, up 1, left 2, down 2, right 3, up 3, …
 */
function spiralPositions(sideLength: number): Array<{ x: number; y: number }> {
  const centre = (sideLength - 1) / 2;
  const totalNumbers = sideLength * sideLength;
  const positions = [{ x: NaN, y: NaN }, { x: centre, y: centre }]; // index = the number
  const directions = [
    { dx: 1, dy: 0 }, // right
    { dx: 0, dy: -1 }, // up (SVG y grows downward)
    { dx: -1, dy: 0 }, // left
    { dx: 0, dy: 1 }, // down
  ];
  let { x, y } = positions[1];
  let directionIndex = 0;
  let stepLength = 1;

  while (positions.length <= totalNumbers) {
    // Each step length is used for two turns before growing by one.
    for (let turn = 0; turn < 2; turn++) {
      const { dx, dy } = directions[directionIndex % 4];
      for (let step = 0; step < stepLength && positions.length <= totalNumbers; step++) {
        x += dx;
        y += dy;
        positions.push({ x, y });
      }
      directionIndex++;
    }
    stepLength++;
  }
  return positions;
}

/**
 * The Ulam spiral, computed at build time (a server component) and drawn as
 * one SVG path with a 1×1 square per prime. No JavaScript in the browser.
 */
export function UlamSpiral() {
  const totalNumbers = SIDE_LENGTH * SIDE_LENGTH;
  const isPrime = primalityTableBelow(totalNumbers + 1);
  const positions = spiralPositions(SIDE_LENGTH);
  const formattedTotal = totalNumbers.toLocaleString("en-US");

  let primeSquares = "";
  for (let number = 2; number <= totalNumbers; number++) {
    if (isPrime[number]) primeSquares += `M${positions[number].x} ${positions[number].y}h1v1h-1z`;
  }

  return (
    <figure className="my-8">
      <svg
        viewBox={`0 0 ${SIDE_LENGTH} ${SIDE_LENGTH}`}
        role="img"
        aria-labelledby="ulam-spiral-title ulam-spiral-description"
        data-testid="ulam-spiral"
        className="mx-auto aspect-square w-full max-w-md rounded-md border border-rule bg-(--background)"
        shapeRendering="crispEdges"
      >
        <title id="ulam-spiral-title">{`Ulam spiral of the numbers 1 to ${formattedTotal}`}</title>
        <desc id="ulam-spiral-description">
          The whole numbers are written in a square spiral starting from 1 in the centre, and
          each prime is drawn as a dot. Many of the primes line up along diagonal lines.
        </desc>
        <path d={primeSquares} fill="var(--heat-color)" />
      </svg>
      <figcaption className="mt-2 text-center text-sm text-muted">
        {`The numbers 1 to ${formattedTotal} in a spiral, with each prime as a dot. Computed when this page was built.`}
      </figcaption>
    </figure>
  );
}
