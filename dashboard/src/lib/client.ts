import { AnchorProvider, Program, BN } from '@coral-xyz/anchor'
import { Connection, PublicKey } from '@solana/web3.js'
import IDL from '@/idl/swarm_os.json'

/* ─── normalised types ──────────────────────────────── */

export type AgentStatus = 'Active' | 'Scored' | 'Survived' | 'Terminated' | 'Respawned'
export type TaskType    = 'YieldOptimizer' | 'CodeReviewer' | 'DataSynthesizer'

export interface SwarmAccount {
  publicKey: string
  authority: string
  scoringOracle: string
  name: string
  generation: number
  activeAgentCount: number
  totalSpawned: number
  scoringThreshold: number
  treasury: string
  taskType: TaskType
}

export interface AgentAccount {
  publicKey: string
  agentId: number
  swarm: string
  parentId: number | null
  generation: number
  taskType: TaskType
  status: AgentStatus
  score: number
  lineageHash: string
  spawnTimestamp: number
  terminationTimestamp: number
}

export interface LineageMemoryAccount {
  publicKey: string
  agentId: number
  swarm: string
  generation: number
  taskType: TaskType
  failureScore: number
  failureReasonHash: string
  arweaveUri: string
  timestamp: number
}

export interface SwarmEvent {
  type: 'AgentSpawned' | 'AgentScored' | 'AgentSurvived' | 'AgentTerminated' | 'AgentRespawned'
  agentId?: number
  newAgentId?: number
  parentAgentId?: number
  generation?: number
  score?: number
  swarm?: string
  lineageHash?: string
  timestamp: number
  claimedAPY?: number
  actualAPY?: number
  protocol?: string
  reasoning?: string
  inheritedMemories?: number
}

/* ─── helpers ────────────────────────────────────────── */

function bnToNum(v: BN | number | bigint | null | undefined): number {
  if (v == null) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'bigint') return Number(v)
  return (v as BN).toNumber()
}

function decodeStatus(raw: Record<string, unknown>): AgentStatus {
  if ('active'     in raw) return 'Active'
  if ('scored'     in raw) return 'Scored'
  if ('survived'   in raw) return 'Survived'
  if ('terminated' in raw) return 'Terminated'
  if ('respawned'  in raw) return 'Respawned'
  return 'Active'
}

function decodeTaskType(raw: Record<string, unknown>): TaskType {
  if ('yieldOptimizer'  in raw) return 'YieldOptimizer'
  if ('codeReviewer'    in raw) return 'CodeReviewer'
  if ('dataSynthesizer' in raw) return 'DataSynthesizer'
  return 'YieldOptimizer'
}

function decodeHash(arr: number[]): string {
  return Buffer.from(arr).toString('hex')
}

/* ─── read-only dummy wallet ─────────────────────────── */

const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111'

const DUMMY_WALLET = {
  publicKey:           new PublicKey(SYSTEM_PROGRAM_ID),
  signTransaction:     async <T>(tx: T): Promise<T>   => tx,
  signAllTransactions: async <T>(txs: T[]): Promise<T[]> => txs,
}

/* ─── SwarmOSClient ──────────────────────────────────── */

export class SwarmOSClient {
  private program: Program<any>
  readonly connection: Connection

  constructor(rpcUrl: string, _programId: string) {
    this.connection = new Connection(rpcUrl, 'confirmed')
    const provider = new AnchorProvider(
      this.connection,
      DUMMY_WALLET as any,
      { commitment: 'confirmed', skipPreflight: true }
    )
    // Anchor 0.30+: program ID comes from IDL.address — no second argument needed
    this.program = new Program(IDL as any, provider)
  }

  /* ─── Swarm ─── */

  async getSwarm(swarmAddress: string): Promise<SwarmAccount> {
    const pk  = new PublicKey(swarmAddress)
    const raw = await (this.program.account as any)['swarm'].fetch(pk) as any
    return {
      publicKey:        swarmAddress,
      authority:        (raw.authority as PublicKey).toBase58(),
      scoringOracle:    (raw.scoringOracle as PublicKey).toBase58(),
      name:             raw.name as string,
      generation:       bnToNum(raw.generation),
      activeAgentCount: bnToNum(raw.activeAgentCount),
      totalSpawned:     bnToNum(raw.totalSpawned),
      scoringThreshold: raw.scoringThreshold as number,
      treasury:         (raw.treasury as PublicKey).toBase58(),
      taskType:         decodeTaskType(raw.taskType as Record<string, unknown>),
    }
  }

  /* ─── Agents ─── */

