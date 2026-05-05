"use client";

import { useRef } from "react";
import type { ChildState } from "@/types";
import { explorerAddress, explorerTx } from "@/lib/mantle";

type Props = { child: ChildState };

function statusTone(child: ChildState): "active" | "warning" | "terminated" {
  if (child.status === "TERMINATED") return "terminated";
  if (child.consecutiveBelowThreshold >= 1) return "warning";
  return "active";
}

function statusLabel(tone: "active" | "warning" | "terminated"): string {
  if (tone === "active") return "ACTIVE";
  if (tone === "warning") return "WARNING";
  return "TERMINATED";
}

function parseAlloc(summary: string): { supply: number; lp: number } {
  const usde = summary.match(/aaveUSDE=\$?([\d.]+)/)?.[1];
  const lp   = summary.match(/moeLP=\$?([\d.]+)/)?.[1];
  const total = parseFloat(usde || "0") + parseFloat(lp || "0");
  if (!total) return { supply: 75, lp: 25 };
  return {
    supply: Math.round((parseFloat(usde || "0") / total) * 100),
    lp: Math.round((parseFloat(lp || "0") / total) * 100),
  };
}

export function AgentCard({ child }: Props) {
  const tone = statusTone(child);
  const alloc = parseAlloc(child.positionSummary);
  const cardRef = useRef<HTMLElement>(null);

  const toggleExpand = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("a")) return;
    const el = cardRef.current;
    if (!el) return;
    const isOpen = el.classList.toggle("is-open");
    el.setAttribute("aria-expanded", isOpen ? "true" : "false");
  };

  const yieldCls = tone === "terminated" ? "neg" : tone === "warning" ? "warn" : "pos";
  const riskCls  = child.riskAdjustedScore >= 0 ? (tone === "warning" ? "warn" : "pos") : "neg";
  const shortAddr = `${child.contractAddress.slice(0, 18)}…${child.contractAddress.slice(-6)}`;

  return (
    <article
      ref={cardRef}
      className="agent"
      data-status={tone}
      tabIndex={0}
      role="button"
      aria-expanded="false"
      onClick={toggleExpand}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }}
    >
      <div className="agent-top">
        <div className="agent-name">{child.lineageKey}</div>
        <span className="gen-badge">GEN {child.generation}</span>
      </div>

      <div className="agent-status-row">
        <span className="pill" data-tone={tone}>
          <span className="dot" />
          {statusLabel(tone)}
        </span>
        {tone === "warning" && (
          <span style={{ color: "var(--amber)", fontSize: 10, letterSpacing: "0.06em" }}>
            ↓ {child.consecutiveBelowThreshold} cycles below threshold
          </span>
        )}
        {tone === "terminated" && (
          <span style={{ color: "var(--crimson)", fontSize: 10, letterSpacing: "0.06em" }}>
            recalled · cycle {child.cycleCount}
          </span>
        )}
      </div>

      <div className="agent-metrics">
        <div className="metric">
          <div className="k">Yield</div>
          <div className={`v ${yieldCls}`}>{child.currentYieldPct.toFixed(2)}%</div>
        </div>
        <div className="metric">
          <div className="k">Risk</div>
          <div className={`v ${riskCls}`}>
            {child.riskAdjustedScore >= 0 ? "+" : ""}{child.riskAdjustedScore.toFixed(2)}
          </div>
        </div>
        <div className="metric">
          <div className="k">Cycles</div>
          <div className="v">{child.cycleCount}</div>
        </div>
      </div>

      <div className="agent-foot">
        <div className="addr">{shortAddr}</div>
        <a
          className="chain-link"
          href={explorerAddress(child.contractAddress)}
          target="_blank"
          rel="noopener noreferrer"
        >
          mantlescan ↗
        </a>
      </div>

      <div className="agent-expand">
        <div className="kv">
          <div className="k">Contract</div>  <div className="v">{child.contractAddress}</div>
          <div className="k">Agent ID</div>  <div className="v">{child.agentId}</div>
          <div className="k">Spawn Tx</div>  <div className="v">
            {child.mantleSpawnTxHash ? (
              <a href={explorerTx(child.mantleSpawnTxHash)} target="_blank" rel="noopener noreferrer">
                {child.mantleSpawnTxHash.slice(0, 18)}…{child.mantleSpawnTxHash.slice(-6)} ↗
              </a>
            ) : "—"}
          </div>
          <div className="k">Lineage</div>   <div className="v">{child.lineageKey} · gen {child.generation}</div>
        </div>
        <div style={{ marginTop: 14 }}>
          <div className="kv" style={{ marginBottom: 0 }}>
            <div className="k" style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-3)" }}>
              Aave Position
            </div>
            <div />
          </div>
          <div className="alloc-bar">
            <div className="alloc-supply" style={{ width: `${alloc.supply}%` }} />
            <div className="alloc-lp"     style={{ width: `${alloc.lp}%` }} />
          </div>
          <div className="alloc-legend">
            <span><span className="sw" style={{ background: "var(--blue)" }} />Aave Supply · {alloc.supply}%</span>
            <span><span className="sw" style={{ background: "var(--green)" }} />LP / Other · {alloc.lp}%</span>
          </div>
        </div>
      </div>
    </article>
  );
}
