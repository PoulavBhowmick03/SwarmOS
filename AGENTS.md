# SwarmOS — Agent Architecture

## Core Concept

SwarmOS is a Darwinian AI agent swarm on Solana. A parent agent spawns child agents to compete on a defined task. Underperformers are terminated on-chain. Successors are respawned with the failure memory of their predecessors encoded in their lineage PDA. The swarm evolves — each generation is smarter than the last because it knows exactly how the previous one died.

---

## Agent Types

### ParentAgent
- **Role**: Swarm orchestrator. Spawns children, sets scoring threshold, triggers evaluation cycles, reads lineage before spawning successors.
- **On-chain state**: `Swarm` PDA — holds swarm config, generation counter, active agent count, treasury balance.
- **Off-chain**: Node.js process. Calls `spawn_agent`, `evaluate_and_prune`, `respawn_successor` on the Anchor program. Reads `LineageMemory` PDAs before spawning to inject prior failure context into child prompts.
- **x402**: Funds child agent wallets with USDC via SPL transfer before each spawn.

### ChildAgent
- **Role**: Task executor. Receives a task prompt + lineage context. Executes using Claude API. Submits result to scoring oracle. Gets scored. Gets terminated or survives.
- **On-chain state**: `Agent` PDA — holds agent_id, parent_id, generation, task_type, score, status (Active / Terminated / Survived), spawn_timestamp, lineage_hash.
- **Off-chain**: Ephemeral Node.js worker spawned by ParentAgent. Has its own Solana keypair funded by parent. Dies when `terminate_agent` is called on-chain.
- **x402**: Pays $0.01 USDC via x402 to the ScoringOracle API before each score submission.

### ScoringOracle
- **Role**: External API (your own Express server deployed on Vercel/Railway). Accepts agent output, evaluates it against the task rubric, returns a score 0–100. Protected by x402 middleware — agents must pay before getting scored.
- **On-chain**: Not a Solana program. Off-chain server. Score is submitted to chain by the oracle after payment is confirmed.
- **x402**: Charges agents $0.01 USDC per evaluation call. Uses `@coinbase/x402-express` middleware on Solana.

---

## Agent Lifecycle

```
SPAWNED → ACTIVE → [SCORED] → SURVIVED or TERMINATED
                                      ↓
                              LineageMemory PDA written
                                      ↓
                         Next generation reads lineage
                                      ↓
                              RESPAWNED with context
```

### States (stored in Agent PDA)
| State | u8 value | Description |
|---|---|---|
| `Active` | 0 | Spawned, executing task |
| `Scored` | 1 | Score submitted, awaiting evaluation |
| `Survived` | 2 | Score above threshold |
| `Terminated` | 3 | Score below threshold — failure recorded |
| `Respawned` | 4 | Successor of a terminated agent |

---

## Lineage Memory System

When an agent is terminated, the Anchor program writes a `LineageMemory` PDA:

```
seeds = [b"lineage", swarm.key().as_ref(), &agent.agent_id.to_le_bytes()]
```

Stores:
- `agent_id`: which agent died
- `generation`: which generation
- `task_type`: what task it was doing
- `failure_score`: how badly it failed
- `failure_reason_hash`: keccak of the failure summary (stored off-chain in IPFS/Arweave, hash on-chain)
- `timestamp`: when it was terminated

Before spawning a successor, the ParentAgent:
1. Fetches all `LineageMemory` PDAs for that task_type
2. Retrieves failure summaries from IPFS by hash
3. Injects them into the child agent's system prompt: *"Previous agents failed because: [reasons]. Do not repeat these mistakes."*

This is the Darwinian memory. This is what makes SwarmOS defensible.

---

## Scoring Mechanism

**Task types** (configurable per swarm):
- `YieldOptimizer`: Find best USDC yield on Solana DeFi (Kamino, MarginFi, Drift). Score = accuracy of APY data + recommendation quality.
- `CodeReviewer`: Review a Solana program for vulnerabilities. Score = number of valid issues found.
- `DataSynthesizer`: Summarize a dataset. Score = LLM-judged quality.

**Scoring rubric** (in ScoringOracle):
- Output relevance: 0–40 pts
- Accuracy/correctness: 0–40 pts  
- Efficiency (response time): 0–20 pts

**Threshold**: Default 60/100. Configurable at swarm initialization. Agents below threshold → terminated.

---

## x402 Payment Flow

```
ChildAgent calls ScoringOracle endpoint
  → Server returns HTTP 402 with payment details
  → ChildAgent constructs Solana USDC transfer tx
  → ChildAgent signs and sends tx
  → x402 facilitator confirms settlement
  → ScoringOracle processes evaluation
  → Returns score JSON
  → ChildAgent calls submit_score() on Anchor program
```

Tools: `@coinbase/x402-axios` (client) + `@coinbase/x402-express` (server)

---

## LI.FI Cross-Chain Funding

User funds the Swarm treasury from supported LI.FI source chains into Solana USDC.

Flow:
1. User opens dashboard, sees "Fund Swarm" button
2. LI.FI widget loads — user picks source chain + token
3. LI.FI routes swap → bridge → arrives as USDC in Swarm PDA treasury
4. ParentAgent reads treasury balance, distributes to child wallets at spawn time

Integration: LI.FI Widget (React component, easiest) + LI.FI SDK for backend treasury monitoring.

---

## ElevenLabs Voice Layer

Every on-chain lifecycle event triggers an ElevenLabs TTS narration on the dashboard:

| Event | Voice line |
|---|---|
| Agent spawned | "Agent {id} deployed. Generation {n}. Inheriting {k} failure memories." |
| Agent scored | "Agent {id} scored {score}/100." |
| Agent terminated | "Agent {id} terminated. Score {score} fell below threshold. Recording failure to chain." |
| Agent survived | "Agent {id} survived. Genetic memory preserved." |
| New generation | "Generation {n} complete. {x} agents survived. Spawning next wave." |

Uses ElevenLabs `text-to-speech` endpoint with a consistent voice ID for all agents (narrator persona).

---

## On-Chain Program Structure (Anchor)

```
programs/
  swarm-os/
    src/
      lib.rs           ← program entrypoint
      state/
        swarm.rs       ← Swarm account
        agent.rs       ← Agent account  
        lineage.rs     ← LineageMemory account
      instructions/
        initialize_swarm.rs
        spawn_agent.rs
        submit_score.rs
        evaluate_and_prune.rs
        respawn_successor.rs
        fund_treasury.rs
```

---

## Off-Chain Architecture

```
packages/
  agent-runtime/       ← ParentAgent + ChildAgent Node.js processes
  scoring-oracle/      ← Express server with x402 middleware
  dashboard/           ← Next.js frontend
    components/
      SwarmVisualizer  ← D3 tree of agents
      AgentCard        ← per-agent status
      LiFiWidget       ← cross-chain funding
      VoiceNarrator    ← ElevenLabs player
```
