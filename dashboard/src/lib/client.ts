/* eslint-disable @typescript-eslint/no-explicit-any */
import { AnchorProvider, Program, BN } from '@coral-xyz/anchor'
import { Connection, PublicKey } from '@solana/web3.js'
import { Buffer } from 'buffer'
import IDL from '@/idl/swarm_os.json'
import { SOLANA_RPC_URL, SWARM_PROGRAM_ID } from '@/lib/config'

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
  treasuryMint: string
  treasuryBalance: number | null
  treasuryRawAmount: string | null
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
  claimedApyBps: number
  claimedApy: number
  claimedProtocol: string
  taskOutputHash: string
  agentUsdcAta: string
  agentUsdcBalance: number | null
  agentUsdcRawAmount: string | null
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
  claimedApyBps?: number
  claimedAPY?: number
  actualAPY?: number
  protocol?: string
  taskOutputHash?: string
  agentUsdcAta?: string
  agentUsdcBalance?: number | null
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

function decodeHash(arr?: number[] | Uint8Array | Buffer): string {
  if (!arr) return ''.padStart(64, '0')
  return Buffer.from(arr).toString('hex')
}

function bpsToPercent(bps: number): number {
  return Math.round((bps / 100) * 100) / 100
}

function rawTokenAmount(info: { data: Buffer | Uint8Array } | null): { raw: string; ui: number } | null {
  if (!info || info.data.length < 72) return null
  const amount = Buffer.from(info.data).readBigUInt64LE(64)
  return {
    raw: amount.toString(),
    ui: Number(amount) / 1_000_000,
  }
}

function decodeTaskVariant(variant: number | undefined): TaskType {
  switch (variant) {
    case 1: return 'CodeReviewer'
    case 2: return 'DataSynthesizer'
    case 0:
    default: return 'YieldOptimizer'
  }
}

function decodeStatusVariant(variant: number | undefined): AgentStatus {
  switch (variant) {
    case 1: return 'Scored'
    case 2: return 'Survived'
    case 3: return 'Terminated'
    case 4: return 'Respawned'
    case 0:
    default: return 'Active'
  }
}

function readU64(data: Buffer, offset: number): number {
  if (offset + 8 > data.length) return 0
  return Number(data.readBigUInt64LE(offset))
}

function readI64(data: Buffer, offset: number): number {
  if (offset + 8 > data.length) return 0
  return Number(data.readBigInt64LE(offset))
}

function readOptionU64(data: Buffer, offset: number): { value: number | null; nextOffset: number } {
  if (offset >= data.length || data[offset] === 0) {
    return { value: null, nextOffset: offset + 1 }
  }
  return { value: readU64(data, offset + 1), nextOffset: offset + 9 }
}

function readBorshString(
  data: Buffer,
  offset: number,
  maxLength: number
): { value: string; nextOffset: number } | null {
  if (offset + 4 > data.length) return null
  const length = data.readUInt32LE(offset)
  if (length > maxLength || offset + 4 + length > data.length) return null

  const start = offset + 4
  const end = start + length
  return {
    value: data.subarray(start, end).toString('utf8'),
    nextOffset: end,
  }
}

function hashFromSlice(data: Buffer, offset: number): string {
  return Buffer.from(data.subarray(offset, offset + 32)).toString('hex')
}

async function getMultipleAccountsInfoBatched(
  connection: Connection,
  addresses: PublicKey[],
  commitment: 'confirmed' = 'confirmed'
) {
  const out: Awaited<ReturnType<Connection['getMultipleAccountsInfo']>> = []
  for (let i = 0; i < addresses.length; i += 100) {
    const chunk = addresses.slice(i, i + 100)
    const infos = await connection.getMultipleAccountsInfo(chunk, commitment).catch(() => [])
    out.push(...infos)
  }
  return out
}

/* ─── read-only dummy wallet ─────────────────────────── */

const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111'
const TOKEN_PROGRAM_ID  = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
const DEVNET_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
const AGENT_DISCRIMINATOR = Buffer.from([47, 166, 112, 147, 155, 197, 86, 7])
const LINEAGE_DISCRIMINATOR = Buffer.from([27, 42, 154, 248, 7, 100, 124, 213])
const AGENT_DISCRIMINATOR_BASE58 = '8yGSUtV5BEn'
const LINEAGE_DISCRIMINATOR_BASE58 = '5YYojD2jAz8'

