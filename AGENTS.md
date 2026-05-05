# AGENTS.md — Spawn Protocol: Mantle Edition
## Turing Test Hackathon 2026 | AI Awakening | June 15 Deadline

> This document is the single source of truth for any coding agent building this project.
> Read every section before writing a single line of code. Phase order is strict.

---

## CRITICAL: Byreal CLI Discovery

`@byreal/agent-skills` does NOT exist on npm. `@byreal-io/byreal-cli` is a **Solana-native** CLMM tool — it asks for a Base58 Solana private key at setup and has zero Mantle EVM integration.

**Consequence:** There is no `byreal.ts`. All child agent DeFi execution uses **direct viem contract calls to Aave Pool and Merchant Moe on Mantle mainnet**. The Agentic Wallets & Economy track is dropped. Primary track is AI x RWA (exclusively Mantle-backed, field currently empty).

---

## What You Are Building

**Spawn Protocol on Mantle** — a Darwinian AI agent swarm that provably improves at yield optimization across generations.

Parent agent spawns 5 child agents as separate OS processes via `child_process.fork()`. Each child manages real USDY/mETH yield positions on Mantle mainnet (Aave V3 + Merchant Moe). Parent evaluates every child on risk-adjusted yield every 75 seconds. Two consecutive below-threshold cycles triggers `recallChild()` on-chain. A Venice AI failure post-mortem is pinned to IPFS, the CID is written to LineageRegistry.sol on Mantle. The successor child fetches all ancestor post-mortems and receives them in its Venice system prompt. The swarm gets measurably smarter across generations because every successor knows exactly why every ancestor was terminated.

**The winning metric:** Gen 3 outperforms Gen 1 in risk-adjusted yield. Every data point is a permanent Mantle mainnet tx verifiable on mantlescan.xyz.

**Prior wins with this architecture:**
- Synthesis Hackathon March 2026: 2nd overall, 90/100 Private Agents, 91/100 ERC-8004, 50K+ txs
- PL Genesis April 2026: 2nd x2, $2,250
- HashKey Chain Horizon April 2026: 139/139 Foundry tests passing

---

## All External URLs the Agent Needs

### Mantle
- RPC: `https://rpc.mantle.xyz`
- Chain ID: `5000`
- Explorer: `https://mantlescan.xyz`
- Docs: `https://docs.mantle.xyz`

### ERC-8004 Canonical Registry (DO NOT deploy your own)
- Identity Registry: `0x8004A818BFB912233c491871b3d84c89A494BD9e`
- Reputation Registry: `0x8004B663056A597Dffe9eCcC1965A193B7388713`
- Fetch actual ABI from: `https://mantlescan.xyz/address/0x8004A818BFB912233c491871b3d84c89A494BD9e`
- EIP spec: `https://eips.ethereum.org/EIPS/eip-8004`

**CONFIRMED:** The registry address currently has no bytecode on `https://rpc.mantle.xyz`. SpawnFactory handles this gracefully — `register()` is called inside `try/catch` and falls back to `agentId = 0`. Do NOT make the ERC-8004 call a hard require anywhere. Spawns must succeed regardless of registry liveness. When the registry goes live, `agentId` will populate automatically without any code change.

### DeFi on Mantle — Addresses Must Be Fetched Before Coding
Do NOT hardcode addresses from memory. Look them up on mantlescan.xyz before Phase 1:
- Aave V3 Pool: search "Aave Pool" on mantlescan.xyz, use the Pool proxy address
- USDY (Ondo Finance tokenized T-bill): search "USDY"
- mETH (Mantle liquid staking token): search "mETH"
- Merchant Moe Router: `https://merchantmoe.com/docs`
- Aave V3 ABI reference: `https://github.com/aave/aave-v3-core`

### Venice AI
- Endpoint: `https://api.venice.ai/api/v1/chat/completions`
- Model: `llama-3.3-70b`
- Required params: `enable_e2ee: true`
- Venice always returns markdown-fenced JSON — strip with `.replace(/```json|```/g, "").trim()` before every `JSON.parse()`

### Lit Protocol
- Docs: `https://developer.litprotocol.com`
- Use `evmContractConditions` targeting Mantle mainnet
- If `"mantle"` is not a valid chain string in Lit SDK, use `chainId: 5000` directly

### IPFS / Filecoin
- Pinata (post-mortem pinning): `https://docs.pinata.cloud`
- Lighthouse (Filecoin swarm snapshots): `https://docs.lighthouse.storage`

