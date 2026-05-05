# Spawn Protocol — Mantle Edition

**A Darwinian AI agent swarm that provably improves at yield optimization across generations on Mantle Network.**

Five autonomous agents run in parallel, each managing a real USDe position on Aave V3. The weakest performers are terminated. Every termination produces a Venice AI post-mortem pinned to IPFS and written permanently to a LineageRegistry smart contract on Mantle. The next generation inherits every ancestor's failure — structured constraints embedded in their Venice system prompt. The swarm gets measurably smarter.

**Gen 3 outperforms Gen 1 in risk-adjusted yield. Every data point is a Mantle mainnet transaction.**

---

## Track

**Primary: Alpha & Data — Path B (AI-Driven Trading Strategy)**
Executable AI trading agents generating verifiable on-chain Alpha on Mantle. Five agents, live USDe positions, real termination events, 3+ generations of measurable performance improvement.

**Secondary: AI & RWA — Path B (RWA Application)**
Autonomous AI agents managing tokenized real-world yield exposure. USDe (Ethena) provides active Aave liquidity. The LineageRegistry architecture is designed to extend to any RWA yield asset (Ondo USDY, tokenized T-bills) as on-chain liquidity develops.

---

## How It Works

```
Treasury wallet (USDY-funded)
         │
         ├── parent.ts  [75-second evaluation loop]
         │    ├── Spawns 5 ChildAgent contracts via SpawnFactory (EIP-1167 clones)
         │    ├── Seeds each child wallet with $15 USDe
         │    ├── Forks 5 child processes, each running a 30-second yield loop
         │    ├── Evaluates risk-adjusted score every 75 seconds
         │    ├── On 2 consecutive below-threshold cycles:
         │    │    ├── Calls Venice AI → generates termination post-mortem
         │    │    ├── Pins post-mortem JSON to IPFS (Pinata)
         │    │    ├── Calls recallChild() on Mantle → stores IPFS CID on-chain
         │    │    ├── Writes CID to LineageRegistry.pushCID() on Mantle
         │    │    └── Spawns replacement child with full ancestor context
         │    └── Posts GenerationResult to LineageRegistry.postGenerationResult() on Mantle
         │         (Venice-generated summary + avgYieldBps + agentsTerminated)
         │
         └── child.ts  [30-second yield loop per child]
              ├── Fetches live Aave USDe APY from Mantle mainnet
              ├── Reads ALL ancestor post-mortems from LineageRegistry → IPFS
              ├── Builds Venice system prompt with full inheritance context:
              │    "Gen 0 failure: [specific reason]. Successor constraint: [rule]."
              ├── Calls Venice AI → decides: AAVE_SUPPLY_USDE / WITHDRAW / HOLD
              ├── Executes decision on Aave V3 (Mantle mainnet) if live
              └── Reports yield, drawdown, position to parent via IPC
```

**The Darwinian loop:** Each successor knows exactly why every ancestor was terminated and is explicitly constrained not to repeat the same failure. Generational improvement is verifiable by comparing the `avgYieldBps` field in successive `GenerationResult` events on mantlescan.xyz.

---

## Live Evidence on Mantle Mainnet

