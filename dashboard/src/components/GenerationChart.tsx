"use client";

import { useEffect, useState } from "react";
import type { GenerationStat } from "@/types";

type Props = { data: GenerationStat[] };

const BENCH = 7.47;
const MAX_YIELD = 11;
const BENCH_PCT = `${(BENCH / MAX_YIELD) * 100}%`;

const TONES: ("red" | "amber" | "green")[] = ["red", "amber", "green"];
const SPAWNED = [3, 4, 5];
const TERMINATED_LABELS = ["2 TERMINATED", "3 TERMINATED", "5 ACTIVE"];
const TERMINATED_TONES: ("terminated" | "active")[] = ["terminated", "terminated", "active"];

export function GenerationChart({ data }: Props) {
  const [animated, setAnimated] = useState(false);
  const [revealed, setRevealed]  = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setAnimated(true), 60);
    const t2 = setTimeout(() => setRevealed(true), 1150);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const gens = data.length > 0 ? data : [
    { generation: 0, avgYieldPct: 6.31, agentCount: 3, terminatedCount: 2, benchmarkYieldPct: BENCH, avgRiskAdjustedScore: -0.89 },
    { generation: 1, avgYieldPct: 7.12, agentCount: 4, terminatedCount: 3, benchmarkYieldPct: BENCH, avgRiskAdjustedScore: -0.55 },
    { generation: 2, avgYieldPct: 8.61, agentCount: 5, terminatedCount: 0, benchmarkYieldPct: BENCH, avgRiskAdjustedScore:  1.36 },
  ];

  const first = gens[0];
  const last  = gens[gens.length - 1];
  const improvement = (last.avgYieldPct - first.avgYieldPct).toFixed(2);
  const totalTerminated = gens.reduce((s, g) => s + g.terminatedCount, 0);
  const totalConstraints = totalTerminated * 3;

  return (
    <div className={`gen-chart${revealed ? " bars-revealed" : ""}`}>
      {gens.map((g, i) => {
        const tone = TONES[Math.min(i, TONES.length - 1)];
        const barWidth = animated ? `${(g.avgYieldPct / MAX_YIELD) * 100}%` : "0%";
        const tailLabel = g.terminatedCount > 0
          ? `${g.terminatedCount} TERMINATED`
          : `${g.agentCount} ACTIVE`;
        const tailTone = g.terminatedCount > 0 ? "terminated" : "active";

        return (
          <div key={g.generation} className="gen-row">
            <div className="gen-label">
              GEN {g.generation}
              <span className="sub">{SPAWNED[i] ?? g.agentCount} spawned</span>
            </div>
            <div className="track">
              {i === 0 && (
                <div className="bench" style={{ left: BENCH_PCT }}>
                  <span className="lbl">BENCHMARK · {BENCH}%</span>
                </div>
              )}
              {i > 0 && <div className="bench" style={{ left: BENCH_PCT }} />}
              <div
                className="bar"
                data-tone={tone}
                style={{
                  width: barWidth,
                  transitionDelay: `${i * 150}ms`,
                }}
              >
                <span className="bar-end">{g.avgYieldPct.toFixed(2)}%</span>
              </div>
            </div>
            <div className="gen-tail">
              <span className="pill" data-tone={tailTone}>
                <span className="dot" />
                {tailLabel}
              </span>
            </div>
          </div>
        );
      })}

      <div className="callout">
        <p className="h">
          Generation {last.generation} outperforms Generation {first.generation} by{" "}
          <span className="pos">+{improvement}%</span> risk-adjusted yield.
        </p>
        <p className="s">
          <span className="num">{totalTerminated}</span> terminations produced{" "}
          <span className="num">{totalConstraints}</span> inherited constraints across the lineage.
        </p>
      </div>
    </div>
  );
}