### Prior Codebase
- GitHub: `https://github.com/PoulavBhowmick03/Spawn-Protocol`
- Most relevant prior art: HashKey Chain pivot branch (LineageRegistry.sol pattern, IPFS post-mortem pipeline)

---

## Directory Structure

```
spawn-protocol-mantle/
├── AGENTS.md
├── plan.md
├── README.md                         ← judge-facing
├── ishita.md                         ← Ishita's briefing
├── .env
├── contracts/
│   ├── src/
│   │   ├── SpawnFactory.sol
│   │   ├── ChildAgent.sol
│   │   ├── LineageRegistry.sol
│   │   └── interfaces/
│   │       ├── IERC8004Identity.sol  ← built from actual ABI on mantlescan
│   │       └── IERC8004Reputation.sol
│   ├── test/
│   │   ├── SpawnFactory.t.sol
│   │   ├── ChildAgent.t.sol
│   │   ├── LineageRegistry.t.sol
│   │   └── Integration.t.sol
│   ├── script/
│   │   ├── Deploy.s.sol
│   │   └── RegisterERC8004.s.sol
│   └── foundry.toml
├── agent/
│   ├── src/
│   │   ├── parent.ts
│   │   ├── child.ts
│   │   ├── venice.ts
│   │   ├── lit.ts
│   │   ├── aave.ts                   ← direct viem calls, NO Byreal
│   │   ├── merchant-moe.ts           ← direct viem calls, optional
│   │   ├── ipfs.ts
│   │   ├── filecoin.ts
│   │   ├── lineage.ts
│   │   ├── chain.ts
│   │   └── types.ts
│   ├── package.json
│   └── tsconfig.json
└── dashboard/
    ├── src/
    │   ├── pages/
    │   │   ├── index.tsx             ← swarm overview
    │   │   ├── judge-flow.tsx        ← verifiable event trail
    │   │   └── lineage.tsx           ← generational PnL chart
    │   └── components/
    │       ├── AgentCard.tsx
    │       ├── TerminationEvent.tsx
    │       └── GenerationChart.tsx
    ├── package.json
    └── next.config.js
```

---

## Smart Contracts

### SpawnFactory.sol
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/Clones.sol";

interface IERC8004Identity {
    function register(address agent) external returns (uint256 agentId);
}

interface IChildAgent {
    function initialize(address parent, address wallet) external;
}

contract SpawnFactory {
    address public immutable childImplementation;
    address public constant ERC8004_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;
    address public immutable lineageRegistry;
    address public owner;

    event ChildSpawned(
        address indexed child,
        uint256 indexed agentId,
        string lineageKey,
        uint256 generation,
        uint256 timestamp
    );

    constructor(address _childImpl, address _lineageRegistry) {
        childImplementation = _childImpl;
        lineageRegistry = _lineageRegistry;
        owner = msg.sender;
    }

    function spawnChild(
        string calldata lineageKey,
        uint256 generation,
        address childWallet
    ) external returns (address child, uint256 agentId) {
        child = Clones.clone(childImplementation);
        IChildAgent(child).initialize(msg.sender, childWallet);
        // Graceful fallback: registry may not be live yet on Mantle mainnet
        try IERC8004Identity(ERC8004_REGISTRY).register(child) returns (uint256 registeredAgentId) {
            agentId = registeredAgentId;
        } catch {
            agentId = 0;
        }
        emit ChildSpawned(child, agentId, lineageKey, generation, block.timestamp);
    }
}
```

### ChildAgent.sol
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ChildAgent {
    address public parent;
    address public wallet;
    bool public active;
    uint256 public spawnTimestamp;

    event RecallChild(address indexed child, string reason, string ipfsCid, uint256 timestamp);

    modifier onlyParent() { require(msg.sender == parent, "Only parent"); _; }

    function initialize(address _parent, address _wallet) external {
        require(parent == address(0), "Already initialized");
        parent = _parent;
        wallet = _wallet;
        active = true;
        spawnTimestamp = block.timestamp;
    }

    function recallChild(string calldata reason, string calldata ipfsCid) external onlyParent {
        active = false;
        emit RecallChild(address(this), reason, ipfsCid, block.timestamp);
    }
}
```

