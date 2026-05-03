import { getAaveYield, supplyToAave, withdrawFromAave } from "./aave.js";
import { buildAncestorContext } from "./lineage.js";
import { getMoeLPAPY, getMoeLPValue } from "./merchant-moe.js";
import { executeYieldReasoning } from "./venice.js";
import type { ChildIPCReport, YieldAction } from "./types.js";

export type ChildRuntimeConfig = {
  lineageKey: string;
  generation: number;
  contractAddress: string;
  walletAddress: string;
  agentId: string;
  benchmarkYieldPct: number;
  cycleIntervalMs: number;
  spawnTxHash: string;
  privateKey?: `0x${string}`;
  dryRun: boolean;
};

type ChildReportMessage = {
  type: "YIELD_REPORT";
  report: ChildIPCReport;
  cycleCount: number;
  actionTaken: YieldAction;
  rationale: string;
};

type ChildErrorMessage = {
  type: "ERROR";
  walletAddress: string;
  error: string;
  timestamp: number;
};

type PortfolioState = {
  cashReserve: number;
  aaveSupplyUSDE: number;
  aaveSupplyMETH: number;
  moeLPValue: number;
  peakYieldPct: number;
};

const DEFAULT_PORTFOLIO_USD = Number(process.env.CHILD_STARTING_USD || "1000");

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hashSeed(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function simulatedYield(base: number, cycleCount: number, seed: number, amplitude: number) {
  const wave = Math.sin((cycleCount + seed % 7) / 2.7) * amplitude;
  return Math.max(0.1, base + wave);
}

function computeWeightedYield(portfolio: PortfolioState, yields: { usde: number; meth: number; moe: number }) {
  const deployed =
    portfolio.aaveSupplyUSDE + portfolio.aaveSupplyMETH + portfolio.moeLPValue;
  const total = deployed + portfolio.cashReserve;
  if (total <= 0) return 0;

  const weighted =
    portfolio.aaveSupplyUSDE * yields.usde +
    portfolio.aaveSupplyMETH * yields.meth +
    portfolio.moeLPValue * yields.moe;
  return weighted / total;
}

function clampAmount(amount: number, min = 0, max = Number.POSITIVE_INFINITY) {
  if (!Number.isFinite(amount)) return min;
  return Math.max(min, Math.min(max, amount));
}

async function safeGetAaveYield(
  asset: "USDE" | "METH",
  fallback: number
): Promise<number> {
  try {
    return await getAaveYield(asset);
  } catch {
    return fallback;
  }
}

async function runAction(
  config: ChildRuntimeConfig,
  portfolio: PortfolioState,
  action: YieldAction,
  amountUSD: number
) {
  const liveWritesEnabled =
    process.env.ALLOW_LIVE_CHILD_WRITES === "true" &&
    !config.dryRun &&
    !!config.privateKey;

  switch (action) {
    case "AAVE_SUPPLY_USDE": {
      const amount = clampAmount(amountUSD, 0, portfolio.cashReserve);
      if (amount <= 0) return;
      if (liveWritesEnabled) {
        await supplyToAave(config.privateKey!, "USDE", amount);
      }
      portfolio.cashReserve -= amount;
      portfolio.aaveSupplyUSDE += amount;
      return;
    }
    case "AAVE_SUPPLY_METH": {
      const amount = clampAmount(amountUSD, 0, portfolio.cashReserve);
      if (amount <= 0) return;
      if (liveWritesEnabled) {
        await supplyToAave(config.privateKey!, "METH", amount);
      }
      portfolio.cashReserve -= amount;
      portfolio.aaveSupplyMETH += amount;
      return;
    }
    case "AAVE_WITHDRAW_USDE": {
      const amount = clampAmount(amountUSD, 0, portfolio.aaveSupplyUSDE);
      if (amount <= 0) return;
      if (liveWritesEnabled) {
        await withdrawFromAave(config.privateKey!, "USDE", amount);
      }
      portfolio.aaveSupplyUSDE -= amount;
      portfolio.cashReserve += amount;
      return;
    }
    case "AAVE_WITHDRAW_METH": {
      const amount = clampAmount(amountUSD, 0, portfolio.aaveSupplyMETH);
      if (amount <= 0) return;
      if (liveWritesEnabled) {
        await withdrawFromAave(config.privateKey!, "METH", amount);
      }
      portfolio.aaveSupplyMETH -= amount;
      portfolio.cashReserve += amount;
      return;
    }
    case "MOE_ADD_LIQUIDITY": {
      const amount = clampAmount(amountUSD, 0, portfolio.cashReserve);
      portfolio.cashReserve -= amount;
      portfolio.moeLPValue += amount;
      return;
    }
    case "MOE_REMOVE_LIQUIDITY": {
      const amount = clampAmount(amountUSD, 0, portfolio.moeLPValue);
      portfolio.moeLPValue -= amount;
      portfolio.cashReserve += amount;
      return;
    }
    case "REBALANCE": {
      const shift = clampAmount(amountUSD, 0, portfolio.aaveSupplyMETH);
      portfolio.aaveSupplyMETH -= shift;
      portfolio.aaveSupplyUSDE += shift;
      return;
    }
    case "HOLD":
    default:
      return;
  }
}

export async function runChildProcess(config: ChildRuntimeConfig) {
  const seed = hashSeed(`${config.lineageKey}:${config.generation}:${config.walletAddress}`);
  const portfolio: PortfolioState = {
    cashReserve: DEFAULT_PORTFOLIO_USD * 0.3,
    aaveSupplyUSDE: DEFAULT_PORTFOLIO_USD * 0.5,
    aaveSupplyMETH: DEFAULT_PORTFOLIO_USD * 0.2,
    moeLPValue: 0,
    peakYieldPct: config.benchmarkYieldPct,
  };

  const ancestorContext = await buildAncestorContext(config.lineageKey);
  const systemPrompt = [
    `You are Spawn Protocol child lineage ${config.lineageKey} generation ${config.generation} on Mantle mainnet.`,
    `Optimize for risk-adjusted yield above the benchmark of ${config.benchmarkYieldPct.toFixed(4)}%.`,
    "You may use Aave USDe (Ethena synthetic dollar), Aave mETH, and Merchant Moe read-only signals. Merchant Moe writes remain disabled in this phase.",
    ancestorContext,
  ].join("\n\n");

  console.log(`[Child:${config.lineageKey}-v${config.generation}] System prompt:\n${systemPrompt}`);

  let active = true;
  let cycleCount = 0;

  const shutdown = () => {
    active = false;
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  while (active) {
    cycleCount += 1;

    try {
      const baseUSDE = 7.47 + config.generation * 0.12;
      const baseMETH = 2.15 + config.generation * 0.08;
      const fallbackUSDE = simulatedYield(baseUSDE, cycleCount, seed, 0.32);
      const fallbackMETH = simulatedYield(baseMETH, cycleCount, seed + 17, 0.28);

      const aaveUSDEYield = await safeGetAaveYield("USDE", fallbackUSDE);
      const aaveMETHYield = await safeGetAaveYield("METH", fallbackMETH);
      const moeLPYield = await getMoeLPAPY();
      portfolio.moeLPValue = await getMoeLPValue(config.walletAddress);

      const totalPortfolioUSD =
        portfolio.cashReserve +
        portfolio.aaveSupplyUSDE +
        portfolio.aaveSupplyMETH +
        portfolio.moeLPValue;

      const decision = await executeYieldReasoning(systemPrompt, {
        aaveUSDEYield,
        aaveMETHYield,
        moeLPYield,
        currentAaveUSDE: portfolio.aaveSupplyUSDE,
        currentAaveMETH: portfolio.aaveSupplyMETH,
        currentMoeLP: portfolio.moeLPValue,
        totalPortfolioUSD,
      });

      await runAction(config, portfolio, decision.action, decision.amountUSD);

      const currentYieldPct = computeWeightedYield(portfolio, {
        usde: aaveUSDEYield,
        meth: aaveMETHYield,
        moe: moeLPYield,
      });
      portfolio.peakYieldPct = Math.max(portfolio.peakYieldPct, currentYieldPct);
      const drawdownPct = Math.max(0, portfolio.peakYieldPct - currentYieldPct);

      const report: ChildIPCReport = {
        type: "YIELD_REPORT",
        walletAddress: config.walletAddress,
        currentYieldPct,
        drawdownPct,
        positionSummary:
          `cash=$${portfolio.cashReserve.toFixed(2)}, ` +
          `aaveUSDE=$${portfolio.aaveSupplyUSDE.toFixed(2)}, ` +
          `aaveMETH=$${portfolio.aaveSupplyMETH.toFixed(2)}, ` +
          `moeLP=$${portfolio.moeLPValue.toFixed(2)}, ` +
          `action=${decision.action}`,
        aaveSupplyUSDE: portfolio.aaveSupplyUSDE,
        aaveSupplyMETH: portfolio.aaveSupplyMETH,
        moeLPValue: portfolio.moeLPValue,
        timestamp: Date.now(),
      };

      const message: ChildReportMessage = {
        type: "YIELD_REPORT",
        report,
        cycleCount,
        actionTaken: decision.action,
        rationale: decision.rationale,
      };

      if (process.send) {
        process.send(message);
      } else {
        console.log(`[Child:${config.lineageKey}-v${config.generation}]`, message);
      }
    } catch (error: any) {
      const message: ChildErrorMessage = {
        type: "ERROR",
        walletAddress: config.walletAddress,
        error: error?.message ?? String(error),
        timestamp: Date.now(),
      };

      if (process.send) {
        process.send(message);
      } else {
        console.error(`[Child:${config.lineageKey}-v${config.generation}]`, message.error);
      }
    }

    if (!active) break;
    await sleep(config.cycleIntervalMs);
  }
}

export function parseChildConfig(raw?: string): ChildRuntimeConfig {
  if (!raw) {
    throw new Error("CHILD_CONFIG is required");
  }
  const config = JSON.parse(raw) as ChildRuntimeConfig;

  const childPrivateKey = process.env.CHILD_PRIVATE_KEY;
  if (childPrivateKey) {
    config.privateKey = (childPrivateKey.startsWith("0x") ? childPrivateKey : `0x${childPrivateKey}`) as `0x${string}`;
  }
  if (process.env.CHILD_WALLET_ADDRESS?.startsWith("0x")) {
    config.walletAddress = process.env.CHILD_WALLET_ADDRESS;
  }
  if (process.env.CHILD_CONTRACT_ADDRESS?.startsWith("0x")) {
    config.contractAddress = process.env.CHILD_CONTRACT_ADDRESS;
  }
  if (process.env.ALLOW_LIVE_CHILD_WRITES === "true" && !config.dryRun && !config.privateKey) {
    throw new Error("CHILD_PRIVATE_KEY is required for live child writes");
  }

  return config;
}

export async function startChildFromEnv() {
  const config = parseChildConfig(process.env.CHILD_CONFIG);
  await runChildProcess(config);
}

if (import.meta.url === `file://${process.argv[1]}` && process.env.CHILD_CONFIG) {
  startChildFromEnv().catch((error) => {
    console.error("[Child] Fatal:", error);
    process.exitCode = 1;
  });
}
