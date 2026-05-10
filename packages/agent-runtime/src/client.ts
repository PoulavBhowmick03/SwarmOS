import { AnchorProvider, BN, Idl, Program, Wallet } from '@coral-xyz/anchor'
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
  TransactionSignature
} from '@solana/web3.js'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync
} from '@solana/spl-token'
import fs from 'fs'
import path from 'path'
import { AgentAccount, AgentStatus, LineageMemory, SwarmConfig, TaskType } from './types'

type AnyProgram = Program<Idl> & Record<string, any>

const DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
const AGENT_DISCRIMINATOR = Buffer.from([47, 166, 112, 147, 155, 197, 86, 7])
const LINEAGE_DISCRIMINATOR = Buffer.from([27, 42, 154, 248, 7, 100, 124, 213])
const AGENT_DISCRIMINATOR_BASE58 = '8yGSUtV5BEn'
const LINEAGE_DISCRIMINATOR_BASE58 = '5YYojD2jAz8'

export interface SpawnAgentClaim {
  claimedApyBps: number
  claimedProtocol: string
  taskOutputHash: Buffer
}

function keypairToAnchorWallet(keypair: Keypair): Wallet {
  return {
    publicKey: keypair.publicKey,
    signTransaction: async <T extends Transaction>(tx: T): Promise<T> => {
      tx.partialSign(keypair)
      return tx
    },
    signAllTransactions: async <T extends Transaction>(txs: T[]): Promise<T[]> => {
      return txs.map((tx) => {
        tx.partialSign(keypair)
        return tx
      })
    }
  } as Wallet
}

function u64Seed(value: number): Buffer {
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64LE(BigInt(value))
  return buffer
}

function toPublicKey(value: PublicKey | string): PublicKey {
  return typeof value === 'string' ? new PublicKey(value) : value
}

function ensureHash32(hash?: Buffer): number[] {
  const out = Buffer.alloc(32)
  if (hash) {
    Buffer.from(hash).copy(out, 0, 0, Math.min(32, hash.length))
  }
  return Array.from(out)
}

function normalizeSpawnClaim(claim?: SpawnAgentClaim): SpawnAgentClaim {
  return {
    claimedApyBps: Math.max(0, Math.min(10_000, Math.round(claim?.claimedApyBps ?? 0))),
    claimedProtocol: (claim?.claimedProtocol || 'unknown').slice(0, 32),
    taskOutputHash: claim?.taskOutputHash ?? Buffer.alloc(32)
  }
}

function numberFromAnchor(value: any, fallback = 0): number {
  if (value == null) return fallback
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  if (BN.isBN(value)) return value.toNumber()
  if (typeof value.toNumber === 'function') return value.toNumber()
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function bufferFromAnchor(value: any): Buffer {
  if (!value) return Buffer.alloc(32)
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value)
  if (Array.isArray(value)) return Buffer.from(value)
  return Buffer.alloc(32)
}

function enumKey(value: any): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object') return Object.keys(value)[0] ?? null
  return null
}

function normalizeTaskType(value: any): TaskType {
  const key = enumKey(value)
  switch (key?.toLowerCase()) {
    case 'yieldoptimizer':
    case 'yield_optimizer':
    case 'yield':
      return 'YieldOptimizer'
    case 'codereviewer':
    case 'code_reviewer':
    case 'reviewer':
      return 'CodeReviewer'
    case 'datasynthesizer':
    case 'data_synthesizer':
    case 'data':
      return 'DataSynthesizer'
    default:
      return 'YieldOptimizer'
  }
}

function normalizeStatus(value: any): AgentStatus {
  const key = enumKey(value)
  switch (key?.toLowerCase()) {
    case 'active':
      return 'Active'
    case 'scored':
      return 'Scored'
    case 'survived':
      return 'Survived'
    case 'terminated':
      return 'Terminated'
    case 'respawned':
      return 'Respawned'
    default:
      return 'Active'
  }
}

function taskTypeFromVariant(variant: number | undefined): TaskType {
  switch (variant) {
    case 1:
      return 'CodeReviewer'
    case 2:
      return 'DataSynthesizer'
    case 0:
    default:
      return 'YieldOptimizer'
  }
}

