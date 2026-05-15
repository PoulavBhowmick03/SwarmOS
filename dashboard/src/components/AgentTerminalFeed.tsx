"use client";

import { useEffect, useRef } from "react";
import type { SwarmEvent } from "@/types";
import { explorerTx } from "@/lib/mantle";

const ACTION_COLOR: Record<string, string> = {
  AAVE_SUPPLY_USDE:      "var(--blue)",
  AAVE_SUPPLY_METH:      "var(--blue)",
  AAVE_WITHDRAW_USDE:    "var(--amber)",
  AAVE_WITHDRAW_METH:    "var(--amber)",
  MOE_ADD_LIQUIDITY:     "var(--green)",
  MOE_REMOVE_LIQUIDITY:  "var(--crimson)",
  REBALANCE:             "var(--green)",
  HOLD:                  "var(--ink-4)",
};

const ACTION_PREFIX: Record<string, string> = {
  AAVE_SUPPLY_USDE:     "▶ SUPPLY",
  AAVE_SUPPLY_METH:     "▶ SUPPLY",
  AAVE_WITHDRAW_USDE:   "◀ WITHDRAW",
  AAVE_WITHDRAW_METH:   "◀ WITHDRAW",
  MOE_ADD_LIQUIDITY:    "+ LP ADD",
  MOE_REMOVE_LIQUIDITY: "- LP REMOVE",
  REBALANCE:            "⇄ REBALANCE",
  HOLD:                 "· HOLD",
};

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toISOString().replace("T", " ").slice(0, 19) + " UTC";
  } catch {
    return iso;
  }
}

function bpsToUSD(amountBps: number | undefined, positionSummary: string | undefined): string | null {
  if (!amountBps || amountBps === 0) return null;
  // amountBps is basis points of portfolio — just show bps as a signal, not converted
  if (amountBps > 0) return `${(amountBps / 100).toFixed(2)}% of portfolio`;
  return null;
}

type Props = {
  events: SwarmEvent[];
  maxLines?: number;
};

export function AgentTerminalFeed({ events, maxLines = 80 }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  const yieldEvents = events
    .filter((e) => e.type === "YIELD_REPORT")
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .slice(-maxLines);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [yieldEvents.length]);

  if (yieldEvents.length === 0) {
    return (
      <div style={{
        fontFamily: "var(--mono)",
        fontSize: 11,
        color: "var(--ink-4)",
        padding: "20px 16px",
        background: "var(--bg-3)",
        border: "1px solid var(--rule)",
        borderRadius: 6,
      }}>
        <span style={{ color: "var(--green)", marginRight: 8 }}>$</span>
        Waiting for agent decisions… fund the treasury wallet to start the swarm.
      </div>
    );
  }

  return (
    <div
      role="log"
      aria-label="Agent decision terminal"
      aria-live="polite"
      style={{
        background: "var(--bg-3)",
        border: "1px solid var(--rule)",
        borderRadius: 6,
        padding: "12px 0",
        maxHeight: 440,
        overflowY: "auto",
        fontFamily: "var(--mono)",
        fontSize: 11,
        lineHeight: 1.6,
      }}
    >
      {yieldEvents.map((e, idx) => {
        const action = e.actionTaken ?? "HOLD";
        const color  = ACTION_COLOR[action] ?? "var(--ink-3)";
        const prefix = ACTION_PREFIX[action] ?? action;
        const alloc  = bpsToUSD(e.amountBps, e.positionSummary);
        const hash   = e.decisionHash;
        const tx     = e.txHash;

        return (
          <div
            key={`${e.timestamp}-${idx}`}
            style={{
              padding: "8px 16px",
              borderBottom: idx < yieldEvents.length - 1 ? "1px solid var(--rule)" : undefined,
            }}
          >
            {/* Header row */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
              <span style={{ color: "var(--ink-4)", fontSize: 10, flexShrink: 0 }}>
                {fmtTime(e.timestamp)}
              </span>
              <span style={{
                background: "var(--bg)",
                border: "1px solid var(--rule-2)",
                borderRadius: 3,
                padding: "0 6px",
                fontSize: 9,
                color: "var(--ink-3)",
                letterSpacing: "0.06em",
                flexShrink: 0,
              }}>
                {e.agentLabel}
              </span>
              <span style={{ color, fontWeight: 600, fontSize: 11, letterSpacing: "0.04em" }}>
                {prefix}
              </span>
              {alloc && (
                <span style={{ color: "var(--ink-3)", fontSize: 10 }}>
                  · {alloc}
                </span>
              )}
              {e.currentYieldPct !== undefined && (
                <span style={{ color: "var(--green)", fontSize: 10, marginLeft: "auto" }}>
                  {e.currentYieldPct.toFixed(4)}% APY
                </span>
              )}
            </div>

            {/* Rationale */}
            {e.rationale && (
              <div style={{
                color: "var(--ink-2)",
                fontSize: 10,
                paddingLeft: 14,
                borderLeft: `2px solid ${color}`,
                marginBottom: e.positionSummary ? 4 : 0,
                opacity: 0.9,
                fontStyle: "italic",
              }}>
                {e.rationale}
              </div>
            )}

            {/* Position snapshot */}
            {e.positionSummary && (
              <div style={{ color: "var(--ink-3)", fontSize: 10, paddingLeft: 14, marginTop: 2 }}>
                <span style={{ color: "var(--ink-4)" }}>pos </span>
                {e.positionSummary}
              </div>
            )}

            {/* Footer links */}
            {(hash || tx) && (
              <div style={{ marginTop: 4, paddingLeft: 14, display: "flex", gap: 12 }}>
                {hash && (
                  <span style={{ color: "var(--ink-4)", fontSize: 9, letterSpacing: "0.02em" }}>
                    hash {hash.slice(0, 14)}…
                  </span>
                )}
                {tx && (
                  <a
                    href={explorerTx(tx)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "var(--blue)", fontSize: 9 }}
                  >
                    tx ↗
                  </a>
                )}
              </div>
            )}
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
