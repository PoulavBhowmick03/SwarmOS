# SwarmOS — Darwinian AI Agent Swarm on Solana

> _Every death makes the swarm smarter._

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Built on Solana](https://img.shields.io/badge/Built%20on-Solana-9945FF)](https://solana.com)
[![Anchor](https://img.shields.io/badge/Anchor-0.30.x-blue)](https://anchor-lang.com)
[![x402](https://img.shields.io/badge/Payments-x402-green)](https://x402.org)

## What is SwarmOS?

SwarmOS is a Darwinian AI agent swarm protocol on Solana. A parent agent spawns a population of child agents to compete on a task. They are scored, evaluated, and the weakest are terminated on-chain. Before respawning successors, the system reads the failure memory of every dead agent — stored immutably in Solana account state — and injects it into the next generation's context.

The swarm evolves. Each generation is smarter than the last because it knows exactly how the previous one died.

This is evolution, not just automation.

---

## The Problem

Multi-agent AI systems today have no memory of failure. When an agent fails, its mistakes vanish. The next agent starts from zero. At scale — thousands of agent invocations, thousands of failures — this is a compounding waste. There is no learning. There is no selection pressure. There is no evolution.

SwarmOS fixes this. Every agent death is an on-chain event. Every failure is recorded in a `LineageMemory` PDA. Every successor is born knowing what killed its predecessors.

---

## How It Works

```
ParentAgent
    │
    ├─► ChildAgent #1 ──► ScoringOracle (pays x402) ──► score: 78 ✓ SURVIVED
    ├─► ChildAgent #2 ──► ScoringOracle (pays x402) ──► score: 45 ✗ TERMINATED
    │                                                        │
    │                                              LineageMemory PDA written
    │                                          (failure reason hash on-chain)
    │
    └─► ChildAgent #3 (Successor of #2)
            └─► Reads LineageMemory PDAs
            └─► Prompt injected with: "Agent #2 failed because: [reasons]"
            └─► Evolved behavior
```

### The Darwinian Feedback Loop

1. **Spawn**: ParentAgent calls `spawn_agent` — creates an `Agent` PDA with generation counter and task assignment
2. **Execute**: ChildAgent runs its task using Claude AI, produces output
3. **Pay & Score**: ChildAgent pays $0.01 USDC via x402 to ScoringOracle, receives evaluation score
4. **Evaluate**: `evaluate_and_prune` instruction runs — agents below threshold (default 60/100) are marked `Terminated`, `LineageMemory` PDA is written with failure hash
5. **Remember**: Survivors and parent read all LineageMemory PDAs for their task type
6. **Evolve**: `respawn_successor` creates new agents with `lineage_hash` in their account, parent injects failure summaries into their context before they execute

---

## On-Chain Architecture

Built with **Anchor** on Solana. All agent state lives on-chain.

### Accounts

**`Swarm` PDA** — `[b"swarm", authority]`

```
authority: Pubkey
name: String
generation: u64
active_agent_count: u32
total_spawned: u64
scoring_threshold: u8     // default 60
treasury: Pubkey          // USDC token account for agent funding
task_type: TaskType
```

**`Agent` PDA** — `[b"agent", swarm, agent_id_le_bytes]`

```
agent_id: u64
swarm: Pubkey
parent_id: Option<u64>
generation: u64
task_type: TaskType
status: AgentStatus       // Active | Scored | Survived | Terminated | Respawned
score: u8
lineage_hash: [u8; 32]    // hash of failure context from prior generation
spawn_timestamp: i64
termination_timestamp: Option<i64>
```

**`LineageMemory` PDA** — `[b"lineage", swarm, agent_id_le_bytes]`

```
agent_id: u64
swarm: Pubkey
generation: u64
task_type: TaskType
failure_score: u8
failure_reason_hash: [u8; 32]   // SHA256 of failure summary (stored off-chain)
arweave_uri: String              // failure summary full text on Arweave
timestamp: i64
```

### Instructions

| Instruction          | Description                                                    |
| -------------------- | -------------------------------------------------------------- |
| `initialize_swarm`   | Create Swarm PDA, set config                                   |
| `spawn_agent`        | Create Agent PDA, assign task, read lineage                    |
| `submit_score`       | Called by oracle after x402 payment confirmed                  |
| `evaluate_and_prune` | Terminate below-threshold agents, write LineageMemory          |
| `respawn_successor`  | Spawn new Agent inheriting lineage of a terminated agent       |
| `fund_treasury`      | Accept USDC into Swarm treasury (receives LI.FI bridge output) |

---

## x402 — Agent-to-Agent Micropayments

Every ChildAgent **pays before it can be scored**. The ScoringOracle is an x402-protected API.

When a ChildAgent calls `/evaluate`, the server returns `HTTP 402 Payment Required` with Solana USDC payment terms. The agent constructs a signed USDC transfer transaction, submits it, and retries — receiving its evaluation score only after the x402 facilitator confirms on-chain settlement.

This creates a **real economic model**: agents that consume compute (scoring) must pay for it. The treasury is self-sustaining. At scale, agent-to-agent x402 micropayments form the economic backbone of autonomous swarm operations.

**x402 on Solana stats**: 35M+ transactions, $10M+ volume since launch. Solana holds ~49% of all x402 agent-to-agent market share.

Integration: `@coinbase/x402-express` (oracle server) + `@coinbase/x402-axios` (agent client)

---

## LI.FI — Cross-Chain Treasury Funding

Users fund the Swarm treasury from any chain. You don't need to be on Solana to deploy a SwarmOS swarm.

The dashboard embeds the LI.FI Widget — users select a supported source chain and token, LI.FI routes the optimal swap + bridge path, and USDC arrives directly in the Swarm treasury PDA on Solana.

The ParentAgent monitors treasury balance and distributes USDC to child agent wallets at spawn time.

---

## ElevenLabs — Voice Narration

The dashboard narrates every lifecycle event in real-time:

- _"Agent seven deployed. Generation two. Inheriting three failure memories from the previous cycle."_
- _"Agent three scored forty-two out of one hundred. Termination initiated."_
- _"Lineage memory written to chain. Agent three's failures will not be repeated."_
- _"Generation two complete. Four agents survived. Spawning the next wave."_

This makes SwarmOS feel alive. The voice layer is not cosmetic — it's the interface through which you understand what the swarm is doing.

---

## Tech Stack

| Layer               | Technology                       |
| ------------------- | -------------------------------- |
| Smart contracts     | Anchor (Rust), Solana            |
| Agent runtime       | Node.js, TypeScript              |
| AI inference        | Anthropic Claude API             |
| Micropayments       | x402 (Coinbase CDP), Solana USDC |
| Cross-chain bridge  | LI.FI SDK + Widget               |
| Voice layer         | ElevenLabs TTS API               |
| Dashboard           | Next.js 14, Tailwind CSS, D3.js  |
| Oracle deployment   | Railway                          |
| Frontend deployment | Vercel                           |

---

## Contract Deployment

| Network       | Program ID          |
| ------------- | ------------------- |
| Solana Devnet | `[PROGRAM_ID_HERE]` |

**USDC Mint (Devnet)**: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`

---

## Live Demo

- **Dashboard**: [swarmos.vercel.app](https://swarmos.vercel.app)
- **Demo Video**: [YouTube](https://youtube.com/[LINK])
- **Scoring Oracle**: [swarmos-oracle.railway.app](https://swarmos-oracle.railway.app)

---

## Setup & Run

### Prerequisites

- Rust + Anchor CLI 0.30.x
- Solana CLI, configured for devnet
- Node.js 20+
- Funded devnet wallet (`solana airdrop 2`)

### Install

```bash
git clone https://github.com/PoulavBhowmick03/SwarmOS
cd SwarmOS
npm install
```

### Build & Deploy Program

```bash
cd programs/swarm-os
anchor build
anchor deploy --provider.cluster devnet
# Copy Program ID to .env and lib.rs declare_id!()
```

### Configure Environment

```bash
cp .env.example .env
# Fill in:
# ANTHROPIC_API_KEY
# VENICE_API_KEY              # optional: richer lineage post-mortems + optional agent execution
# AGENT_LLM_PROVIDER=venice   # optional: run child agents on Venice instead of Anthropic
# ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID
# X402_FACILITATOR_URL=https://x402.org/facilitator
# USDC_MINT_DEVNET=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
# SWARM_PROGRAM_ID=<deployed program id>
# SCORING_ORACLE_URL=<your railway url>
```

Lineage memories keep the same on-chain PDA/hash shape, but the agent runtime now stores the mock off-chain payload locally under `packages/agent-runtime/.lineage-memory/` and, when `VENICE_API_KEY` is set, asks Venice to turn failures into compact post-mortems before injecting them into the next generation. Tune `LINEAGE_CONTEXT_RULES`, `LINEAGE_RAW_MEMORY_LIMIT`, and `LINEAGE_PROMPT_MAX_CHARS` if prompts get too large.

For Venice-powered runs, the runtime uses JSON mode and disables visible reasoning by default so reasoning tokens do not crowd out the JSON answer. Override with `VENICE_DISABLE_REASONING=false` and `VENICE_REASONING_EFFORT=low|medium|high` if you explicitly want model-side reasoning.

### Run Oracle

```bash
cd packages/scoring-oracle
npm run dev
# Deploy to Railway: railway up
```

### Run Dashboard

```bash
cd packages/dashboard
npm run dev
# Deploy to Vercel: vercel deploy
```

### Start a Swarm

```bash
cd packages/agent-runtime
npx ts-node src/parent.ts --task yield-optimizer --agents 5 --generations 3
```

To archive old local generation state and start from a fresh swarm authority:

```bash
npm run reset:swarm-local
npm run start:swarm:fresh -- --task yield-optimizer --agents 5 --generations 3
```

The fresh command creates an ignored authority keypair under `packages/agent-runtime/.swarm-authorities/`, funds it from the configured wallet when possible, and writes the new `NEXT_PUBLIC_SWARM_ADDRESS` into the local env files.

---

## Repository Structure

```
SwarmOS/
├── programs/
│   └── swarm-os/          # Anchor program (Rust)
│       ├── src/
│       │   ├── lib.rs
│       │   ├── state/
│       │   │   ├── swarm.rs
│       │   │   ├── agent.rs
│       │   │   └── lineage.rs
│       │   └── instructions/
│       │       ├── initialize_swarm.rs
│       │       ├── spawn_agent.rs
│       │       ├── submit_score.rs
│       │       ├── evaluate_and_prune.rs
│       │       └── respawn_successor.rs
│       └── Anchor.toml
├── packages/
│   ├── agent-runtime/     # ParentAgent + ChildAgent (TypeScript)
│   ├── scoring-oracle/    # Express + x402 middleware
│   └── dashboard/         # Next.js frontend
├── tests/                 # Anchor TypeScript tests
└── README.md
```

---

## Team

**Poulav Bhowmick** — Protocol engineer. Ethereum Protocol Fellow (EPF Cohort 5/6). Open-source contributor to reth, lighthouse, libp2p. Nethermind intern.

**Ishita Bhattacharyya** — AI/ML engineer. Venice prompt engineering, agent behavior design, dashboard narrative and UX.

---

## Why SwarmOS Wins

Other multi-agent systems forget. SwarmOS remembers. The on-chain lineage memory is not a feature — it is the protocol. Every termination event is a training signal. Every respawn is a smarter agent. The swarm doesn't just run tasks. It evolves.

Built during Dev3Pack Global Hackathon, May 8–10, 2026.

---

_MIT License. Open source. Forever._
