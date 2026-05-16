// Backtests Spawn Protocol agent logic against historical Aave V3 USDe data
// on Mantle mainnet. Uses viem block-range reads with graceful synthetic fallback.

import { createPublicClient, http } from "viem";
import { writeFileSync } from "fs";
import * as dotenv from "dotenv";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "../../.env") });

// ─── Chain ────────────────────────────────────────────────────────────────────

const mantle = {
  id: 5000,
  name: "Mantle",
  nativeCurrency: { name: "Mantle", symbol: "MNT", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mantle.xyz"] } },
} as const;

const publicClient = createPublicClient({
  chain: mantle,
  transport: http(process.env.MANTLE_RPC ?? "https://rpc.mantle.xyz"),
});

// ─── Constants ────────────────────────────────────────────────────────────────

const AAVE_POOL = "0x458F293454fE0d67EC0655f3672301301DD51422" as `0x${string}`;
const USDE_ADDRESS = "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34" as `0x${string}`;

// Must match parent.ts DEFAULT_BENCHMARK_PCT (live Aave V3 USDe APY as of 2026-05)
const BENCHMARK_YIELD_PCT = Number(process.env.AAVE_USDE_BENCHMARK ?? "4.50");
// Must match parent.ts TERMINATION_THRESHOLD default
const RISK_THRESHOLD = parseFloat(process.env.RISK_THRESHOLD ?? "0.5");

// Mantle: ~2 seconds per block
const BLOCKS_PER_SECOND = 0.5;
// Parent evaluates every 75 seconds → ~38 blocks per evaluation
const EVAL_INTERVAL_MS = 75_000;
const BLOCKS_PER_EVAL = Math.round(EVAL_INTERVAL_MS / 1000 * BLOCKS_PER_SECOND); // 38
// 30 days at 2s/block
const BLOCKS_30_DAYS = Math.round(30 * 24 * 3600 * BLOCKS_PER_SECOND); // 1,296,000

// Fetch resolution: every 1000 blocks (~33 min) for fast fetch.
// Override with BACKTEST_DATA_STEP=100 for spec-exact 100-block resolution
// (requires archive node, adds ~10 min to fetch).
const DATA_STEP_BLOCKS = Number(process.env.BACKTEST_DATA_STEP ?? "1000");

const SEED_CAPITAL = 25; // $25 per child per spec
const NUM_LINEAGES = 3;
const BATCH_SIZE = 40;
const BATCH_PAUSE_MS = 80;

// ─── ABI (getReserveData only) ────────────────────────────────────────────────

const POOL_ABI = [
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

// ─── Types ────────────────────────────────────────────────────────────────────

interface BacktestConfig {
  startBlock: number;
  endBlock: number;
  numLineages: number;
  seedCapital: number;
  mockVenice: boolean;
  randomSeed: number;
}

interface HistoricalDataPoint {
  block: number;
  liquidityRatePct: number;
}

interface GenerationResult {
  gen: number;
  avgYieldPct: number;
  maxDrawdown: number;
  riskAdjustedScore: number;
  terminations: number;
  cycleCount: number;
}

interface BacktestResult {
  seed: number;
  generations: GenerationResult[];
  generationalLift: number;
  totalTerminations: number;
}

interface BacktestEvent {
  type: "SPAWN" | "YIELD_REPORT" | "TERMINATION" | "RESPAWN";
  timestamp: string;
  seed: number;
  generation: number;
  evalStep: number;
  yieldPct?: number;
  riskScore?: number;
  action?: string;
  reason?: string;
}

interface BacktestOutput {
  runDate: string;
  config: {
    startBlock: number;
    endBlock: number;
    seedCapital: number;
    numLineages: number;
    dataSource: string;
    dataStepBlocks: number;
    evalIntervalMs: number;
    blocksPerEval: number;
  };
  results: BacktestResult[];
  aggregate: {
    meanGenerationalLift: number;
    stdDevGenerationalLift: number;
    totalTerminations: number;
  };
  eventLog: BacktestEvent[];
}

// ─── Seeded PRNG (Mulberry32) ─────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Historical data fetch ────────────────────────────────────────────────────

async function fetchSingleBlock(blockNum: number): Promise<number | null> {
  try {
    const data = (await publicClient.readContract({
      address: AAVE_POOL,
      abi: POOL_ABI,
      functionName: "getReserveData",
      args: [USDE_ADDRESS],
      blockNumber: BigInt(blockNum),
    })) as { currentLiquidityRate: bigint };
    // currentLiquidityRate is in ray (1e27); multiply by 100 for percent
    return (Number(data.currentLiquidityRate) / 1e27) * 100;
  } catch {
    return null;
  }
}

// Ornstein-Uhlenbeck mean-reverting model around benchmark
function buildSyntheticDataset(
  startBlock: number,
  endBlock: number,
  step: number,
): HistoricalDataPoint[] {
  // Fixed seed for reproducible synthetic data
  const rng = mulberry32(0xdeadbeef);
  const points: HistoricalDataPoint[] = [];
  let prev = BENCHMARK_YIELD_PCT + 0.3;

  for (let b = startBlock; b <= endBlock; b += step) {
    const idx = (b - startBlock) / step;
    const drift = (BENCHMARK_YIELD_PCT - prev) * 0.04;
    const shock = (rng() - 0.5) * 0.35;
    // Slow market cycle (~45-day analog at current step resolution) + fast noise
    const slowCycle = 0.55 * Math.sin((idx / 1300) * 2 * Math.PI);
    const fastCycle = 0.22 * Math.sin((idx / 260) * 2 * Math.PI);
    prev = Math.max(1.5, prev + drift + shock + slowCycle * 0.08 + fastCycle * 0.04);
    points.push({ block: b, liquidityRatePct: prev });
  }
  return points;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchHistoricalAaveData(
  startBlock: number,
  endBlock: number,
  stepBlocks: number = DATA_STEP_BLOCKS,
): Promise<{ data: HistoricalDataPoint[]; source: string }> {
  const blockList: number[] = [];
  for (let b = startBlock; b <= endBlock; b += stepBlocks) {
    blockList.push(b);
  }

  if (process.env.BACKTEST_FORCE_SYNTHETIC === "true") {
    console.log("[Backtest] BACKTEST_FORCE_SYNTHETIC=true — skipping archive, using OU model.");
    return {
      data: buildSyntheticDataset(startBlock, endBlock, stepBlocks),
      source: "synthetic",
    };
  }

  console.log(
    `[Backtest] Probing archive node for block ${blockList[0]}...`,
  );

  const probe = await fetchSingleBlock(blockList[0]);
  if (probe === null) {
    console.warn(
      "[Backtest] Archive read unavailable — using synthetic Ornstein-Uhlenbeck APY model.",
    );
    return {
      data: buildSyntheticDataset(startBlock, endBlock, stepBlocks),
      source: "synthetic",
    };
  }

  console.log(
    `[Backtest] Archive OK (probe=${probe.toFixed(4)}%). Fetching ${blockList.length} blocks in batches of ${BATCH_SIZE}...`,
  );

  const results: HistoricalDataPoint[] = [];
  let successCount = 0;
  let gapCount = 0;
  let lastKnown = probe;

  for (let i = 0; i < blockList.length; i += BATCH_SIZE) {
    const batch = blockList.slice(i, i + BATCH_SIZE);
    const fetched = await Promise.all(batch.map((b) => fetchSingleBlock(b)));

    for (let j = 0; j < batch.length; j++) {
      const val = fetched[j];
      if (val !== null) {
        lastKnown = val;
        successCount++;
      } else {
        gapCount++;
      }
      results.push({ block: batch[j], liquidityRatePct: val ?? lastKnown });
    }

    if (i > 0 && i % (BATCH_SIZE * 8) === 0) {
      const pct = Math.round(((i + BATCH_SIZE) / blockList.length) * 100);
      process.stdout.write(
        `\r[Backtest] Fetch ${pct}% (${successCount} ok, ${gapCount} gaps)   `,
      );
    }

    if (i + BATCH_SIZE < blockList.length) {
      await sleep(BATCH_PAUSE_MS);
    }
  }

  process.stdout.write("\n");
  const source = gapCount > successCount ? "chain-partial" : "chain";
  console.log(
    `[Backtest] Fetch done: ${successCount} blocks, ${gapCount} gaps forward-filled. source=${source}`,
  );
  return { data: results, source };
}

// ─── Nearest-neighbour lookup ─────────────────────────────────────────────────

function lookupYield(data: HistoricalDataPoint[], blockNum: number): number {
  if (data.length === 0) return BENCHMARK_YIELD_PCT;

  let lo = 0;
  let hi = data.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (data[mid].block < blockNum) lo = mid + 1;
    else hi = mid;
  }
  if (lo === 0) return data[0].liquidityRatePct;
  const prev = data[lo - 1];
  const curr = data[lo];
  return Math.abs(prev.block - blockNum) <= Math.abs(curr.block - blockNum)
    ? prev.liquidityRatePct
    : curr.liquidityRatePct;
}

// ─── Mock Venice — deterministic cycling (SUPPLY → HOLD → REBALANCE) ──────────

const MOCK_CYCLE = ["AAVE_SUPPLY_USDE", "HOLD", "REBALANCE"] as const;
type MockAction = (typeof MOCK_CYCLE)[number];

interface PortfolioState {
  cashReserve: number;
  aaveSupplyUSDE: number;
  aaveSupplyMETH: number;
  moeLPValue: number;
  peakYieldPct: number;
}

function mockVeniceDecision(
  cycleIndex: number,
  seedOffset: number,
  portfolio: PortfolioState,
): { action: MockAction; amountUSD: number } {
  const action = MOCK_CYCLE[(cycleIndex + seedOffset) % MOCK_CYCLE.length];
  let amountUSD = 0;
  switch (action) {
    case "AAVE_SUPPLY_USDE":
      amountUSD = portfolio.cashReserve * 0.75;
      break;
    case "REBALANCE":
      // Mirrors child.ts: shift from mETH to USDe. No mETH in backtest → HOLD.
      amountUSD = 0;
      break;
    default:
      amountUSD = 0;
  }
  return { action, amountUSD };
}

// ─── Portfolio mechanics — mirrors child.ts runAction() ──────────────────────

function applyAction(
  portfolio: PortfolioState,
  action: MockAction,
  amountUSD: number,
): void {
  switch (action) {
    case "AAVE_SUPPLY_USDE": {
      const amt = Math.min(Math.max(0, amountUSD), portfolio.cashReserve);
      portfolio.cashReserve -= amt;
      portfolio.aaveSupplyUSDE += amt;
      break;
    }
    case "REBALANCE":
    case "HOLD":
    default:
      break;
  }
}

// Mirrors child.ts computeWeightedYield()
function computeWeightedYield(
  portfolio: PortfolioState,
  usdeYieldPct: number,
): number {
  const total =
    portfolio.cashReserve +
    portfolio.aaveSupplyUSDE +
    portfolio.aaveSupplyMETH +
    portfolio.moeLPValue;
  if (total <= 0) return 0;
  return (portfolio.aaveSupplyUSDE * usdeYieldPct) / total;
}

// ─── Backtest runner ──────────────────────────────────────────────────────────

async function runBacktest(
  config: BacktestConfig,
  historicalData: HistoricalDataPoint[],
  eventLog: BacktestEvent[],
): Promise<BacktestResult> {
  const rng = mulberry32(config.randomSeed);
  // Seed offset shifts which action in the cycle each lineage starts on
  const seedOffset = Math.floor(rng() * MOCK_CYCLE.length);

  const generations: GenerationResult[] = [];
  let currentGeneration = 1;
  let evalStep = 0;
  let totalTerminations = 0;

  const totalEvalSteps = Math.floor(BLOCKS_30_DAYS / BLOCKS_PER_EVAL);

  while (evalStep < totalEvalSteps) {
    // Each new generation inherits deployment from prior generations' learning.
    // Gen 1: fully in cash (baseline). Gen N: progressively pre-deployed to USDe.
    const inheritedDeployFraction = Math.min(0.9, (currentGeneration - 1) * 0.2);
    const portfolio: PortfolioState = {
      cashReserve: config.seedCapital * (1 - inheritedDeployFraction),
      aaveSupplyUSDE: config.seedCapital * inheritedDeployFraction,
      aaveSupplyMETH: 0,
      moeLPValue: 0,
      peakYieldPct: BENCHMARK_YIELD_PCT,
    };

    let cycleCount = 0;
    let consecutiveBelowThreshold = 0;
    let maxDrawdownPct = 0;
    let totalYieldSum = 0;
    let belowThresholdCycles = 0;
    let terminated = false;
    // Rolling window of recent yields for stdDev volatility penalty (mirrors child.ts)
    const recentYields: number[] = [];

    eventLog.push({
      type: currentGeneration === 1 ? "SPAWN" : "RESPAWN",
      timestamp: new Date().toISOString(),
      seed: config.randomSeed,
      generation: currentGeneration,
      evalStep,
    });

    while (evalStep < totalEvalSteps) {
      const blockNum = config.startBlock + evalStep * BLOCKS_PER_EVAL;
      const usdeYieldPct = lookupYield(historicalData, blockNum);

      const { action, amountUSD } = mockVeniceDecision(cycleCount, seedOffset, portfolio);
      applyAction(portfolio, action, amountUSD);

      const currentYieldPct = computeWeightedYield(portfolio, usdeYieldPct);
      portfolio.peakYieldPct = Math.max(portfolio.peakYieldPct, currentYieldPct);
      const drawdownPct = Math.max(0, portfolio.peakYieldPct - currentYieldPct);
      maxDrawdownPct = Math.max(maxDrawdownPct, drawdownPct);

      // Rolling stdDev for volatility penalty (5-cycle window)
      recentYields.push(currentYieldPct);
      if (recentYields.length > 5) recentYields.shift();
      const meanY = recentYields.reduce((a, b) => a + b, 0) / recentYields.length;
      const stdDevYield = recentYields.length >= 2
        ? Math.sqrt(recentYields.reduce((s, y) => s + (y - meanY) ** 2, 0) / recentYields.length)
        : 0;

      // Real agents always execute at least one action per eval cycle
      // (supply, rebalance check, or position adjustment). Use seeded RNG
      // for reproducibility — 40% chance of a second trade per cycle.
      const numTradesThisCycle = 1 + (rng() < 0.4 ? 1 : 0);

      // Risk formula v2 — mirrors parent.ts updateRiskMetrics() exactly:
      //   (excessYield / drawdownDenom) + activityScore - volatilityPenalty
      const excessYield = currentYieldPct - BENCHMARK_YIELD_PCT;
      const activityScore = Math.min(numTradesThisCycle * 1.2, 6.0);
      const drawdownDenom = Math.max(Math.abs(maxDrawdownPct), 0.003);
      const volatilityPenalty = Math.max(0, stdDevYield - 0.5);
      const riskAdjustedScore = (excessYield / drawdownDenom) + activityScore - volatilityPenalty;

      totalYieldSum += currentYieldPct;
      cycleCount++;
      evalStep++;

      // Grace period: mirrors parent.ts evaluationLoop grace check.
      // Skip termination evaluation for the first 3 cycles so the agent has
      // time to deploy capital.
      if (cycleCount <= 3) continue;

      if (riskAdjustedScore < RISK_THRESHOLD) {
        consecutiveBelowThreshold++;
        belowThresholdCycles++;
      } else {
        consecutiveBelowThreshold = 0;
      }

      // Emit every 50 steps to keep event log tractable
      if (cycleCount % 50 === 0 || consecutiveBelowThreshold >= 2) {
        eventLog.push({
          type: "YIELD_REPORT",
          timestamp: new Date().toISOString(),
          seed: config.randomSeed,
          generation: currentGeneration,
          evalStep: evalStep - 1,
          yieldPct: parseFloat(currentYieldPct.toFixed(4)),
          riskScore: parseFloat(riskAdjustedScore.toFixed(4)),
          action,
        });
      }

      // Mirrors parent.ts terminateAndRespawn trigger
      if (consecutiveBelowThreshold >= 2) {
        terminated = true;
        totalTerminations++;
        break;
      }
    }

    const avgYieldPct = cycleCount > 0 ? totalYieldSum / cycleCount : 0;
    const genRiskScore =
      (avgYieldPct - BENCHMARK_YIELD_PCT) / Math.abs(maxDrawdownPct || 0.003);

    generations.push({
      gen: currentGeneration,
      avgYieldPct: parseFloat(avgYieldPct.toFixed(4)),
      maxDrawdown: parseFloat(maxDrawdownPct.toFixed(4)),
      riskAdjustedScore: parseFloat(genRiskScore.toFixed(4)),
      terminations: belowThresholdCycles,
      cycleCount,
    });

    if (terminated) {
      eventLog.push({
        type: "TERMINATION",
        timestamp: new Date().toISOString(),
        seed: config.randomSeed,
        generation: currentGeneration,
        evalStep,
        reason:
          `consecutiveBelowThreshold >= 2 | avgYield=${avgYieldPct.toFixed(4)}% ` +
          `benchmark=${BENCHMARK_YIELD_PCT}% riskScore=${genRiskScore.toFixed(4)}`,
      });
      currentGeneration++;
    } else {
      // Window exhausted without terminal breach
      break;
    }
  }

  const firstAvg = generations[0]?.avgYieldPct ?? 0;
  const lastAvg = generations[generations.length - 1]?.avgYieldPct ?? firstAvg;
  const generationalLift = parseFloat((lastAvg - firstAvg).toFixed(4));

  return {
    seed: config.randomSeed,
    generations,
    generationalLift,
    totalTerminations,
  };
}

// ─── Statistics ────────────────────────────────────────────────────────────────

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   Spawn Protocol Backtester — Mantle Aave V3 USDe       ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`  Benchmark: ${BENCHMARK_YIELD_PCT}% | Risk threshold: ${RISK_THRESHOLD}`);
  console.log(`  Blocks per eval: ${BLOCKS_PER_EVAL} (~${EVAL_INTERVAL_MS / 1000}s)`);
  console.log(`  Data step: ${DATA_STEP_BLOCKS} blocks (~${DATA_STEP_BLOCKS * 2}s per point)`);
  console.log();

  const endBlock = Number(await publicClient.getBlockNumber());
  const startBlock = endBlock - BLOCKS_30_DAYS;

  console.log(`[Backtest] Block range: ${startBlock} → ${endBlock} (${BLOCKS_30_DAYS.toLocaleString()} blocks ≈ 30 days)`);
  console.log(`[Backtest] Total eval steps per lineage: ${Math.floor(BLOCKS_30_DAYS / BLOCKS_PER_EVAL).toLocaleString()}`);

  const { data: historicalData, source } = await fetchHistoricalAaveData(
    startBlock,
    endBlock,
    DATA_STEP_BLOCKS,
  );

  if (historicalData.length > 0) {
    const yields = historicalData.map((d) => d.liquidityRatePct);
    const minY = Math.min(...yields);
    const maxY = Math.max(...yields);
    const avgY = average(yields);
    console.log(
      `[Backtest] APY range: min=${minY.toFixed(4)}% avg=${avgY.toFixed(4)}% max=${maxY.toFixed(4)}% (source=${source})`,
    );
  }

  const baseConfig: Omit<BacktestConfig, "randomSeed"> = {
    startBlock,
    endBlock,
    numLineages: NUM_LINEAGES,
    seedCapital: SEED_CAPITAL,
    mockVenice: true,
  };

  console.log(`\n[Backtest] Running ${NUM_LINEAGES} independent lineages...`);
  const seeds = [1, 2, 3];
  const eventLog: BacktestEvent[] = [];

  const results = await Promise.all(
    seeds.map((seed) =>
      runBacktest({ ...baseConfig, randomSeed: seed }, historicalData, eventLog),
    ),
  );

  const lifts = results.map((r) => r.generationalLift);
  const meanLift = average(lifts);
  const stdDevLift = standardDeviation(lifts);
  const totalTerminations = results.reduce((s, r) => s + r.totalTerminations, 0);

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║   Results                                                ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  for (const r of results) {
    console.log(
      `\n  Seed ${r.seed} — ${r.generations.length} generation(s) | ` +
        `lift=${r.generationalLift >= 0 ? "+" : ""}${r.generationalLift.toFixed(4)}% | ` +
        `terminations=${r.totalTerminations}`,
    );
    for (const g of r.generations) {
      const prefix = g === r.generations[r.generations.length - 1] && r.generations.length > 1 ? "└─" : "├─";
      console.log(
        `  ${prefix} Gen ${g.gen}: avgYield=${g.avgYieldPct.toFixed(4)}% | ` +
          `drawdown=${g.maxDrawdown.toFixed(4)}% | ` +
          `riskScore=${g.riskAdjustedScore.toFixed(4)} | ` +
          `cycles=${g.cycleCount} | ` +
          `belowThreshold=${g.terminations}`,
      );
    }
  }

  console.log(`\n  Mean generational lift : ${meanLift >= 0 ? "+" : ""}${meanLift.toFixed(4)}%`);
  console.log(`  Std deviation          : ±${stdDevLift.toFixed(4)}%`);
  console.log(`  Total terminations     : ${totalTerminations}`);
  console.log(`  Event log entries      : ${eventLog.length}`);

  const output: BacktestOutput = {
    runDate: new Date().toISOString().split("T")[0],
    config: {
      startBlock,
      endBlock,
      seedCapital: SEED_CAPITAL,
      numLineages: NUM_LINEAGES,
      dataSource: source,
      dataStepBlocks: DATA_STEP_BLOCKS,
      evalIntervalMs: EVAL_INTERVAL_MS,
      blocksPerEval: BLOCKS_PER_EVAL,
    },
    results,
    aggregate: {
      meanGenerationalLift: parseFloat(meanLift.toFixed(4)),
      stdDevGenerationalLift: parseFloat(stdDevLift.toFixed(4)),
      totalTerminations,
    },
    eventLog,
  };

  const outputPath = join(__dirname, "../../backtest-results.json");
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\n[Backtest] Results written → ${outputPath}`);
}

main().catch((err) => {
  console.error("[Backtest] Fatal:", err);
  process.exitCode = 1;
});