### LineageRegistry.sol
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract LineageRegistry {
    mapping(string => string[]) private lineageCIDs;
    mapping(string => uint256) public generation;

    event LineageUpdated(string indexed lineageKey, string cid, uint256 generation, uint256 timestamp);

    function pushCID(string calldata lineageKey, string calldata cid) external {
        lineageCIDs[lineageKey].push(cid);
        generation[lineageKey]++;
        emit LineageUpdated(lineageKey, cid, generation[lineageKey], block.timestamp);
    }

    function getLineage(string calldata lineageKey) external view returns (string[] memory) {
        return lineageCIDs[lineageKey];
    }

    function getLatestCID(string calldata lineageKey) external view returns (string memory) {
        string[] storage cids = lineageCIDs[lineageKey];
        require(cids.length > 0, "No lineage");
        return cids[cids.length - 1];
    }

    function getGenerationCount(string calldata lineageKey) external view returns (uint256) {
        return lineageCIDs[lineageKey].length;
    }
}
```

---

## Agent Code Skeletons

### types.ts
```typescript
export type ChildStatus = "ACTIVE" | "TERMINATED" | "RESPAWNING";

export type YieldAction =
  | "AAVE_SUPPLY_USDY" | "AAVE_SUPPLY_METH"
  | "AAVE_WITHDRAW_USDY" | "AAVE_WITHDRAW_METH"
  | "MOE_ADD_LIQUIDITY" | "MOE_REMOVE_LIQUIDITY"
  | "REBALANCE" | "HOLD";

export interface ChildState {
  pid: number;
  contractAddress: string;
  walletAddress: string;
  agentId: bigint;
  lineageKey: string;
  generation: number;
  spawnTime: number;
  cycleCount: number;
  currentYieldPct: number;
  benchmarkYieldPct: number;
  maxDrawdownPct: number;
  riskAdjustedScore: number;
  consecutiveBelowThreshold: number;
  positionSummary: string;
  status: ChildStatus;
  ipfsCid?: string;
  mantleSpawnTxHash: string;
  mantleRecallTxHash?: string;
}

export interface TerminationPostMortem {
  lineageKey: string;
  generation: number;
  agentContractAddress: string;
  agentWalletAddress: string;
  terminationTimestamp: number;
  cyclesLived: number;
  failureReason: string;
  metricsAtTermination: {
    finalYieldPct: number;
    benchmarkYieldPct: number;
    maxDrawdownPct: number;
    riskAdjustedScore: number;
    positionSummary: string;
  };
  inheritanceConstraints: string[];
  mantleRecallTxHash: string;
}

export interface ChildIPCReport {
  type: "YIELD_REPORT" | "ERROR";
  walletAddress: string;
  currentYieldPct: number;
  drawdownPct: number;
  positionSummary: string;
  aaveSupplyUSDY: number;
  aaveSupplyMETH: number;
  moeLPValue: number;
  timestamp: number;
}
```

### chain.ts
```typescript
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const mantle = {
  id: 5000,
  name: "Mantle",
  nativeCurrency: { name: "Mantle", symbol: "MNT", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mantle.xyz"] } },
  blockExplorers: { default: { name: "Mantlescan", url: "https://mantlescan.xyz" } },
} as const;

export const publicClient = createPublicClient({
  chain: mantle,
  transport: http(process.env.MANTLE_RPC ?? "https://rpc.mantle.xyz"),
});

export function getWalletClient(privateKey: `0x${string}`) {
  return createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain: mantle,
    transport: http(process.env.MANTLE_RPC ?? "https://rpc.mantle.xyz"),
  });
}
```

### aave.ts
```typescript
// Direct viem calls to Aave V3 Pool on Mantle mainnet
// FETCH ACTUAL POOL ADDRESS FROM mantlescan.xyz BEFORE USING

import { publicClient, getWalletClient } from "./chain";
import { parseUnits } from "viem";

// TODO: All addresses must be fetched from mantlescan.xyz
const AAVE_POOL = process.env.AAVE_POOL_ADDRESS as `0x${string}`;
const USDY = process.env.USDY_ADDRESS as `0x${string}`;
const METH = process.env.METH_ADDRESS as `0x${string}`;

// VERIFY DECIMALS ON MANTLESCAN BEFORE USING
// USDY might be 6 or 18 decimals — do not assume
const USDY_DECIMALS = parseInt(process.env.USDY_DECIMALS ?? "6");
const METH_DECIMALS = parseInt(process.env.METH_DECIMALS ?? "18");

