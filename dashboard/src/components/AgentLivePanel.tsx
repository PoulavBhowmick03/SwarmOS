"use client";

import type { ChildState, SwarmEvent } from "@/types";
import { explorerAddress } from "@/lib/mantle";

const ACTION_COLOR: Record<string, string> = {
  AAVE_SUPPLY_USDE:     "var(--blue)",
  AAVE_SUPPLY_METH:     "var(--blue)",
  AAVE_WITHDRAW_USDE:   "var(--amber)",
  AAVE_WITHDRAW_METH:   "var(--amber)",
  MOE_ADD_LIQUIDITY:    "var(--green)",
  MOE_REMOVE_LIQUIDITY: "var(--crimson)",
  REBALANCE:            "var(--green)",
  HOLD:                 "var(--ink-3)",
};

function parsePosition(summary: string) {
  return {
    cash:     summary.match(/cash=\$?([\d.]+)/)?.[1]     ?? "0.00",
    aaveUSDE: summary.match(/aaveUSDE=\$?([\d.]+)/)?.[1] ?? "0.00",
    aaveMETH: summary.match(/aaveMETH=\$?([\d.]+)/)?.[1] ?? "0.00",
    moeLP:    summary.match(/moeLP=\$?([\d.]+)/)?.[1]    ?? "0.00",
    action:   summary.match(/action=(\w+)/)?.[1]          ?? "—",
  };
}

function fmtTime(iso: string) {
  try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
  catch { return iso; }
}

type Props = { agent: ChildState; events: SwarmEvent[] };

export function AgentLivePanel({ agent, events }: Props) {
  const label = `${agent.lineageKey}-v${agent.generation}`;
  const feed  = events
    .filter((e) => e.type === "YIELD_REPORT" && e.agentLabel === label)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 8);

  const pos       = parsePosition(agent.positionSummary);
  const isWarning = agent.consecutiveBelowThreshold >= 1;
  const dotColor  = isWarning ? "var(--amber)" : "var(--green)";

  return (
    <div style={{
      background: "var(--card)",
      border: `1px solid ${isWarning ? "var(--amber)" : "var(--border)"}`,
      borderRadius: 8,
      overflow: "hidden",
      fontFamily: "var(--mono)",
    }}>
      {/* ── Header ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "9px 14px", borderBottom: "1px solid var(--border)", gap: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            width: 7, height: 7, borderRadius: "50%",
            background: dotColor, boxShadow: `0 0 6px ${dotColor}`,
            display: "inline-block", flexShrink: 0,
            animation: "vpulse 2s ease-in-out infinite",
          }} />
          <span style={{ color: "var(--fg)", fontSize: 12, fontWeight: 600, letterSpacing: "0.03em" }}>
            {agent.lineageKey}
          </span>
          <span style={{
            fontSize: 9, padding: "2px 6px",
            background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)",
            borderRadius: 3, color: "var(--ink-2)", letterSpacing: "0.1em",
          }}>
            GEN {agent.generation}
          </span>
          <span style={{
            fontSize: 9, padding: "2px 6px",
            background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)",
            borderRadius: 3, color: "var(--ink-3)", letterSpacing: "0.08em",
          }}>
            cycle {agent.cycleCount}
          </span>
          {isWarning && (
            <span style={{ fontSize: 10, color: "var(--amber)", letterSpacing: "0.05em" }}>
              ⚠ {agent.consecutiveBelowThreshold} below threshold
            </span>
          )}
        </div>
        <a
          href={explorerAddress(agent.contractAddress)}
          target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 10, color: "var(--ink-3)", textDecoration: "none", flexShrink: 0 }}
        >
          {agent.contractAddress.slice(0, 10)}…{agent.contractAddress.slice(-6)} ↗
        </a>
      </div>

      {/* ── Body: position left + feed right ── */}
      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr" }}>

        {/* Left: position snapshot */}
        <div style={{
          padding: "14px", borderRight: "1px solid var(--border)",
          display: "flex", flexDirection: "column", gap: 12,
        }}>
          {/* Metrics row */}
          <div style={{ display: "flex", gap: 18 }}>
            {[
              { k: "Yield",  v: `${agent.currentYieldPct.toFixed(2)}%`, c: "var(--green)" },
              { k: "Risk",   v: `${agent.riskAdjustedScore >= 0 ? "+" : ""}${agent.riskAdjustedScore.toFixed(2)}`,
                             c: agent.riskAdjustedScore >= 0 ? "var(--blue)" : "var(--crimson)" },
              { k: "Cycles", v: String(agent.cycleCount), c: "var(--fg)" },
            ].map(({ k, v, c }) => (
              <div key={k}>
                <div style={{ fontSize: 8, color: "var(--ink-3)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 3 }}>{k}</div>
                <div style={{ fontSize: 15, color: c, fontWeight: 700 }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Position breakdown */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 10 }}>
            {[
              { label: "Aave USDE", value: `$${pos.aaveUSDE}`, color: "var(--blue)" },
              { label: "Cash",      value: `$${pos.cash}`,     color: "var(--fg)" },
              ...(parseFloat(pos.aaveMETH) > 0
                ? [{ label: "Aave METH", value: `$${pos.aaveMETH}`, color: "var(--blue)" }] : []),
              ...(parseFloat(pos.moeLP) > 0
                ? [{ label: "Moe LP",    value: `$${pos.moeLP}`,    color: "var(--green)" }] : []),
            ].map(({ label, value, color }) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--ink-3)" }}>{label}</span>
                <span style={{ color }}>{value}</span>
              </div>
            ))}
          </div>

          {/* Current action */}
          <div style={{
            fontSize: 10, padding: "5px 8px", borderRadius: 4,
            background: "rgba(0,0,0,0.25)", border: "1px solid var(--border)",
            color: ACTION_COLOR[pos.action] ?? "var(--ink-2)",
            letterSpacing: "0.06em",
          }}>
            ▶ {pos.action}
          </div>
        </div>

        {/* Right: decision feed */}
        <div style={{ padding: "14px" }}>
          <div style={{
            fontSize: 9, color: "var(--ink-3)", letterSpacing: "0.12em",
            textTransform: "uppercase", marginBottom: 10,
          }}>
            Recent Decisions
          </div>

          {feed.length === 0 ? (
            <div style={{ fontSize: 11, color: "var(--ink-3)", paddingTop: 4 }}>
              Awaiting first cycle report…
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {feed.map((e, i) => (
                <div key={i} style={{
                  display: "grid",
                  gridTemplateColumns: "76px 190px 56px auto",
                  alignItems: "center", gap: 10, fontSize: 11,
                  opacity: i === 0 ? 1 : Math.max(0.35, 1 - i * 0.12),
                }}>
                  <span style={{ color: "var(--ink-3)" }}>{fmtTime(e.timestamp)}</span>
                  <span style={{
                    color: ACTION_COLOR[e.actionTaken ?? ""] ?? "var(--ink-2)",
                    letterSpacing: "0.03em",
                  }}>
                    {e.actionTaken ?? "—"}
                  </span>
                  <span style={{ color: "var(--green)" }}>
                    {e.currentYieldPct != null ? `${e.currentYieldPct.toFixed(2)}%` : "—"}
                  </span>
                  {i === 0 && (
                    <span style={{
                      fontSize: 8, color: "var(--green)", letterSpacing: "0.1em",
                      background: "rgba(0,200,100,0.08)", padding: "2px 6px",
                      borderRadius: 3, border: "1px solid rgba(0,200,100,0.2)",
                    }}>
                      LATEST
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
