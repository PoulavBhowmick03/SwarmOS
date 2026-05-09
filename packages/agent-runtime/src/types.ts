export type AgentStatus = 'Active' | 'Scored' | 'Survived' | 'Terminated' | 'Respawned'
export type TaskType = 'YieldOptimizer' | 'CodeReviewer' | 'DataSynthesizer'

export interface AgentAccount {
  agentId: number
  swarm: string
  parentId: number | null
  generation: number
  taskType: TaskType
  status: AgentStatus
  score: number
  lineageHash: Buffer
  spawnTimestamp: number
  terminationTimestamp: number | null
}

export interface LineageMemory {
  agentId: number
  generation: number
  taskType: TaskType
  failureScore: number
  failureReasonHash: Buffer
  arweaveUri: string
  timestamp: number
}

export interface SwarmConfig {
  name: string
  scoringThreshold: number
  taskType: TaskType
  agentsPerGeneration: number
  maxGenerations: number
}