const DUMMY_WALLET = {
  publicKey:           new PublicKey(SYSTEM_PROGRAM_ID),
  signTransaction:     async <T>(tx: T): Promise<T>   => tx,
  signAllTransactions: async <T>(txs: T[]): Promise<T[]> => txs,
}

/* ─── SwarmOSClient ──────────────────────────────────── */

export class SwarmOSClient {
  private program: Program<any>
  private programId: PublicKey
  readonly connection: Connection

  constructor(rpcUrl: string, programId: string) {
    this.connection = new Connection(rpcUrl, 'confirmed')
    this.programId = new PublicKey(programId)
    const provider = new AnchorProvider(
      this.connection,
      DUMMY_WALLET as any,
      { commitment: 'confirmed', skipPreflight: true }
    )
    // Anchor 0.30+: program ID comes from IDL.address — no second argument needed
    this.program = new Program(IDL as any, provider)
  }

  private defaultUsdcMint(): PublicKey {
    return new PublicKey(
      process.env.NEXT_PUBLIC_USDC_MINT_DEVNET ??
      process.env.NEXT_PUBLIC_USDC_MINT ??
      DEVNET_USDC_MINT
    )
  }

  private agentUsdcAta(agent: PublicKey, mint: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [agent.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    )[0]
  }

  private async tokenAccountBalance(address: PublicKey): Promise<{ raw: string | null; ui: number | null }> {
    try {
      const balance = await this.connection.getTokenAccountBalance(address, 'confirmed')
      return {
        raw: balance.value.amount,
        ui: balance.value.uiAmount,
      }
    } catch {
      return { raw: null, ui: null }
    }
  }

  private async tokenAccountMint(address: PublicKey): Promise<PublicKey> {
    try {
      const info = await this.connection.getParsedAccountInfo(address, 'confirmed')
      const data = info.value?.data as any
      const mint = data?.parsed?.info?.mint
      if (typeof mint === 'string') return new PublicKey(mint)
    } catch {
      // fall through to configured devnet mint
    }
    return this.defaultUsdcMint()
  }

  /* ─── Swarm ─── */

  async getSwarm(swarmAddress: string): Promise<SwarmAccount> {
    const pk  = new PublicKey(swarmAddress)
    const raw = await (this.program.account as any)['swarm'].fetch(pk) as any
    const treasuryPk = raw.treasury as PublicKey
    const [treasuryMint, treasuryBalance] = await Promise.all([
      this.tokenAccountMint(treasuryPk),
      this.tokenAccountBalance(treasuryPk),
    ])

    return {
      publicKey:        swarmAddress,
      authority:        (raw.authority as PublicKey).toBase58(),
      scoringOracle:    (raw.scoringOracle as PublicKey).toBase58(),
      name:             raw.name as string,
      generation:       bnToNum(raw.generation),
      activeAgentCount: bnToNum(raw.activeAgentCount),
      totalSpawned:     bnToNum(raw.totalSpawned),
      scoringThreshold: raw.scoringThreshold as number,
      treasury:         treasuryPk.toBase58(),
      treasuryMint:     treasuryMint.toBase58(),
      treasuryBalance:  treasuryBalance.ui,
      treasuryRawAmount: treasuryBalance.raw,
      taskType:         decodeTaskType(raw.taskType as Record<string, unknown>),
    }
  }

  /* ─── Agents ─── */