function statusFromVariant(variant: number | undefined): AgentStatus {
  switch (variant) {
    case 1:
      return 'Scored'
    case 2:
      return 'Survived'
    case 3:
      return 'Terminated'
    case 4:
      return 'Respawned'
    case 0:
    default:
      return 'Active'
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
    nextOffset: end
  }
}

export class SwarmOSClient {
  readonly connection: Connection
  readonly wallet: Keypair
  readonly programId: PublicKey
  readonly provider: AnchorProvider
  readonly program: AnyProgram | null

  constructor(connection: Connection, wallet: Keypair, programId: PublicKey) {
    this.connection = connection
    this.wallet = wallet
    this.programId = programId
    this.provider = new AnchorProvider(connection, keypairToAnchorWallet(wallet), {
      commitment: 'confirmed',
      preflightCommitment: 'confirmed'
    })

    const idl = this.loadIdl()
    this.program = idl ? (new Program(idl, this.provider) as AnyProgram) : null
  }

  swarmPDA(authority: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('swarm'), authority.toBuffer()],
      this.programId
    )[0]
  }

  agentPDA(swarm: PublicKey, agentId: number): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('agent'), swarm.toBuffer(), u64Seed(agentId)],
      this.programId
    )[0]
  }

  lineagePDA(swarm: PublicKey, agentId: number): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('lineage'), swarm.toBuffer(), u64Seed(agentId)],
      this.programId
    )[0]
  }

  agentUsdcATA(agent: PublicKey, mint?: PublicKey): PublicKey {
    return getAssociatedTokenAddressSync(mint ?? this.usdcMint(), agent, true)
  }

  async initializeSwarm(config: SwarmConfig): Promise<TransactionSignature> {
    throw new Error('initializeSwarm requires a scoring oracle and treasury public key')
  }

  async initializeSwarmWithOracle(
    config: SwarmConfig,
    scoringOracle: PublicKey,
    treasury: PublicKey
  ): Promise<TransactionSignature> {
    const swarm = this.swarmPDA(this.wallet.publicKey)
    if (!this.program) return this.mockSignature('initializeSwarm')

    const builder = this.program.methods
      .initializeSwarm(
        config.name,
        config.scoringThreshold,
        scoringOracle,
        this.taskTypeArg(config.taskType)
      )
      .accounts({
        swarm,
        authority: this.wallet.publicKey,
        treasury,
        systemProgram: SystemProgram.programId
      })

    return this.sendBuilder('initializeSwarm', builder)
  }

  async spawnAgent(
    swarmAddress: PublicKey | string,
    agentId: number,
    parentId: number | null,
    _generation: number,
    _taskType: TaskType,
    lineageHash?: Buffer,
    claim?: SpawnAgentClaim
  ): Promise<TransactionSignature> {
    const swarm = toPublicKey(swarmAddress)
    const agent = this.agentPDA(swarm, agentId)
    if (!this.program) return this.mockSignature(`spawnAgent:${agentId}`)

    const usdcMint = this.usdcMint()
    const agentUsdcAta = this.agentUsdcATA(agent, usdcMint)
    const swarmTreasury = await this.requireSwarmTreasury(swarm)
    const spawnClaim = normalizeSpawnClaim(claim)

    const builder = this.program.methods
      .spawnAgent({
        agentId: new BN(agentId),
        parentId: parentId == null ? null : new BN(parentId),
        lineageHash: ensureHash32(lineageHash),
        claimedApyBps: spawnClaim.claimedApyBps,
        claimedProtocol: spawnClaim.claimedProtocol,
        taskOutputHash: ensureHash32(spawnClaim.taskOutputHash)
      })
      .accounts({
        agent,
        agentUsdcAta,
        swarm,
        swarmTreasury,
        authority: this.wallet.publicKey,
        usdcMint,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId
      })

    return this.sendBuilder('spawnAgent', builder)
  }

  async submitScore(
    swarmAddress: PublicKey | string,
    agentId: number,
    score: number,
    oracle: Keypair
  ): Promise<TransactionSignature> {
    const swarm = toPublicKey(swarmAddress)
    const agent = this.agentPDA(swarm, agentId)
    if (!this.program) return this.mockSignature(`submitScore:${agentId}:${score}`)

    const builder = this.program.methods
      .submitScore(new BN(agentId), score)
      .accounts({
        swarm,
        agent,
        oracle: oracle.publicKey
      })

    return this.sendBuilder('submitScore', builder, [oracle])
  }

  async evaluateAndPrune(
    swarmAddress: PublicKey | string,
    agentId: number,
    failureReasonHash?: Buffer,
    arweaveUri = ''
  ): Promise<TransactionSignature> {
    const swarm = toPublicKey(swarmAddress)
    const agent = this.agentPDA(swarm, agentId)
    const lineage = this.lineagePDA(swarm, agentId)
    if (!this.program) return this.mockSignature(`evaluateAndPrune:${agentId}`)

    const usdcMint = this.usdcMint()
    const agentUsdcAta = this.agentUsdcATA(agent, usdcMint)
    const swarmTreasury = await this.requireSwarmTreasury(swarm)

    const builder = this.program.methods
      .evaluateAndPrune(new BN(agentId), ensureHash32(failureReasonHash), arweaveUri)
      .accounts({
        agent,
        lineageMemory: lineage,
        swarm,
        agentUsdcAta,
        swarmTreasury,
        authority: this.wallet.publicKey,
        usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId
      })

    return this.sendBuilder('evaluateAndPrune', builder)
  }

  async respawnSuccessor(
    swarmAddress: PublicKey | string,
    terminatedAgentId: number,
    successorAgentId: number,
    generation: number,
    taskType: TaskType,
    lineageHash?: Buffer,
    arweaveUri = ''
  ): Promise<TransactionSignature> {
    const swarm = toPublicKey(swarmAddress)
    const successorAgent = this.agentPDA(swarm, successorAgentId)
    const lineage = this.lineagePDA(swarm, terminatedAgentId)
    if (!this.program) {
      return this.mockSignature(`respawnSuccessor:${terminatedAgentId}:${successorAgentId}`)
    }

    const builder = this.program.methods
      .respawnSuccessor(
        new BN(successorAgentId),
        new BN(terminatedAgentId)
      )
      .accounts({
        swarm,
        newAgent: successorAgent,
        parentLineage: lineage,
        authority: this.wallet.publicKey,
        systemProgram: SystemProgram.programId
      })

    return this.sendBuilder('respawnSuccessor', builder)
  }

  async bumpGeneration(swarmAddress: PublicKey | string): Promise<TransactionSignature> {
    const swarm = toPublicKey(swarmAddress)
    if (!this.program) return this.mockSignature('bumpGeneration')
    const builder = this.program.methods
      .bumpGeneration()
      .accounts({ swarm, authority: this.wallet.publicKey })
    return this.sendBuilder('bumpGeneration', builder)
  }

  async getSwarm(swarmAddress: PublicKey | string): Promise<any | null> {
    if (!this.program) return null
    try {
      return await (this.program.account as any).swarm.fetch(toPublicKey(swarmAddress))
    } catch (error) {
      console.warn(`Unable to fetch swarm account: ${String(error)}`)
      return null
    }
  }

  async getAllAgents(swarmAddress: PublicKey | string): Promise<AgentAccount[]> {
    if (!this.program) return this.getAllAgentsRaw(swarmAddress)
    const swarm = toPublicKey(swarmAddress).toBase58()
    try {
      const accounts = await (this.program.account as any).agent.all()
      return accounts
        .map((entry: any) => this.normalizeAgentAccount(entry.account))
        .filter((agent: AgentAccount) => agent.swarm === swarm)
    } catch (error) {
      console.warn(`Anchor agent decoder failed; falling back to raw account decoder: ${String(error)}`)
      return this.getAllAgentsRaw(swarmAddress)
    }
  }

  async getAllLineageMemories(swarmAddress: PublicKey | string): Promise<LineageMemory[]> {
    if (!this.program) return this.getAllLineageMemoriesRaw(swarmAddress)
    const swarm = toPublicKey(swarmAddress).toBase58()
    try {
      const accounts = await (this.program.account as any).lineageMemory.all()
      return accounts
        .filter((entry: any) => !entry.account.swarm || entry.account.swarm.toBase58() === swarm)
        .map((entry: any) => this.normalizeLineageMemory(entry.account))
    } catch (error) {
      console.warn(`Anchor lineage decoder failed; falling back to raw account decoder: ${String(error)}`)
      return this.getAllLineageMemoriesRaw(swarmAddress)
    }
  }

  private async getAllAgentsRaw(swarmAddress: PublicKey | string): Promise<AgentAccount[]> {
    const swarm = toPublicKey(swarmAddress).toBase58()
    try {
      const accounts = await this.connection.getProgramAccounts(this.programId, {
        filters: [{ memcmp: { offset: 0, bytes: AGENT_DISCRIMINATOR_BASE58 } }]
      })

      return accounts
        .map((entry) => this.decodeAgentAccount(entry.account.data))
        .filter((agent): agent is AgentAccount => agent !== null)
        .filter((agent) => agent.swarm === swarm)
    } catch (error) {
      console.warn(`Unable to fetch raw agent accounts: ${String(error)}`)
      return []
    }
  }

  private async getAllLineageMemoriesRaw(
    swarmAddress: PublicKey | string
  ): Promise<LineageMemory[]> {
    const swarm = toPublicKey(swarmAddress).toBase58()
    try {
      const accounts = await this.connection.getProgramAccounts(this.programId, {
        filters: [{ memcmp: { offset: 0, bytes: LINEAGE_DISCRIMINATOR_BASE58 } }]
      })

      const memories: LineageMemory[] = []
      for (const entry of accounts) {
        const decoded = this.decodeLineageMemory(entry.account.data)
        if (!decoded || decoded.swarm !== swarm) continue
        const { swarm: _swarm, ...memory } = decoded
        memories.push(memory)
      }
      return memories
    } catch (error) {
      console.warn(`Unable to fetch raw lineage memory accounts: ${String(error)}`)
      return []
    }
  }

  private decodeAgentAccount(data: Buffer): AgentAccount | null {
    try {
      if (data.length < 117 || !data.subarray(0, 8).equals(AGENT_DISCRIMINATOR)) return null

      const agentId = readU64(data, 8)
      const swarm = new PublicKey(data.subarray(16, 48)).toBase58()
      const parentField = readOptionU64(data, 48)
      let cursor = parentField.nextOffset
      const generation = readU64(data, cursor)
      cursor += 8
      const taskType = taskTypeFromVariant(data[cursor])
      cursor += 1
      const status = statusFromVariant(data[cursor])
      cursor += 1
      const score = data[cursor] ?? 0
      cursor += 1
      const lineageHash = Buffer.from(data.subarray(cursor, cursor + 32))
      cursor += 32

      let claimedApyBps = 0
      let claimedProtocol = ''
      let taskOutputHash = Buffer.alloc(32)
      let spawnTimestampOffset = cursor

      if (data.length >= 187) {
        claimedApyBps = data.readUInt16LE(cursor)
        cursor += 2
        const claimedProtocolField = readBorshString(data, cursor, 32)
        if (claimedProtocolField) {
          claimedProtocol = claimedProtocolField.value
          const taskOutputHashOffset = claimedProtocolField.nextOffset
          taskOutputHash = Buffer.from(data.subarray(taskOutputHashOffset, taskOutputHashOffset + 32))
          spawnTimestampOffset = taskOutputHashOffset + 32
        }
      }

      return {
        agentId,
        swarm,
        parentId: parentField.value,
        generation,
        taskType,
        status,
        score,
        lineageHash,
        claimedApyBps,
        claimedProtocol,
        taskOutputHash,
        spawnTimestamp: readI64(data, spawnTimestampOffset),
        terminationTimestamp: readI64(data, spawnTimestampOffset + 8)
      }
    } catch {
      return null
    }
  }

  private decodeLineageMemory(data: Buffer): (LineageMemory & { swarm: string }) | null {
    try {
      if (data.length < 95 || !data.subarray(0, 8).equals(LINEAGE_DISCRIMINATOR)) return null

      const arweaveUriField = readBorshString(data, 90, 100)
      if (!arweaveUriField) return null

      return {
        agentId: readU64(data, 8),
        swarm: new PublicKey(data.subarray(16, 48)).toBase58(),
        generation: readU64(data, 48),
        taskType: taskTypeFromVariant(data[56]),
        failureScore: data[57] ?? 0,
        failureReasonHash: Buffer.from(data.subarray(58, 90)),
        arweaveUri: arweaveUriField.value,
        timestamp: readI64(data, arweaveUriField.nextOffset)
      }
    } catch {
      return null
    }
  }

  private loadIdl(): Idl | null {
    const candidates = [
      path.resolve(__dirname, 'idl/swarm_os.json'),
      path.resolve(process.cwd(), '../../programs/swarm-os/target/idl/swarm_os.json'),
      path.resolve(process.cwd(), 'programs/swarm-os/target/idl/swarm_os.json'),
      path.resolve(__dirname, '../../../programs/swarm-os/target/idl/swarm_os.json'),
      path.resolve(__dirname, '../../../../programs/swarm-os/target/idl/swarm_os.json')
    ]

    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) continue
      try {
        const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'))
        return {
          ...parsed,
          address: parsed.address || parsed.metadata?.address || this.programId.toBase58()
        } as Idl
      } catch (error) {
        console.warn(`Found IDL at ${candidate}, but could not parse it: ${String(error)}`)
        return null
      }
    }

    console.warn(
      'Anchor IDL not found at programs/swarm-os/target/idl/swarm_os.json. Runtime will use dry-run chain calls until the program is built.'
    )
    return null
  }

  private async sendBuilder(
    action: string,
    builder: any,
    signers: Keypair[] = [this.wallet]
  ): Promise<TransactionSignature> {
    const instruction = await builder.instruction()
    const transaction = new Transaction().add(instruction)
    return sendAndConfirmTransaction(this.connection, transaction, signers, {
      commitment: 'confirmed'
    })
  }

  private mockSignature(action: string): TransactionSignature {
    const signature = `mock-${action}-${Date.now()}`
    console.warn(`[dry-run] ${action} skipped because the Anchor IDL is unavailable. Signature: ${signature}`)
    return signature
  }

  private taskTypeArg(taskType: TaskType): Record<string, Record<string, never>> {
    const key = `${taskType.charAt(0).toLowerCase()}${taskType.slice(1)}`
    return { [key]: {} }
  }

  private usdcMint(): PublicKey {
    return new PublicKey(process.env.USDC_MINT_DEVNET || DEVNET_USDC)
  }

  private async requireSwarmTreasury(swarm: PublicKey): Promise<PublicKey> {
    if (!this.program) {
      throw new Error('Cannot resolve swarm treasury without an Anchor program client')
    }

    const account = await (this.program.account as any).swarm.fetch(swarm)
    const treasury = account?.treasury
    if (!treasury) {
      throw new Error(`Swarm ${swarm.toBase58()} does not have a treasury token account`)
    }

    return treasury instanceof PublicKey ? treasury : new PublicKey(treasury.toBase58?.() ?? treasury)
  }

  private normalizeAgentAccount(raw: any): AgentAccount {
    return {
      agentId: numberFromAnchor(raw.agentId),
      swarm: raw.swarm?.toBase58?.() ?? String(raw.swarm ?? ''),
      parentId: raw.parentId == null ? null : numberFromAnchor(raw.parentId),
      generation: numberFromAnchor(raw.generation),
      taskType: normalizeTaskType(raw.taskType),
      status: normalizeStatus(raw.status),
      score: numberFromAnchor(raw.score),
      lineageHash: bufferFromAnchor(raw.lineageHash),
      claimedApyBps: numberFromAnchor(raw.claimedApyBps),
      claimedProtocol: String(raw.claimedProtocol ?? ''),
      taskOutputHash: bufferFromAnchor(raw.taskOutputHash),
      spawnTimestamp: numberFromAnchor(raw.spawnTimestamp),
      terminationTimestamp:
        raw.terminationTimestamp == null ? null : numberFromAnchor(raw.terminationTimestamp)
    }
  }

  private normalizeLineageMemory(raw: any): LineageMemory {
    return {
      agentId: numberFromAnchor(raw.agentId),
      generation: numberFromAnchor(raw.generation),
      taskType: normalizeTaskType(raw.taskType),
      failureScore: numberFromAnchor(raw.failureScore),
      failureReasonHash: bufferFromAnchor(raw.failureReasonHash),
      arweaveUri: String(raw.arweaveUri ?? ''),
      timestamp: numberFromAnchor(raw.timestamp)
    }
  }
}