const POOL_ABI = [
  {
    name: "supply",
    type: "function",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
      { name: "referralCode", type: "uint16" },
    ],
    outputs: [],
  },
  {
    name: "withdraw",
    type: "function",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "to", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "getReserveData",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "configuration", type: "tuple", components: [{ name: "data", type: "uint256" }] },
          { name: "liquidityIndex", type: "uint128" },
          { name: "currentLiquidityRate", type: "uint128" },
          { name: "variableBorrowIndex", type: "uint128" },
          { name: "currentVariableBorrowRate", type: "uint128" },
          { name: "currentStableBorrowRate", type: "uint128" },
          { name: "lastUpdateTimestamp", type: "uint40" },
          { name: "id", type: "uint16" },
          { name: "aTokenAddress", type: "address" },
          { name: "stableDebtTokenAddress", type: "address" },
          { name: "variableDebtTokenAddress", type: "address" },
          { name: "interestRateStrategyAddress", type: "address" },
          { name: "accruedToTreasury", type: "uint128" },
          { name: "unbacked", type: "uint128" },
          { name: "isolationModeTotalDebt", type: "uint128" },
        ],
      },
    ],
  },
] as const;

export async function getAaveYield(asset: "USDY" | "METH"): Promise<number> {
  const assetAddr = asset === "USDY" ? USDY : METH;
  const data = await publicClient.readContract({
    address: AAVE_POOL,
    abi: POOL_ABI,
    functionName: "getReserveData",
    args: [assetAddr],
  }) as any;
  // currentLiquidityRate is in ray units (1e27) — convert to APY %
  return (Number(data.currentLiquidityRate) / 1e27) * 100;
}

