export type ChildState = {
  pid: number;
  contractAddress: string;
  walletAddress: string;
  agentId: string;
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
  status: "ACTIVE" | "TERMINATED" | "RESPAWNING";
  inheritanceConstraints?: string[];
  ipfsCid?: string;
  mantleSpawnTxHash: string;
  mantleRecallTxHash?: string;
};

export type SwarmEvent = {
  type: "SPAWN" | "YIELD_REPORT" | "TERMINATION" | "RESPAWN";
  timestamp: string;
  lineageKey: string;
  generation: number;
  agentLabel: string;
  txHash?: string;
  contractAddress?: string;
  currentYieldPct?: number;
  actionTaken?: string;
  failureReason?: string;
  ipfsCid?: string;
  recallTxHash?: string;
  newAgentLabel?: string;
  lineageDepth?: number;
  spawnTxHash?: string;
  inheritanceConstraints?: string[];
};

export type GenerationStat = {
  generation: number;
  agentCount: number;
  terminatedCount: number;
  avgRiskAdjustedScore: number;
  avgYieldPct: number;
  benchmarkYieldPct: number;
};