  async getAllAgents(swarmAddress: string): Promise<AgentAccount[]> {
    const swarmPk = new PublicKey(swarmAddress)
    let usdcMint = this.defaultUsdcMint()
    try {
      const swarmRaw = await (this.program.account as any)['swarm'].fetch(swarmPk) as any
      usdcMint = await this.tokenAccountMint(swarmRaw.treasury as PublicKey)
    } catch {
      // keep configured fallback mint
    }

    // Layout: discriminator(8) + agent_id u64(8) + swarm pubkey(32) → swarm at offset 16
    let results: Array<{ publicKey: PublicKey; account: any }> = []
    try {
      results = await (this.program.account as any)['agent'].all([
        { memcmp: { offset: 16, bytes: swarmPk.toBase58() } },
      ]) as Array<{ publicKey: PublicKey; account: any }>
    } catch {
      return this.getAllAgentsRaw(swarmPk, usdcMint)
    }

    const parsed = results.map(({ publicKey, account: raw }) => {
      const claimedApyBps = bnToNum(raw.claimedApyBps)
      const agentUsdcAta = this.agentUsdcAta(publicKey, usdcMint)

      return {
        publicKey,
        account: raw,
        claimedApyBps,
        agentUsdcAta,
      }
    })

    if (parsed.length === 0) return []

    const ataInfos = await getMultipleAccountsInfoBatched(
      this.connection,
      parsed.map((entry) => entry.agentUsdcAta)
    )

    return parsed.map(({ publicKey, account: raw, claimedApyBps, agentUsdcAta }, index) => {
      const tokenAmount = rawTokenAmount(ataInfos[index] ?? null)
      return {
      publicKey:            publicKey.toBase58(),
      agentId:              bnToNum(raw.agentId),
      swarm:                (raw.swarm as PublicKey).toBase58(),
      parentId:             raw.parentId != null ? bnToNum(raw.parentId) : null,
      generation:           bnToNum(raw.generation),
      taskType:             decodeTaskType(raw.taskType as Record<string, unknown>),
      status:               decodeStatus(raw.status as Record<string, unknown>),
      score:                raw.score as number,
      lineageHash:          decodeHash(raw.lineageHash as number[]),
      claimedApyBps,
      claimedApy:           bpsToPercent(claimedApyBps),
      claimedProtocol:      raw.claimedProtocol as string ?? '',
      taskOutputHash:       decodeHash(raw.taskOutputHash as number[]),
      agentUsdcAta:         agentUsdcAta.toBase58(),
      agentUsdcBalance:     tokenAmount?.ui ?? null,
      agentUsdcRawAmount:   tokenAmount?.raw ?? null,
      spawnTimestamp:       bnToNum(raw.spawnTimestamp),
      terminationTimestamp: bnToNum(raw.terminationTimestamp),
      }
    })
  }

  /* ─── LineageMemory ─── */

