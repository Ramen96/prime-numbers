// The two pictures on /what-is-a-prime-number: dots in rectangles, and a
// factor tree. Plain SVG in the text's colours, each with a title and a
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