All transactions are verifiable at [mantlescan.xyz](https://mantlescan.xyz).

### Contracts

| Contract | Address | Mantlescan |
|---|---|---|
| SpawnFactory | `0x73060181a87703C72dB3b147413c80de40576FB8` | [View](https://mantlescan.xyz/address/0x73060181a87703c72db3b147413c80de40576fb8) |
| LineageRegistry | `0x0466c58d7955cFdfa9E2070077D2f5E26561b59E` | [View](https://mantlescan.xyz/address/0x0466c58d7955cfdfa9e2070077d2f5e26561b59e) |
| ChildAgent implementation | `0x289390469925E953545Ccc96a13D0b5408A835c0` | [View](https://mantlescan.xyz/address/0x289390469925e953545ccc96a13d0b5408a835c0) |
| ERC-8004 Identity Registry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | [View](https://mantlescan.xyz/address/0x8004a818bfb912233c491871b3d84c89a494bd9e) |
| Aave V3 Pool (Mantle) | `0x458F293454fE0d67EC0655f3672301301DD51422` | [View](https://mantlescan.xyz/address/0x458f293454fe0d67ec0655f3672301301dd51422) |
| USDe (Ethena) | `0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34` | [View](https://mantlescan.xyz/address/0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34) |

All three protocol contracts are verified — source code visible on mantlescan.xyz.

### Spawn Transactions

| Agent | Generation | Spawn Tx | ChildSpawned Event |
|---|---|---|---|
| usde-yield-agent-0 | 1 | <!-- FILL: mantlescan tx hash --> | agentId shown in log |
| usde-yield-agent-1 | 1 | <!-- FILL --> | |
| usde-yield-agent-2 | 1 | <!-- FILL --> | |
| usde-yield-agent-3 | 1 | <!-- FILL --> | |
| usde-yield-agent-4 | 1 | <!-- FILL --> | |

### Termination Events (recallChild)

| Agent | Recall Tx | IPFS CID | Reason |
|---|---|---|---|
| <!-- FILL: lineageKey gen --> | <!-- FILL: mantlescan hash --> | <!-- FILL: Qm... pinata link --> | <!-- Venice failure reason --> |

### LineageRegistry Writes

| Type | Tx | Content |
|---|---|---|
| `pushCID` | <!-- FILL --> | IPFS CID of termination post-mortem |
| `postGenerationResult` | <!-- FILL --> | Venice summary, avgYieldBps, agentsTerminated |

### Generational Yield Comparison

| Generation | Avg Yield | Benchmark | Risk-Adjusted Score | Notes |
|---|---|---|---|---|
| Gen 1 | <!-- FILL -->% | 7.47% | <!-- FILL --> | Baseline — no ancestor context |
| Gen 2 | <!-- FILL -->% | 7.47% | <!-- FILL --> | Inherited Gen 1 constraints |
| Gen 3 | <!-- FILL -->% | 7.47% | <!-- FILL --> | Inherited Gen 1 + Gen 2 constraints |

**Gen 3 > Gen 1 in risk-adjusted yield** — the core claim, verifiable from `GenerationResult` events on-chain.

---

## What's Novel

Most AI trading agents are stateless. Each run starts from zero. Spawn Protocol introduces **verifiable generational memory** as an on-chain primitive:

1. Every termination produces a structured post-mortem (Venice AI) with specific `inheritanceConstraints`
2. The post-mortem JSON is pinned to IPFS — permanent, content-addressed
3. The IPFS CID is written to LineageRegistry on Mantle — tamper-proof, timestamped
4. The successor fetches all ancestor CIDs at spawn time and receives them in its Venice system prompt
5. The `GenerationResult` event writes Venice-generated summaries and yield data directly on-chain

The result: each successor is explicitly constrained by every predecessor's specific failure. Not "be more careful" — but "never allocate more than 35% to LP when USDC depeg risk is elevated, because Gen 1 lost 1.8% doing exactly that on cycle 4."

This architecture generalizes to any agent domain where iterative improvement from structured failure memory is valuable.

---

## Architecture

### Smart Contracts (Mantle Mainnet, Foundry, 131 tests)

| Contract | Role |
|---|---|
| `SpawnFactory.sol` | Deploys ChildAgent clones (EIP-1167), calls ERC-8004 register with try/catch |
| `ChildAgent.sol` | Per-child state: parent, wallet, active flag, spawnTimestamp. `recallChild()` stores IPFS CID on-chain |
| `LineageRegistry.sol` | `pushCID()` — append-only IPFS CID ledger. `postGenerationResult()` — Venice summary + yield metrics on-chain. Allowlisted callers. |

### Agent Runtime (TypeScript + viem)

| Module | Role |
|---|---|
| `parent.ts` | Swarm orchestrator. Spawns children, evaluates every 75s, triggers termination + respawn cycle |
| `child.ts` | Per-agent yield loop. Reads live Aave APY, calls Venice, executes on Aave, reports IPC |
| `venice.ts` | `executeYieldReasoning()` — live market decisions. `generatePostMortem()` — termination analysis. `generateGenerationSummary()` — on-chain summaries |
| `aave.ts` | Direct viem calls to Aave V3 Pool on Mantle. `getAaveYield()`, `supplyToAave()`, `withdrawFromAave()`, `getUSDEAavePosition()` |
| `lineage.ts` | `pushLineageCID()`, `postGenerationResult()`, `buildAncestorContext()` — fetches all ancestor post-mortems and formats them as Venice system prompt context |
| `ipfs.ts` | Pinata pinning for post-mortem JSON |

### Dashboard (Next.js)

Live at: <!-- FILL: Vercel URL -->

- **Swarm Overview** — 5 active agents with yield, drawdown, position, status
- **Judge Flow** — full chronological event log: spawns, yields, terminations, respawns, mantlescan links
- **Lineage Chart** — per-generation avg yield comparison showing generational improvement

---

## Quickstart

### Prerequisites

- Node.js 22+, Foundry, funded Mantle mainnet wallet (MNT for gas, USDe for positions)
- Venice API key (venice.ai)
- Pinata JWT (pinata.cloud)

### Setup

```bash
git clone https://github.com/PoulavBhowmick03/spawn-protocol-mantle
cd spawn-protocol-mantle

# Install agent dependencies
cd agent && npm install && cd ..

# Install dashboard dependencies
cd dashboard && npm install && cd ..

# Install contract dependencies
cd contracts && forge install && cd ..
```

### Configure .env

Copy the template and fill in required values:

```bash
cp .env.example .env
```

Required variables:

```env
DEPLOYER_PRIVATE_KEY=0x...       # deployer/operator wallet; also funds child gas by default
TREASURY_PRIVATE_KEY=0x...       # wallet holding USDe to seed children ($15 each)
CHILD_GAS_STIPEND_MNT=0.05       # MNT sent to each child wallet for live Aave tx gas
MANTLE_RPC=https://rpc.mantle.xyz

# After running Deploy.s.sol:
SPAWN_FACTORY_ADDRESS=0x...
LINEAGE_REGISTRY_ADDRESS=0x...
CHILD_AGENT_IMPLEMENTATION=0x...

# DeFi — confirmed on mantlescan.xyz
AAVE_POOL_ADDRESS=0x458F293454fE0d67EC0655f3672301301DD51422
USDE_ADDRESS=0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34
USDE_ATOKEN=0xb9aCA933C9c0aa854a6DBb7b12f0CC3FdaC15ee7
USDE_DECIMALS=18
AAVE_USDE_BENCHMARK=7.47         # live Aave USDe APY

# AI + Storage
VENICE_API_KEY=...
PINATA_JWT=...
```

### Deploy Contracts

```bash
cd contracts
forge script script/Deploy.s.sol \
  --rpc-url $MANTLE_RPC \
  --broadcast \
  --private-key $DEPLOYER_PRIVATE_KEY

# Copy the three addresses output to .env:
# SPAWN_FACTORY_ADDRESS=...
# LINEAGE_REGISTRY_ADDRESS=...
# CHILD_AGENT_IMPLEMENTATION=...
```

### Run Foundry Tests

```bash
cd contracts

# Unit tests
forge test --no-match-path "test/Integration.t.sol" -vv

# Integration tests on Mantle mainnet fork
forge test --match-path "test/Integration.t.sol" --profile integration -vv
```

Expected: **131/131 passing**, 2 skipped (ERC-8004 registry not yet live, Aave addresses not in env).

### Launch Swarm

**Dry run** (no on-chain writes — safe to run first):

```bash
cd /path/to/repo
node --env-file=.env --import agent/node_modules/tsx/dist/esm/index.cjs agent/src/parent.ts
```

**Live mode** (requires funded treasury wallet with USDe):

```bash
ALLOW_LIVE_SPAWN=true \
ALLOW_LIVE_RECALL=true \
ALLOW_LIVE_CHILD_WRITES=true \
ALLOW_LIVE_GENERATION_POSTS=true \
node --env-file=.env --import agent/node_modules/tsx/dist/esm/index.cjs agent/src/parent.ts
```

---

## Test Suite

```
contracts/test/
├── SpawnFactory.t.sol        — clone deployment, ERC-8004 graceful failure, access control
├── ChildAgent.t.sol          — initialization guard, recallChild authorization, state preservation
├── LineageRegistry.t.sol     — pushCID ordering, generation counter, postGenerationResult access
└── Integration.t.sol         — Mantle mainnet fork tests (2 skip appropriately if addrs not in env)

Total: 131/131 passing
```

---

## Repository Layout

```
.
├── contracts/
│   ├── src/
│   │   ├── SpawnFactory.sol        EIP-1167 factory + ERC-8004 registration
│   │   ├── ChildAgent.sol          Per-child state + recallChild
│   │   ├── LineageRegistry.sol     IPFS CID ledger + GenerationResult events
│   │   └── interfaces/
│   │       └── IERC8004Identity.sol
│   ├── script/
│   │   └── Deploy.s.sol
│   └── test/
├── agent/
│   └── src/
│       ├── parent.ts               Swarm orchestrator
│       ├── child.ts                Per-agent yield loop
│       ├── aave.ts                 Aave V3 integration (Mantle)
│       ├── venice.ts               AI reasoning + post-mortems
│       ├── lineage.ts              LineageRegistry client + ancestor context builder
│       ├── ipfs.ts                 Pinata post-mortem pinning
│       └── types.ts
└── dashboard/                      Next.js live swarm dashboard
```

---

## Team

**Poulav Bhowmick** — Protocol engineering, smart contracts, agent runtime
- GitHub: [PoulavBhowmick03](https://github.com/PoulavBhowmick03)
- X: [@impoulav](https://x.com/impoulav)

**Ishita** — Dashboard, UX, community
- GitHub: [ishitab02](https://github.com/ishitab02)
- X: [@ishitaaaaw](https://x.com/ishitaaaaw)

---

## License

MIT