  async getAllLineageMemories(swarmAddress: string): Promise<LineageMemoryAccount[]> {
    const swarmPk = new PublicKey(swarmAddress)
    // Same layout as Agent — swarm at offset 16
    let results: Array<{ publicKey: PublicKey; account: any }> = []
    try {
      results = await (this.program.account as any)['lineageMemory'].all([
        { memcmp: { offset: 16, bytes: swarmPk.toBase58() } },
      ]) as Array<{ publicKey: PublicKey; account: any }>
    } catch {
      return this.getAllLineageMemoriesRaw(swarmPk)
    }

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

  private async getAllAgentsRaw(swarmPk: PublicKey, usdcMint: PublicKey): Promise<AgentAccount[]> {
    const results = await this.connection.getProgramAccounts(this.programId, {
      filters: [
        { memcmp: { offset: 0, bytes: AGENT_DISCRIMINATOR_BASE58 } },
        { memcmp: { offset: 16, bytes: swarmPk.toBase58() } },
      ],
    })

    const parsed = results
      .map(({ pubkey, account }) => this.decodeAgentRaw(pubkey, account.data, usdcMint))
      .filter((agent): agent is AgentAccount => agent !== null)

    if (parsed.length === 0) return []

    const ataInfos = await getMultipleAccountsInfoBatched(
      this.connection,
      parsed.map((agent) => new PublicKey(agent.agentUsdcAta))
    )

    return parsed.map((agent, index) => {
      const tokenAmount = rawTokenAmount(ataInfos[index] ?? null)
      return {
        ...agent,
        agentUsdcBalance: tokenAmount?.ui ?? null,
        agentUsdcRawAmount: tokenAmount?.raw ?? null,
      }
    })
  }

  private decodeAgentRaw(
    publicKey: PublicKey,
    dataLike: Buffer | Uint8Array,
    usdcMint: PublicKey
  ): AgentAccount | null {
    const data = Buffer.from(dataLike)
    if (data.length < 117 || !data.subarray(0, 8).equals(AGENT_DISCRIMINATOR)) return null

    try {
      const parent = readOptionU64(data, 48)
      let cursor = parent.nextOffset

      const generation = readU64(data, cursor); cursor += 8
      const taskType = decodeTaskVariant(data[cursor]); cursor += 1
      const status = decodeStatusVariant(data[cursor]); cursor += 1
      const score = data[cursor] ?? 0; cursor += 1
      const lineageHash = hashFromSlice(data, cursor); cursor += 32

      let claimedApyBps = 0
      let claimedProtocol = ''
      let taskOutputHash = ''.padStart(64, '0')
      let spawnTimestampOffset = cursor

      if (data.length >= 187) {
        claimedApyBps = data.readUInt16LE(cursor)
        cursor += 2
        const protocol = readBorshString(data, cursor, 32)
        if (protocol) {
          claimedProtocol = protocol.value
          cursor = protocol.nextOffset
          taskOutputHash = hashFromSlice(data, cursor)
          cursor += 32
          spawnTimestampOffset = cursor
        }
      }

      const agentUsdcAta = this.agentUsdcAta(publicKey, usdcMint)

      return {
        publicKey: publicKey.toBase58(),
        agentId: readU64(data, 8),
        swarm: new PublicKey(data.subarray(16, 48)).toBase58(),
        parentId: parent.value,
        generation,
        taskType,
        status,
        score,
        lineageHash,
        claimedApyBps,
        claimedApy: bpsToPercent(claimedApyBps),
        claimedProtocol,
        taskOutputHash,
        agentUsdcAta: agentUsdcAta.toBase58(),
        agentUsdcBalance: null,
        agentUsdcRawAmount: null,
        spawnTimestamp: readI64(data, spawnTimestampOffset),
        terminationTimestamp: readI64(data, spawnTimestampOffset + 8),
      }
    } catch {
      return null
    }
  }

  private async getAllLineageMemoriesRaw(swarmPk: PublicKey): Promise<LineageMemoryAccount[]> {
    const results = await this.connection.getProgramAccounts(this.programId, {
      filters: [
        { memcmp: { offset: 0, bytes: LINEAGE_DISCRIMINATOR_BASE58 } },
        { memcmp: { offset: 16, bytes: swarmPk.toBase58() } },
      ],
    })

    return results
      .map(({ pubkey, account }) => this.decodeLineageRaw(pubkey, account.data))
      .filter((memory): memory is LineageMemoryAccount => memory !== null)
      .sort((a, b) => b.timestamp - a.timestamp)
  }

  private decodeLineageRaw(
    publicKey: PublicKey,
    dataLike: Buffer | Uint8Array
  ): LineageMemoryAccount | null {
    const data = Buffer.from(dataLike)
    if (data.length < 95 || !data.subarray(0, 8).equals(LINEAGE_DISCRIMINATOR)) return null

    try {
      const arweaveUri = readBorshString(data, 90, 100)
      if (!arweaveUri) return null

      return {
        publicKey: publicKey.toBase58(),
        agentId: readU64(data, 8),
        swarm: new PublicKey(data.subarray(16, 48)).toBase58(),
        generation: readU64(data, 48),
        taskType: decodeTaskVariant(data[56]),
        failureScore: data[57] ?? 0,
        failureReasonHash: hashFromSlice(data, 58),
        arweaveUri: arweaveUri.value,
        timestamp: readI64(data, arweaveUri.nextOffset),
      }
    } catch {
      return null
    }
  }

  /* ─── Events ─── */

  subscribeToEvents(onEvent: (e: SwarmEvent) => void): () => void {
    const now = () => Date.now()
    const ids: number[] = []

    ids.push(this.program.addEventListener('AgentSpawned', (e: any) =>
      {
        const claimedApyBps = bnToNum(e.claimedApyBps)
        onEvent({
          type:          'AgentSpawned',
          agentId:       bnToNum(e.agentId),
          generation:    bnToNum(e.generation),
          swarm:         (e.swarm as PublicKey | undefined)?.toBase58(),
          claimedApyBps,
          claimedAPY:    bpsToPercent(claimedApyBps),
          timestamp:     now(),
        })
      }
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
      SOLANA_RPC_URL,
      SWARM_PROGRAM_ID
    )
  }
  return _client
}