  async getAllAgents(swarmAddress: string): Promise<AgentAccount[]> {
    const swarmPk = new PublicKey(swarmAddress)
    // Layout: discriminator(8) + agent_id u64(8) + swarm pubkey(32) → swarm at offset 16
    const results = await (this.program.account as any)['agent'].all([
      { memcmp: { offset: 16, bytes: swarmPk.toBase58() } },
    ]) as Array<{ publicKey: PublicKey; account: any }>

    return results.map(({ publicKey, account: raw }) => ({
      publicKey:            publicKey.toBase58(),
      agentId:              bnToNum(raw.agentId),
      swarm:                (raw.swarm as PublicKey).toBase58(),
      parentId:             raw.parentId != null ? bnToNum(raw.parentId) : null,
      generation:           bnToNum(raw.generation),
      taskType:             decodeTaskType(raw.taskType as Record<string, unknown>),
      status:               decodeStatus(raw.status as Record<string, unknown>),
      score:                raw.score as number,
      lineageHash:          decodeHash(raw.lineageHash as number[]),
      spawnTimestamp:       bnToNum(raw.spawnTimestamp),
      terminationTimestamp: bnToNum(raw.terminationTimestamp),
    }))
  }

  /* ─── LineageMemory ─── */

  async getAllLineageMemories(swarmAddress: string): Promise<LineageMemoryAccount[]> {
    const swarmPk = new PublicKey(swarmAddress)
    // Same layout as Agent — swarm at offset 16
    const results = await (this.program.account as any)['lineageMemory'].all([
      { memcmp: { offset: 16, bytes: swarmPk.toBase58() } },
    ]) as Array<{ publicKey: PublicKey; account: any }>

    return results
      .map(({ publicKey, account: raw }) => ({
        publicKey:         publicKey.toBase58(),
        agentId:           bnToNum(raw.agentId),
        swarm:             (raw.swarm as PublicKey).toBase58(),
        generation:        bnToNum(raw.generation),
        taskType:          decodeTaskType(raw.taskType as Record<string, unknown>),
        failureScore:      raw.failureScore as number,
        failureReasonHash: decodeHash(raw.failureReasonHash as number[]),
        arweaveUri:        raw.arweaveUri as string,
        timestamp:         bnToNum(raw.timestamp),
      }))
      .sort((a, b) => b.timestamp - a.timestamp)
  }

  /* ─── Events ─── */

  subscribeToEvents(onEvent: (e: SwarmEvent) => void): () => void {
    const now = () => Date.now()
    const ids: number[] = []

    ids.push(this.program.addEventListener('AgentSpawned', (e: any) =>
      onEvent({
        type:       'AgentSpawned',
        agentId:    bnToNum(e.agentId),
        generation: bnToNum(e.generation),
        swarm:      (e.swarm as PublicKey | undefined)?.toBase58(),
        timestamp:  now(),
      })
    ))

    ids.push(this.program.addEventListener('AgentScored', (e: any) =>
      onEvent({ type: 'AgentScored', agentId: bnToNum(e.agentId), score: e.score as number, timestamp: now() })
    ))

    ids.push(this.program.addEventListener('AgentSurvived', (e: any) =>
      onEvent({ type: 'AgentSurvived', agentId: bnToNum(e.agentId), score: e.score as number, timestamp: now() })
    ))

    ids.push(this.program.addEventListener('AgentTerminated', (e: any) =>
      onEvent({
        type:       'AgentTerminated',
        agentId:    bnToNum(e.agentId),
        score:      e.score as number,
        generation: bnToNum(e.generation),
        timestamp:  now(),
      })
    ))

    ids.push(this.program.addEventListener('AgentRespawned', (e: any) =>
      onEvent({
        type:          'AgentRespawned',
        newAgentId:    bnToNum(e.newAgentId),
        parentAgentId: bnToNum(e.parentAgentId),
        lineageHash:   e.lineageHash ? decodeHash(e.lineageHash as number[]) : undefined,
        timestamp:     now(),
      })
    ))

    return () => {
      ids.forEach((id) => void this.program.removeEventListener(id))
    }
  }
}

/* ─── singleton (client-side only) ──────────────────── */

let _client: SwarmOSClient | null = null

export function getClient(): SwarmOSClient {
  if (!_client) {
    _client = new SwarmOSClient(
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL       ?? 'https://api.devnet.solana.com',
      process.env.NEXT_PUBLIC_SWARM_PROGRAM_ID     ?? 'D9moMaWzJw3LVxnZkiXS7xrTUHmF4n3hJeDWCvbB7B1a'
    )
  }
  return _client
}