export async function supplyToAave(
  privateKey: `0x${string}`,
  asset: "USDY" | "METH",
  amountUSD: number
): Promise<string> {
  const walletClient = getWalletClient(privateKey);
  const assetAddr = asset === "USDY" ? USDY : METH;
  const decimals = asset === "USDY" ? USDY_DECIMALS : METH_DECIMALS;
  const amount = parseUnits(amountUSD.toString(), decimals);
  const hash = await walletClient.writeContract({
    address: AAVE_POOL,
    abi: POOL_ABI,
    functionName: "supply",
    args: [assetAddr, amount, walletClient.account.address, 0],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function withdrawFromAave(
  privateKey: `0x${string}`,
  asset: "USDY" | "METH",
  amountUSD: number
): Promise<string> {
  const walletClient = getWalletClient(privateKey);
  const assetAddr = asset === "USDY" ? USDY : METH;
  const decimals = asset === "USDY" ? USDY_DECIMALS : METH_DECIMALS;
  const amount = parseUnits(amountUSD.toString(), decimals);
  const hash = await walletClient.writeContract({
    address: AAVE_POOL,
    abi: POOL_ABI,
    functionName: "withdraw",
    args: [assetAddr, amount, walletClient.account.address],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
```

### venice.ts
```typescript
const VENICE_API = "https://api.venice.ai/api/v1/chat/completions";

function parseVeniceJSON<T>(raw: string): T {
  // Always strip markdown fences — Venice wraps JSON in ```json ... ``` by default
  const clean = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(clean) as T;
}

export async function executeYieldReasoning(
  systemPrompt: string,
  marketState: {
    aaveUSDYYield: number;
    aaveMETHYield: number;
    moeLPYield: number;
    currentAaveUSDY: number;
    currentAaveMETH: number;
    currentMoeLP: number;
    totalPortfolioUSD: number;
  }
): Promise<{ action: import("./types").YieldAction; amountUSD: number; asset: string; rationale: string }> {
  const response = await fetch(VENICE_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.VENICE_API_KEY}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b",
      enable_e2ee: true,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Current Mantle mainnet state:
Aave USDY APY: ${marketState.aaveUSDYYield.toFixed(4)}%
Aave mETH APY: ${marketState.aaveMETHYield.toFixed(4)}%
Merchant Moe LP APY: ${marketState.moeLPYield.toFixed(4)}%
Your positions: Aave USDY $${marketState.currentAaveUSDY}, Aave mETH $${marketState.currentAaveMETH}, Moe LP $${marketState.currentMoeLP}
Total portfolio: $${marketState.totalPortfolioUSD}

Respond ONLY with valid JSON, no markdown:
{
  "action": "AAVE_SUPPLY_USDY|AAVE_SUPPLY_METH|AAVE_WITHDRAW_USDY|AAVE_WITHDRAW_METH|MOE_ADD_LIQUIDITY|MOE_REMOVE_LIQUIDITY|REBALANCE|HOLD",
  "amountUSD": <number>,
  "asset": "USDY|mETH",
  "rationale": "<private reasoning to be encrypted>",
  "riskNote": "<main risk of this action>"
}`,
        },
      ],
    }),
  });
  const data = await response.json();
  return parseVeniceJSON(data.choices[0].message.content);
}

export async function generatePostMortem(
  state: import("./types").ChildState
): Promise<Omit<import("./types").TerminationPostMortem, "mantleRecallTxHash">> {
  const response = await fetch(VENICE_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.VENICE_API_KEY}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b",
      enable_e2ee: true,
      messages: [
        {
          role: "user",
          content: `Generate a failure post-mortem for a terminated yield agent on Mantle Network.

${state.lineageKey} Generation ${state.generation}
Cycles lived: ${state.cycleCount}
Final yield: ${state.currentYieldPct.toFixed(4)}% vs benchmark ${state.benchmarkYieldPct.toFixed(4)}%
Max drawdown: ${state.maxDrawdownPct.toFixed(4)}%
Risk-adjusted score: ${state.riskAdjustedScore.toFixed(4)}
Position: ${state.positionSummary}

Respond ONLY with valid JSON, no markdown:
{
  "failureReason": "<specific technical reason>",
  "positionSummary": "<positions held at termination>",
  "inheritanceConstraints": ["<rule 1 successor must follow>", "<rule 2>", "<rule 3>"]
}`,
        },
      ],
    }),
  });
  const data = await response.json();
  const parsed = parseVeniceJSON<any>(data.choices[0].message.content);

  return {
    lineageKey: state.lineageKey,
    generation: state.generation,
    agentContractAddress: state.contractAddress,
    agentWalletAddress: state.walletAddress,
    terminationTimestamp: Date.now(),
    cyclesLived: state.cycleCount,
    failureReason: parsed.failureReason,
    metricsAtTermination: {
      finalYieldPct: state.currentYieldPct,
      benchmarkYieldPct: state.benchmarkYieldPct,
      maxDrawdownPct: state.maxDrawdownPct,
      riskAdjustedScore: state.riskAdjustedScore,
      positionSummary: parsed.positionSummary,
    },
    inheritanceConstraints: parsed.inheritanceConstraints,
  };
}
```

---

## Critical Gotchas

1. **Fetch all contract addresses from mantlescan.xyz before writing Phase 1 code.** AAVE_POOL, USDY, METH, MOE_ROUTER — never hardcode from memory or docs. Confirm each on the explorer.

2. **Verify USDY token decimals before calling `parseUnits()`.** USDY is likely 6 but could be 18. A wrong decimals assumption is a silent fund-loss bug. Check the contract on mantlescan.

3. **Fetch ERC-8004 Identity Registry ABI from mantlescan.xyz.** The `register(address)` function signature in IERC8004Identity.sol is an assumption. Verify against verified source at `https://mantlescan.xyz/address/0x8004A818BFB912233c491871b3d84c89A494BD9e`.

4. **Venice always wraps JSON in markdown fences.** Use `parseVeniceJSON()` helper before every `JSON.parse()` on Venice responses. This has caused bugs in every prior build.

5. **Fund child wallets before forking.** `fundChildWallet()` must confirm on Mantle mainnet before the OS `fork()` call. A child starting with zero balance silently fails on first Aave call.

6. **Evaluation metric division-by-zero guard.** Use `Math.abs(drawdown || 0.01)` for the first 2 cycles of each child's life.

7. **Lit Protocol chain name.** Test `"mantle"` as the chain param in Lit SDK before Phase 2. If unsupported, use `chainId: 5000` in `evmContractConditions`.

8. **Merchant Moe is optional.** Aave supply/withdraw alone produces sufficient yield data for the Darwinian loop. Do not implement Moe LP writes until Aave is fully stable in Phase 2.

9. **No Byreal anywhere.** Do not import, reference, or attempt to use any Byreal package. It is Solana-only and irrelevant to this build.

10. **Foundry integration tests use mainnet fork.** Add to foundry.toml:
```toml
[profile.integration]
fork_url = "https://rpc.mantle.xyz"
```
Run with `forge test --profile integration`.

---

## Environment Variables

```env
MANTLE_RPC=https://rpc.mantle.xyz
DEPLOYER_PRIVATE_KEY=0x...
TREASURY_PRIVATE_KEY=0x...

# Fill after Phase 1 deploy
SPAWN_FACTORY_ADDRESS=
LINEAGE_REGISTRY_ADDRESS=

# ERC-8004 canonical — do not change
ERC8004_IDENTITY_REGISTRY=0x8004A818BFB912233c491871b3d84c89A494BD9e
ERC8004_REPUTATION_REGISTRY=0x8004B663056A597Dffe9eCcC1965A193B7388713

# Fetch from mantlescan.xyz before Phase 1
AAVE_POOL_ADDRESS=
USDY_ADDRESS=
USDY_DECIMALS=
METH_ADDRESS=
METH_DECIMALS=
MOE_ROUTER_ADDRESS=

# AI + Privacy
VENICE_API_KEY=
LIT_PRIVATE_KEY=

# Storage
PINATA_JWT=
LIGHTHOUSE_API_KEY=

# Runtime baseline
AAVE_USDY_BENCHMARK=3.0
```

---

## Phase Order (Strict — Each Phase Gates the Next)

### Phase 1 (May 7–9): Infrastructure
Goal: One child wallet with a real USDY Aave supply tx on Mantle mainnet. $1K deployment award secured.
- [ ] Fetch all contract addresses from mantlescan.xyz, put in .env
- [ ] Fetch ERC-8004 Identity Registry ABI, write correct IERC8004Identity.sol
- [ ] Write + test SpawnFactory.sol, ChildAgent.sol, LineageRegistry.sol
- [ ] `forge test` — all passing
- [ ] Deploy to Mantle mainnet: `forge script script/Deploy.s.sol --rpc-url $MANTLE_RPC --broadcast`
- [ ] RegisterERC8004.s.sol — verify agent on mantlescan.xyz ERC-8004 display
- [ ] Write chain.ts, aave.ts
- [ ] Fund test wallet, execute one `supplyToAave()`, verify tx on mantlescan.xyz

**DoD:** SpawnFactory deployed, one ChildAgent in ERC-8004 registry, one real USDY supply tx on mantlescan.xyz.

### Phase 2 (May 10–15): Full Child Loop
Goal: First clean termination cycle with IPFS post-mortem in LineageRegistry.
- [ ] venice.ts, lit.ts, ipfs.ts, filecoin.ts, lineage.ts
- [ ] Complete child.ts 30-second loop
- [ ] Complete parent.ts 75-second evaluation loop
- [ ] 3 simultaneous children running
- [ ] One manual termination: recallChild() tx + IPFS CID + LineageRegistry write verified
- [ ] Successor spawned: log Venice system prompt to confirm ancestor context injected

**DoD:** Full spawn → loop → terminate → IPFS → LineageRegistry → successor cycle on mantlescan.xyz.

### Phase 3 (May 16–22): Generational Data (THE HACKATHON)
Goal: 3+ generations on mainnet with measurable yield improvement.
- [ ] 5-child swarm running 48+ hours continuously
- [ ] Per-generation yield data logged: avg yield, benchmark, drawdown, risk score
- [ ] Gen 3 outperforms Gen 1 (any margin)
- [ ] All mantlescan.xyz links collected for README
- [ ] If improvement is flat: debug Venice yield prompt before anything else

**DoD:** On-chain evidence of 3+ generations, Gen 3 > Gen 1 in risk-adjusted yield.

### Phase 4 (May 23–June 5): Dashboard
Goal: Live dashboard, Judge Flow tab, GenerationChart.
- [ ] Swarm overview with live agent cards
- [ ] Judge Flow: every event with mantlescan.xyz tx links
- [ ] GenerationChart: per-generation avg yield comparison
- [ ] Termination event card with IPFS post-mortem link
- [ ] Mobile-readable, deployed to Vercel

### Phase 5 (June 6–15): Submit
- [ ] README.md (judge-facing, leads with generational PnL numbers)
- [ ] ishita.md
- [ ] DoraHacks submission: AI x RWA + AI Trading & Strategy tagged
- [ ] Twitter campaign: 1 termination event post per day, GenerationChart image, tag @0xMantle

---

## Scope Guard

**Must have:** Darwinian loop on Mantle mainnet + ERC-8004 conformance + LineageRegistry with 3 generations + Venice reasoning + Judge Flow dashboard + generational yield improvement data.

**Cut if behind:** ENS text records, Merchant Moe LP writes, Filecoin snapshots, Lit Protocol (cut from live demo, keep in README narrative).

**Never cut:** The generational yield improvement numbers. Without them, there is no submission.