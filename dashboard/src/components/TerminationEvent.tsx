"use client";

import { explorerTx } from "@/lib/mantle";
import type { SwarmEvent } from "@/types";

type Props = { event: SwarmEvent };

function fmtTs(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
  } catch {
    return ts;
  }
}

export function TerminationEvent({ event }: Props) {
  const constraints = event.inheritanceConstraints ?? [];
  const txHash = event.recallTxHash ?? event.txHash;

  return (
    <article className="event" data-type="TERMINATION">
      <div className="ts">
        {fmtTs(event.timestamp)}
        <span className="blk">GEN {event.generation}</span>
      </div>

      <div>
        <span className="evt-pill" data-type="TERMINATION">TERMINATION</span>
      </div>

      <div className="agent-cell">{event.agentLabel}</div>

      <div className="desc">
        GEN {event.generation} · terminated · {constraints.length} constraints emitted
      </div>

      <div>
        {txHash ? (
          <a
            className="ev-link"
            href={explorerTx(txHash)}
            target="_blank"
            rel="noopener noreferrer"
          >
            tx {txHash.slice(0, 10)}… ↗
          </a>
        ) : null}
      </div>

      {event.failureReason && (
        <div className="specimen">
          <span className="lbl">Failure Reason · Specimen Note</span>
          {event.failureReason}
        </div>
      )}

      {constraints.length > 0 && (
        <div className="constraints">
          <span className="lbl">Inherited Constraints ({constraints.length})</span>
          <ol>
            {constraints.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ol>
        </div>
      )}
    </article>
  );
}
