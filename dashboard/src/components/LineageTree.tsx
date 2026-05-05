"use client";

type Props = { lineageKey?: string };

const NODE_W = 260;
const NODE_H = 84;

const NODES = [
  {
    id: "g0",
    gen: "GEN 0",
    name: "usde-yield-agent-0",
    status: "terminated" as const,
    rx: 60, ry: 30,
    cid: "QmZ4kP9rT2nLwX8vQjB3sH6mYf1cN7pA2eK5gR8tD0uV3w",
  },
  {
    id: "g1",
    gen: "GEN 1",
    name: "usde-yield-agent-1",
    status: "terminated" as const,
    rx: 180, ry: 160,
    cid: "QmA9xR2bN4jP7vK1cT5dF8wM3eL6gH0sQ9pU4iY7oZ2aB5",
  },
  {
    id: "g2",
    gen: "GEN 2",
    name: "usde-yield-agent-2",
    status: "active" as const,
    rx: 300, ry: 290,
    inheritedConstraints: 3,
    cid: undefined,
  },
];

const EDGES: [string, string][] = [["g0", "g1"], ["g1", "g2"]];

export function LineageTree({ lineageKey }: Props) {
  return (
    <svg
      className="tree-svg"
      viewBox="0 0 720 460"
      aria-label="Lineage ancestry tree"
      style={{ display: "block", width: "100%", minWidth: 520 }}
    >
      {/* Edges */}
      {EDGES.map(([fromId, toId]) => {
        const a = NODES.find((n) => n.id === fromId)!;
        const b = NODES.find((n) => n.id === toId)!;
        const x1 = a.rx + 40;
        const y1 = a.ry + NODE_H;
        const x2 = b.rx + 40;
        const y2 = b.ry;
        const my = (y1 + y2) / 2;
        return (
          <path
            key={`${fromId}-${toId}`}
            className="tree-edge"
            d={`M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`}
          />
        );
      })}

      {/* Nodes */}
      {NODES.map((n) => {
        const isActive = n.status === "active";
        const statusColor = isActive ? "var(--green)" : "var(--crimson)";
        const statusLabel = isActive ? "ACTIVE" : "TERMINATED";

        return (
          <g key={n.id} className={`node-${n.status}`}>
            <rect
              className="node-rect"
              x={n.rx}
              y={n.ry}
              width={NODE_W}
              height={NODE_H}
              rx={8}
            />
            {/* Gen label */}
            <text className="node-meta" x={n.rx + 14} y={n.ry + 22}>
              {n.gen}
            </text>
            {/* Status dot */}
            <circle cx={n.rx + NODE_W - 16} cy={n.ry + 16} r={3} fill={statusColor} />
            {/* Pulse ring for active */}
            {isActive && (
              <circle
                className="pulse-ring"
                cx={n.rx + NODE_W - 16}
                cy={n.ry + 16}
                r={4}
              />
            )}
            {/* Agent name */}
            <text className="node-name" x={n.rx + 14} y={n.ry + 46}>
              {n.name}
            </text>
            {/* Status label */}
            <text className="node-meta" x={n.rx + 14} y={n.ry + 66} fill={statusColor}>
              {statusLabel}
            </text>
            {/* IPFS CID link for terminated */}
            {n.cid && (
              <text className="node-cid" x={n.rx + 14} y={n.ry + NODE_H + 16}>
                <a
                  href={`https://gateway.pinata.cloud/ipfs/${n.cid}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fill: "var(--blue)" }}
                >
                  ipfs · {n.cid.slice(0, 16)}…{n.cid.slice(-6)} ↗
                </a>
              </text>
            )}
            {/* Constraint tag for active */}
            {n.inheritedConstraints != null && (
              <text
                className="constraint-tag"
                x={n.rx + NODE_W + 14}
                y={n.ry + NODE_H / 2 + 4}
              >
                ↳ {n.inheritedConstraints} constraints inherited
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
