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
    if (!this.program) return []
    const swarm = toPublicKey(swarmAddress).toBase58()
    try {
      const accounts = await (this.program.account as any).agent.all()
      return accounts
        .map((entry: any) => this.normalizeAgentAccount(entry.account))
        .filter((agent: AgentAccount) => agent.swarm === swarm)
    } catch (error) {
      console.warn(`Unable to fetch agent accounts: ${String(error)}`)
      return []
    }
  }

  async getAllLineageMemories(swarmAddress: PublicKey | string): Promise<LineageMemory[]> {
    if (!this.program) return []
    const swarm = toPublicKey(swarmAddress).toBase58()
    try {
      const accounts = await (this.program.account as any).lineageMemory.all()
      return accounts
        .filter((entry: any) => !entry.account.swarm || entry.account.swarm.toBase58() === swarm)
        .map((entry: any) => this.normalizeLineageMemory(entry.account))
    } catch (error) {
      console.warn(`Unable to fetch lineage memory accounts: ${String(error)}`)
      return []
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
