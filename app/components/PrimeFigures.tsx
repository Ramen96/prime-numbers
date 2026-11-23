// The pictures on the explainers: dots in rectangles and a factor tree
// (/what-is-a-prime-number), and the factor pairs of 36
// (/how-to-tell-if-a-number-is-prime). Plain SVG in the text's colours, each with a title and a
// description for screen readers, and a visible caption.

const DOT_GAP = 18;
const DOT_RADIUS = 6;

/** `rows` × `columns` dots, from (x, y). */
function Dots({ rows, columns, x, y }: { rows: number; columns: number; x: number; y: number }) {
  return (
    <g>
      {Array.from({ length: rows * columns }, (_, index) => (
        <circle
          key={index}
          cx={x + (index % columns) * DOT_GAP + DOT_RADIUS}
          cy={y + Math.floor(index / columns) * DOT_GAP + DOT_RADIUS}
          r={DOT_RADIUS}
          fill="currentColor"
        />
      ))}
    </g>
  );
}

/** 12 dots as 2 × 6 and 3 × 4; 7 dots in one row. */
export function DotRectangles() {
  return (
    <figure className="my-6" data-testid="dot-rectangles">
      <svg
        viewBox="0 0 300 170"
        role="img"
        aria-labelledby="dot-rectangles-title dot-rectangles-description"
        className="w-full max-w-[22rem] text-foreground"
      >
        <title id="dot-rectangles-title">Dots in rectangles</title>
        <desc id="dot-rectangles-description">
          Twelve dots arranged as 2 rows of 6, and again as 3 rows of 4. Seven dots in a single row of 7.
        </desc>
        <Dots rows={2} columns={6} x={0} y={0} />
        <text x="0" y="56" fontSize="13" fill="var(--muted)">12 = 2 × 6</text>
        <Dots rows={3} columns={4} x={150} y={0} />
        <text x="150" y="74" fontSize="13" fill="var(--muted)">12 = 3 × 4</text>
        <g className="text-(--heat-text)">
          <Dots rows={1} columns={7} x={0} y={112} />
        </g>
        <text x="0" y="150" fontSize="13" fill="var(--muted)">7: only one row</text>
      </svg>
      <figcaption className="mt-2 text-sm text-muted">12 dots make two different rectangles. 7 dots only make one row.</figcaption>
    </figure>
  );
}

interface TreeNode {
  value: number;
  x: number;
  y: number;
  prime: boolean;
}

/** 60 → 6 × 10 → 2 × 3 × 2 × 5: the primes at the bottom circled, in the heat colour. */
export function FactorTree() {
  const nodes: TreeNode[] = [
    { value: 60, x: 150, y: 24, prime: false },
    { value: 6, x: 85, y: 84, prime: false },
    { value: 10, x: 215, y: 84, prime: false },
    { value: 2, x: 50, y: 144, prime: true },
    { value: 3, x: 120, y: 144, prime: true },
    { value: 2, x: 180, y: 144, prime: true },
    { value: 5, x: 250, y: 144, prime: true },
  ];
  const edges: [number, number][] = [
    [0, 1],
    [0, 2],
    [1, 3],
    [1, 4],
    [2, 5],
    [2, 6],
  ];
  return (
    <figure className="my-6" data-testid="factor-tree">
      <svg
        viewBox="0 0 300 170"
        role="img"
        aria-labelledby="factor-tree-title factor-tree-description"
        className="w-full max-w-[22rem] text-foreground"
      >
        <title id="factor-tree-title">A factor tree for 60</title>
        <desc id="factor-tree-description">
          60 splits into 6 times 10. 6 splits into 2 times 3, and 10 into 2 times 5. The primes at the bottom are 2, 3, 2 and 5.
        </desc>
        {edges.map(([from, to]) => (
          <line
            key={`${from}-${to}`}
            x1={nodes[from].x}
            y1={nodes[from].y + 12}
            x2={nodes[to].x}
            y2={nodes[to].y - 16}
            stroke="var(--muted)"
            strokeWidth="1.5"
          />
        ))}
        {nodes.map((node, index) => (
          <g key={index} className={node.prime ? "text-(--heat-text)" : undefined}>
            {node.prime && <circle cx={node.x} cy={node.y - 5} r="17" fill="none" stroke="currentColor" strokeWidth="1.5" />}
            <text x={node.x} y={node.y} textAnchor="middle" fontSize="18" fontWeight={node.prime ? 700 : 400} fill="currentColor">
              {node.value}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="mt-2 text-sm text-muted">Split 60 until every piece is prime: 60 = 2 × 2 × 3 × 5.</figcaption>
    </figure>
  );
}

/** The factor pairs of 36, up to √36 = 6 and then in reverse; in every pair, the side at 6 or below is in the heat colour. */
export function FactorPairs() {
  const upToRoot: [number, number][] = [
    [1, 36],
    [2, 18],
    [3, 12],
    [4, 9],
    [6, 6],
  ];
  const reversed: [number, number][] = [
    [9, 4],
    [12, 3],
    [18, 2],
    [36, 1],
  ];
  const ROW_GAP = 26;
  const FIRST_ROW = 50;
  const root = 6;
  const pair = ([left, right]: [number, number], x: number, y: number, muted: boolean) => (
    <text key={`${left}-${right}`} x={x} y={y} textAnchor="middle" fontSize="17" fill={muted ? "var(--muted)" : "currentColor"}>
      <tspan fill={left <= root ? "var(--heat-text)" : undefined} fontWeight={left <= root ? 700 : undefined}>
        {left}
      </tspan>
      {" × "}
      <tspan fill={right <= root ? "var(--heat-text)" : undefined} fontWeight={right <= root ? 700 : undefined}>
        {right}
      </tspan>
    </text>
  );
  return (
    <figure className="my-6" data-testid="factor-pairs">
      <svg
        viewBox="0 0 300 190"
        role="img"
        aria-labelledby="factor-pairs-title factor-pairs-description"
        className="w-full max-w-[22rem] text-foreground"
      >
        <title id="factor-pairs-title">The factor pairs of 36</title>
        <desc id="factor-pairs-description">
          The pairs 1 × 36, 2 × 18, 3 × 12, 4 × 9 and 6 × 6. Past 6 × 6 the same pairs repeat in reverse: 9 × 4, 12 × 3, 18 ×
          2 and 36 × 1. Every pair has a side at 6 or below.
        </desc>
        <text x="150" y="18" textAnchor="middle" fontSize="13" fill="var(--muted)">
          √36 = 6
        </text>
        <line x1="150" y1="28" x2="150" y2="180" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="4 4" />
        {upToRoot.map((factors, index) => pair(factors, 75, FIRST_ROW + index * ROW_GAP, false))}
        {reversed.map((factors, index) => pair(factors, 225, FIRST_ROW + index * ROW_GAP, true))}
      </svg>
      <figcaption className="mt-2 text-sm text-muted">Every factor pair of 36 has one side at or below √36 = 6.</figcaption>
    </figure>
  );
}
