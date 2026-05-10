import chalk from 'chalk'
import crypto from 'crypto'
import dotenv from 'dotenv'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction
} from '@solana/web3.js'
import {
  closeAccount,
  getAccount,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  transfer
} from '@solana/spl-token'
import { ChildAgent } from './child'
import { SpawnAgentClaim, SwarmOSClient } from './client'
import { AgentAccount, LineageMemory, SwarmConfig, TaskType } from './types'
import {
  generateVenicePostMortem,
  LineageLessonRecord,
  LineagePostMortem,
  synthesizeVeniceLineageLessons
} from './venice'

const REPO_ROOT = findRepoRoot(__dirname)
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || path.join(REPO_ROOT, '.env') })

const DEFAULT_PROGRAM_ID = 'D9moMaWzJw3LVxnZkiXS7xrTUHmF4n3hJeDWCvbB7B1a'
const DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
const DEFAULT_ORACLE_WALLET = path.join(REPO_ROOT, 'packages/scoring-oracle/oracle-keypair.json')
const AGENT_WALLET_DIR = path.join(REPO_ROOT, 'packages/agent-runtime/.agent-wallets')
const SWARM_AUTHORITY_DIR = path.join(REPO_ROOT, 'packages/agent-runtime/.swarm-authorities')
const STATE_ARCHIVE_DIR = path.join(REPO_ROOT, 'packages/agent-runtime/.archive')
const LINEAGE_FILE = path.join(process.cwd(), '.swarm-lineage.json')

function loadLineageStore(): Map<number, string> {
  try {
    const raw = fs.readFileSync(LINEAGE_FILE, 'utf8')
    const obj = JSON.parse(raw)
    return new Map(Object.entries(obj).map(([k, v]) => [Number(k), v as string]))
  } catch {
    return new Map()
  }
}

function saveLineageStore(store: Map<number, string>): void {
  const obj = Object.fromEntries(store)
  fs.writeFileSync(LINEAGE_FILE, JSON.stringify(obj, null, 2))
}

type ReclaimableAgentWallet = Pick<ChildAgent, 'agentId' | 'wallet'>

export class ParentAgent {
  config: SwarmConfig
  client: SwarmOSClient
  swarmAddress: string | null
  agentCounter: number

  private connection: Connection
  private walletKeypair: Keypair
  private currentGeneration: number
  private failureTextByUri: Map<string, string>
  private failureHashByAgentId: Map<number, Buffer>
  private failureUriByAgentId: Map<number, string>
  private failureSummaries: Map<number, string> = loadLineageStore()
  private localLineageMemories: LineageMemory[]
  private oracleKeypair: Keypair

  constructor(config: SwarmConfig, connection: Connection, walletKeypair: Keypair) {
    this.config = config
    this.connection = connection
    this.walletKeypair = walletKeypair
    this.client = new SwarmOSClient(connection, walletKeypair, readProgramId())
    this.swarmAddress = null
    this.agentCounter = 0
    this.currentGeneration = 0
    this.failureTextByUri = new Map()
    this.failureHashByAgentId = new Map()
    this.failureUriByAgentId = new Map()
    this.localLineageMemories = []
    this.oracleKeypair = loadOracleKeypair()
  }

  async initialize(): Promise<void> {
    const swarm = this.client.swarmPDA(this.walletKeypair.publicKey)
    this.swarmAddress = swarm.toBase58()

    const existingSwarm = await this.client.getSwarm(swarm)
    if (existingSwarm) {
      this.adoptExistingSwarmOracle(existingSwarm)
      await this.syncAgentCounter(swarm)
      console.log(chalk.green(`Using existing swarm at ${this.swarmAddress}`))
      return
    }

    const mint = new PublicKey(process.env.USDC_MINT_DEVNET || DEVNET_USDC)
    const treasury = await getOrCreateAssociatedTokenAccount(
      this.connection,
      this.walletKeypair,
      mint,
      this.walletKeypair.publicKey
    )
    const signature = await this.client.initializeSwarmWithOracle(
      this.config,
      this.oracleKeypair.publicKey,
      treasury.address
    )
    console.log(chalk.green(`Swarm initialized at ${this.swarmAddress}`))
    console.log(chalk.gray(`initializeSwarm signature: ${signature}`))
  }

  async runGeneration(): Promise<void> {
    if (!this.swarmAddress) await this.initialize()
    const swarm = this.requireSwarmAddress()
    const nextGeneration = this.currentGeneration + 1

    console.log(chalk.cyan(`\nGeneration ${nextGeneration} starting`))

    // Increment on-chain swarm.generation so spawned agents carry the right generation number
    const bumpSig = await this.client.bumpGeneration(swarm)
    console.log(chalk.gray(`bumpGeneration: ${bumpSig}`))

    const memories = await this.readLineageMemories()
    const failureReasons = await this.fetchFailureReasons(
      memories.filter((memory) => memory.taskType === this.config.taskType)
    )
    if (failureReasons.length > 0) {
      console.log(chalk.gray(`Injecting ${failureReasons.length} distilled lineage lessons into generation ${nextGeneration}`))
    }
    const lineageContext = Array.from({ length: this.config.agentsPerGeneration }, () =>
      failureReasons.slice()
    )

    const agents = await this.spawnAgents(this.config.agentsPerGeneration, lineageContext)
    await this.fundAgentWallets(agents)
    await this.collectScores(agents)
    const { survived, terminated } = await this.evaluateGeneration(agents)

    console.log(
      chalk.bold(
        `Generation ${nextGeneration} complete: ${survived.length} survived, ${terminated.length} terminated`
      )
    )

    await this.reclaimTerminatedAgentFunds(terminated)

    for (const [index, agent] of terminated.entries()) {
      const failureSummary =
        this.failureSummaries.get(agent.agentId) ?? (await this.buildFailureSummary(agent))
      const arweaveUri =
        this.failureUriByAgentId.get(agent.agentId) ??
        (await this.writeFailureToArweave(agent.agentId, failureSummary))
      const failureReasonHash =
        this.failureHashByAgentId.get(agent.agentId) ?? hashTo32Bytes(failureSummary)

      this.localLineageMemories.push({
        agentId: agent.agentId,
        generation: agent.generation,
        taskType: agent.taskType,
        failureScore: agent.lastScore ?? 0,
        failureReasonHash,
        arweaveUri,
        timestamp: Math.floor(Date.now() / 1000)
      })

      const successorPreviewId = this.agentCounter + index + 1
      await this.client.respawnSuccessor(
        swarm,
        agent.agentId,
        successorPreviewId,
        nextGeneration + 1,
        this.config.taskType,
        failureReasonHash,
        arweaveUri
      )
      this.agentCounter = Math.max(this.agentCounter, successorPreviewId)
    }

    this.currentGeneration = nextGeneration
  }

  async runFullSwarm(forever = false): Promise<void> {
    if (!this.swarmAddress) await this.initialize()

    if (forever) {
      console.log(chalk.cyan('Running in continuous mode — Ctrl+C to stop'))
      for (;;) {
        await this.runGeneration()
      }
    }

    for (let i = 0; i < this.config.maxGenerations; i += 1) {
      await this.runGeneration()
    }

    console.log(chalk.green(`\nSwarm run finished after ${this.config.maxGenerations} generations`))
  }

  async reclaimDeadAgentFunds(): Promise<void> {
    const swarm = this.client.swarmPDA(this.walletKeypair.publicKey)
    this.swarmAddress = swarm.toBase58()

    const existingSwarm = await this.client.getSwarm(swarm)
    if (!existingSwarm) {
      console.log(chalk.yellow(`No swarm exists at ${this.swarmAddress}; nothing to reclaim.`))
      return
    }

    const agents = await this.client.getAllAgents(swarm)
    const terminated = agents.filter((agent) => agent.status === 'Terminated')
    const reclaimable = this.loadPersistedAgentWallets(terminated)

    console.log(
      chalk.gray(
        `Found ${terminated.length} terminated agents; ${reclaimable.length} have local wallet keys.`
      )
    )

    await this.reclaimTerminatedAgentFunds(reclaimable)
  }

  private async spawnAgents(n: number, lineageContext: string[][]): Promise<ChildAgent[]> {
    const generation = this.currentGeneration + 1
    const agents: ChildAgent[] = []

    for (let i = 0; i < n; i += 1) {
      this.agentCounter += 1
      const context = lineageContext[i] ?? []
      const child = new ChildAgent({
        agentId: this.agentCounter,
        generation,
        taskType: this.config.taskType,
        lineageContext: context,
        wallet: this.loadOrCreatePersistedAgentWallet(this.agentCounter)
      })

      console.log(
        chalk.blue(
          `Prepared agent ${child.agentId} generation ${child.generation}`
        )
      )
      agents.push(child)
    }

    return agents
  }

  private async spawnAgentOnChain(agent: ChildAgent, claim: SpawnAgentClaim): Promise<string> {
    const swarm = this.requireSwarmAddress()
    const lineageHash = hashTo32Bytes(agent.lineageContext.join('\n'))
    return this.client.spawnAgent(
      swarm,
      agent.agentId,
      null,
      agent.generation,
      agent.taskType,
      lineageHash,
      claim
    )
  }

  private async collectScores(agents: ChildAgent[]): Promise<void> {
    const swarm = this.requireSwarmAddress()

    for (const agent of agents) {
      let spawnedOnChain = false
      try {
        const output = await agent.executeTask()
        const spawnSignature = await this.spawnAgentOnChain(agent, claimFromAgentOutput(output))
        spawnedOnChain = true
        console.log(
          chalk.blue(
            `Spawned agent ${agent.agentId} generation ${agent.generation} (${spawnSignature})`
          )
        )

        const score = await agent.submitToOracle(output)
        await this.client.submitScore(swarm, agent.agentId, score, this.oracleKeypair)
        console.log(chalk.green(`Agent ${agent.agentId} scored ${score}/100`))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // InvalidAgentStatus means this agent was already scored/terminated (stale PDA from a prior run) — skip it
        if (message.includes('InvalidAgentStatus') || message.includes('0x1771')) {
          console.warn(chalk.yellow(`Agent ${agent.agentId} already scored on-chain (stale PDA), skipping submit`))
          agent.stalePDA = true
          continue
        }
        agent.lastOutput = `Agent execution or scoring failed: ${message}`
        agent.lastScore = 0
        try {
          if (!spawnedOnChain) {
            const spawnSignature = await this.spawnAgentOnChain(
              agent,
              claimFromAgentOutput(agent.lastOutput)
            )
            spawnedOnChain = true
            console.log(
              chalk.blue(
                `Spawned failed agent ${agent.agentId} for fallback score (${spawnSignature})`
              )
            )
          }
          await this.client.submitScore(swarm, agent.agentId, 0, this.oracleKeypair)
        } catch (submitErr) {
          const submitMsg = submitErr instanceof Error ? submitErr.message : String(submitErr)
          if (submitMsg.includes('InvalidAgentStatus') || submitMsg.includes('0x1771')) {
            console.warn(chalk.yellow(`Agent ${agent.agentId} fallback score also skipped (stale PDA)`))
            agent.stalePDA = true
            continue
          }
          throw submitErr
        }
        console.error(chalk.red(`Agent ${agent.agentId} failed and received score 0: ${message}`))
      }
    }
  }

  private async evaluateGeneration(
    agents: ChildAgent[]
  ): Promise<{ survived: ChildAgent[]; terminated: ChildAgent[] }> {
    const swarm = this.requireSwarmAddress()
    const survived: ChildAgent[] = []
    const terminated: ChildAgent[] = []

    for (const agent of agents) {
      // Stale PDA: submitScore failed because this agent was already scored in a prior run.
      // Its on-chain score and our oracle score may disagree — skip evaluation and respawn
      // entirely to avoid writing a LineageMemory with a stale/zero bump.
      if (agent.stalePDA) {
        console.warn(chalk.yellow(`Agent ${agent.agentId} skipped evaluation (stale PDA from prior run)`))
        continue
      }

      if ((agent.lastScore ?? 0) >= this.config.scoringThreshold) {
        await this.client.evaluateAndPrune(swarm, agent.agentId)
      } else {
        const failureSummary = await this.buildFailureSummary(agent)
        const arweaveUri = await this.writeFailureToArweave(agent.agentId, failureSummary)
        const failureReasonHash = hashTo32Bytes(failureSummary)
        this.failureSummaries.set(agent.agentId, failureSummary)
        saveLineageStore(this.failureSummaries)
        this.failureUriByAgentId.set(agent.agentId, arweaveUri)
        this.failureHashByAgentId.set(agent.agentId, failureReasonHash)
        await this.client.evaluateAndPrune(swarm, agent.agentId, failureReasonHash, arweaveUri)
      }
      const score = agent.lastScore ?? 0
      if (score >= this.config.scoringThreshold) {
        survived.push(agent)
      } else {
        terminated.push(agent)
      }
    }

    return { survived, terminated }
  }

  private async reclaimTerminatedAgentFunds(agents: ReclaimableAgentWallet[]): Promise<void> {
    if (agents.length === 0) return
    if (process.env.RECLAIM_TERMINATED_FUNDS === 'false') {
      console.log(chalk.yellow('Skipping terminated-agent fund reclaim because RECLAIM_TERMINATED_FUNDS=false'))
      return
    }

    for (const agent of agents) {
      await this.reclaimAgentTokenFunds(agent)
      await this.reclaimAgentSol(agent)
    }
  }

  private async reclaimAgentTokenFunds(agent: ReclaimableAgentWallet): Promise<void> {
    const mint = new PublicKey(process.env.USDC_MINT_DEVNET || DEVNET_USDC)

    try {
      const source = await getAssociatedTokenAddress(mint, agent.wallet.publicKey)
      const sourceAccount = await getAccount(this.connection, source).catch(() => null)
      if (!sourceAccount) return

      const destination = await getOrCreateAssociatedTokenAccount(
        this.connection,
        this.walletKeypair,
        mint,
        this.walletKeypair.publicKey
      )

      if (sourceAccount.amount > 0n) {
        const transferSignature = await transfer(
          this.connection,
          this.walletKeypair,
          source,
          destination.address,
          agent.wallet,
          sourceAccount.amount
        )
        console.log(
          chalk.gray(
            `Reclaimed ${sourceAccount.amount.toString()} USDC atoms from terminated agent ${agent.agentId}: ${transferSignature}`
          )
        )
      }

      const closeSignature = await closeAccount(
        this.connection,
        this.walletKeypair,
        source,
        this.walletKeypair.publicKey,
        agent.wallet
      )
      console.log(
        chalk.gray(`Closed agent ${agent.agentId} USDC account and reclaimed rent: ${closeSignature}`)
      )
    } catch (error) {
      console.warn(
        chalk.yellow(`Could not reclaim USDC for terminated agent ${agent.agentId}: ${errorMessage(error)}`)
      )
    }
  }

  private async reclaimAgentSol(agent: ReclaimableAgentWallet): Promise<void> {
    try {
      const balance = await this.connection.getBalance(agent.wallet.publicKey, 'confirmed')
      const fee = await this.estimateSolTransferFee(agent.wallet.publicKey)
      const lamportsToReturn = balance - fee

      if (lamportsToReturn <= 0) {
        console.log(chalk.gray(`No reclaimable SOL left for terminated agent ${agent.agentId}`))
        return
      }

      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: agent.wallet.publicKey,
          toPubkey: this.walletKeypair.publicKey,
          lamports: lamportsToReturn
        })
      )
      tx.feePayer = agent.wallet.publicKey

      const signature = await sendAndConfirmTransaction(this.connection, tx, [agent.wallet], {
        commitment: 'confirmed'
      })
      console.log(
        chalk.gray(
          `Reclaimed ${(lamportsToReturn / LAMPORTS_PER_SOL).toFixed(6)} SOL from terminated agent ${agent.agentId}: ${signature}`
        )
      )
    } catch (error) {
      console.warn(
        chalk.yellow(`Could not reclaim SOL for terminated agent ${agent.agentId}: ${errorMessage(error)}`)
      )
    }
  }

  private async estimateSolTransferFee(feePayer: PublicKey): Promise<number> {
    const { blockhash } = await this.connection.getLatestBlockhash('confirmed')
    const tx = new Transaction({
      feePayer,
      recentBlockhash: blockhash
    }).add(
      SystemProgram.transfer({
        fromPubkey: feePayer,
        toPubkey: this.walletKeypair.publicKey,
        lamports: 0
      })
    )

    return (await this.connection.getFeeForMessage(tx.compileMessage(), 'confirmed')).value ?? 5000
  }

  private loadOrCreatePersistedAgentWallet(agentId: number): Keypair {
    const walletPath = this.agentWalletPath(agentId)

    if (fs.existsSync(walletPath)) {
      return readKeypairFile(walletPath, `Agent ${agentId} wallet`)
    }

    const wallet = Keypair.generate()
    fs.mkdirSync(path.dirname(walletPath), { recursive: true })
    fs.writeFileSync(walletPath, JSON.stringify(Array.from(wallet.secretKey)))
    return wallet
  }

  private loadPersistedAgentWallets(agents: AgentAccount[]): ReclaimableAgentWallet[] {
    const reclaimable: ReclaimableAgentWallet[] = []

    for (const agent of agents) {
      const walletPath = this.agentWalletPath(agent.agentId)
      if (!fs.existsSync(walletPath)) {
        console.warn(
          chalk.yellow(
            `No local wallet key for terminated agent ${agent.agentId}; cannot reclaim its SOL.`
          )
        )
        continue
      }

      reclaimable.push({
        agentId: agent.agentId,
        wallet: readKeypairFile(walletPath, `Agent ${agent.agentId} wallet`)
      })
    }

    return reclaimable
  }

  private agentWalletPath(agentId: number): string {
    const swarm = this.requireSwarmAddress()
    return path.join(AGENT_WALLET_DIR, swarm, `${agentId}.json`)
  }

  private async readLineageMemories(): Promise<LineageMemory[]> {
    if (!this.swarmAddress) return this.localLineageMemories.slice()
    const chainMemories = await this.client.getAllLineageMemories(this.swarmAddress)
    const seen = new Set<string>()
    const merged: LineageMemory[] = []

    for (const memory of [...chainMemories, ...this.localLineageMemories]) {
      const key = `${memory.agentId}:${memory.arweaveUri}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(memory)
    }

    return merged
  }

  private async fetchFailureReasons(memories: LineageMemory[]): Promise<string[]> {
    const records = memories.map((memory) => this.buildLineageLessonRecord(memory))
    const selected = this.selectLineageRecords(records)
    if (selected.length === 0) return []

    const maxLessons = Number(process.env.LINEAGE_CONTEXT_RULES ?? 8)
    const veniceLessons = await synthesizeVeniceLineageLessons(
      selected,
      this.config.taskType,
      maxLessons
    )
    if (veniceLessons && veniceLessons.length > 0) return veniceLessons

    return this.buildFallbackLineageLessons(selected, maxLessons)
  }

  private buildLineageLessonRecord(memory: LineageMemory): LineageLessonRecord {
    const stored = this.readFailureText(memory.arweaveUri)
    if (!stored) {
      return {
        agentId: memory.agentId,
        generation: memory.generation,
        taskType: memory.taskType,
        score: memory.failureScore,
        failureReason: `Scored ${memory.failureScore}/100 without retrievable off-chain post-mortem.`,
        source: 'generic'
      }
    }

    try {
      const parsed = JSON.parse(stored) as Record<string, unknown>
      const postMortem = asObject(parsed.venicePostMortem)
      const failureReason =
        asString(postMortem.failureReason) ||
        asString(parsed.failureReason) ||
        `Scored ${memory.failureScore}/100`

      return {
        agentId: memory.agentId,
        generation: memory.generation,
        taskType: memory.taskType,
        score: numberOr(memory.failureScore, parsed.score),
        failureReason,
        rootCause: asString(postMortem.rootCause) || asString(parsed.rootCause) || undefined,
        correctiveRules: [
          ...asStringArray(parsed.correctiveRules),
          ...asStringArray(postMortem.correctiveRules)
        ],
        promptHints: [
          ...asStringArray(parsed.promptHints),
          ...asStringArray(postMortem.promptHints)
        ],
        riskWarnings: [
          ...asStringArray(parsed.riskWarnings),
          ...asStringArray(postMortem.riskWarnings)
        ],
        evidence: [
          ...asStringArray(parsed.evidence),
          ...asStringArray(postMortem.evidence)
        ],
        oracleFeedback: asString(parsed.oracleFeedback) || null,
        source: 'stored'
      }
    } catch {
      return {
        agentId: memory.agentId,
        generation: memory.generation,
        taskType: memory.taskType,
        score: memory.failureScore,
        failureReason: stored.replace(/\s+/g, ' ').slice(0, 260),
        source: 'stored'
      }
    }
  }

  private selectLineageRecords(records: LineageLessonRecord[]): LineageLessonRecord[] {
    const rawLimit = Number(process.env.LINEAGE_RAW_MEMORY_LIMIT ?? 28)
    const recent = records
      .slice()
      .sort((a, b) => b.generation - a.generation || a.score - b.score)
      .slice(0, rawLimit)
    const worst = records
      .slice()
      .sort((a, b) => a.score - b.score || b.generation - a.generation)
      .slice(0, Math.ceil(rawLimit / 2))

    const seen = new Set<number>()
    const selected: LineageLessonRecord[] = []
    for (const record of [...recent, ...worst]) {
      if (seen.has(record.agentId)) continue
      seen.add(record.agentId)
      selected.push(record)
      if (selected.length >= rawLimit) break
    }

    return selected
  }

  private buildFallbackLineageLessons(records: LineageLessonRecord[], maxLessons: number): string[] {
    const lessons: string[] = []
    const addLesson = (lesson: string) => {
      const normalized = lesson.replace(/\s+/g, ' ').trim()
      if (!normalized) return
      if (lessons.some((item) => item.toLowerCase() === normalized.toLowerCase())) return
      lessons.push(normalized.length > 220 ? `${normalized.slice(0, 217)}...` : normalized)
    }

    const lowest = records.reduce((min, record) => (record.score < min.score ? record : min), records[0])
    addLesson(
      `${records.length} selected ${this.config.taskType} failures are being inherited; lowest selected score was ${lowest.score}/100 in generation ${lowest.generation}.`
    )

    for (const record of records) {
      for (const rule of [...(record.correctiveRules ?? []), ...(record.promptHints ?? [])]) {
        addLesson(rule)
        if (lessons.length >= maxLessons) return lessons
      }
    }

    if (this.config.taskType === 'YieldOptimizer') {
      addLesson('Use the current live yield rows as source of truth; expectedAPY must be the decimal value for the exact chosen protocol and vault.')
      addLesson('Return complete strict JSON with protocol, vault, expectedAPY, reasoning, riskAssessment, alternativeProtocol, and alternativeAPY.')
      addLesson('Risk assessment must mention concrete TVL, liquidity depth, utilization, or volatility risk instead of repeating headline APY.')
      addLesson('Pick the alternative from the current live list and cite its APY; do not invent MarginFi or Drift when they are absent.')
      addLesson('If APY was correct but score was low, improve JSON completeness and evidence density rather than changing the APY.')
    } else {
      addLesson('Convert each old failure into a concrete output requirement, not a vague warning.')
      addLesson('Keep the response schema exact and include enough task-specific evidence for the oracle to verify it.')
    }

    return lessons.slice(0, maxLessons)
  }

  private async fundAgentWallets(agents: ChildAgent[]): Promise<void> {
    if (process.env.SKIP_AGENT_FUNDING === 'true') {
      console.log(chalk.yellow('Skipping child wallet funding because SKIP_AGENT_FUNDING=true'))
      return
    }

    const solLamports = Number(process.env.CHILD_SOL_LAMPORTS ?? 0.01 * LAMPORTS_PER_SOL)
    const usdcAtomic = BigInt(process.env.CHILD_USDC_ATOMIC ?? '50000')
    const mint = new PublicKey(process.env.USDC_MINT_DEVNET || DEVNET_USDC)
    const skipX402 = process.env.SKIP_X402_PAYMENT === 'true'

    for (const agent of agents) {
      try {
        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: this.walletKeypair.publicKey,
            toPubkey: agent.wallet.publicKey,
            lamports: solLamports
          })
        )
        const signature = await sendAndConfirmTransaction(this.connection, tx, [this.walletKeypair])
        console.log(chalk.gray(`Funded agent ${agent.agentId} SOL wallet: ${signature}`))
      } catch (error) {
        console.warn(
          chalk.yellow(`Could not fund SOL for agent ${agent.agentId}: ${errorMessage(error)}`)
        )
      }

      if (skipX402 || usdcAtomic === 0n) {
        console.log(chalk.gray(`Skipping agent ${agent.agentId} USDC funding`))
        continue
      }

      try {
        const source = await getOrCreateAssociatedTokenAccount(
          this.connection,
          this.walletKeypair,
          mint,
          this.walletKeypair.publicKey
        )
        const destination = await getOrCreateAssociatedTokenAccount(
          this.connection,
          this.walletKeypair,
          mint,
          agent.wallet.publicKey
        )
        const signature = await transfer(
          this.connection,
          this.walletKeypair,
          source.address,
          destination.address,
          this.walletKeypair.publicKey,
          usdcAtomic
        )
        console.log(chalk.gray(`Funded agent ${agent.agentId} USDC wallet: ${signature}`))
      } catch (error) {
        console.warn(
          chalk.yellow(`Could not fund USDC for agent ${agent.agentId}: ${errorMessage(error)}`)
        )
      }
    }
  }

  private async syncAgentCounter(swarm: PublicKey): Promise<void> {
    try {
      const swarmAccount = await this.client.getSwarm(swarm)
      const agents = await this.client.getAllAgents(swarm)
      const maxAgentId = agents.reduce((max, agent) => Math.max(max, agent.agentId), 0)
      const maxGeneration = agents.reduce((max, agent) => Math.max(max, agent.generation), 0)
      const totalSpawned = chainNumber(swarmAccount?.totalSpawned)
      const swarmGeneration = chainNumber(swarmAccount?.generation)

      if (agents.length === 0 && totalSpawned > 0) {
        console.warn(
          chalk.yellow(
            `[syncAgentCounter] No agent accounts decoded; using swarm.totalSpawned=${totalSpawned}.`
          )
        )
      }

      this.agentCounter = Math.max(this.agentCounter, maxAgentId, totalSpawned)
      this.currentGeneration = Math.max(this.currentGeneration, maxGeneration, swarmGeneration)
      console.log(
        chalk.gray(
          `Synced chain state: next agent id ${this.agentCounter + 1}, next generation ${this.currentGeneration + 1}`
        )
      )
    } catch (err) {
      // getProgramAccounts failed (likely 429) — fall back to swarm.totalSpawned
      console.warn(`[syncAgentCounter] getAllAgents failed: ${err instanceof Error ? err.message : err}`)
      console.warn('[syncAgentCounter] Falling back to swarm.totalSpawned for agent counter')
      try {
        const swarmAccount = await this.client.getSwarm(swarm)
        if (swarmAccount) {
          this.agentCounter = Math.max(this.agentCounter, chainNumber(swarmAccount.totalSpawned))
          this.currentGeneration = Math.max(
            this.currentGeneration,
            chainNumber(swarmAccount.generation)
          )
          console.warn(`[syncAgentCounter] Recovered: agentCounter=${this.agentCounter} generation=${this.currentGeneration}`)
        }
      } catch (fallbackErr) {
        console.error(`[syncAgentCounter] Fallback also failed: ${fallbackErr instanceof Error ? fallbackErr.message : fallbackErr}`)
        console.error('[syncAgentCounter] Agent counter not synced — run may collide with existing PDAs')
      }
    }
  }

  private adoptExistingSwarmOracle(existingSwarm: any): void {
    const storedOracle = existingSwarm.scoringOracle ?? existingSwarm.scoring_oracle
    if (!storedOracle || typeof storedOracle.toBase58 !== 'function') return

    const oraclePublicKey = storedOracle as PublicKey
    if (oraclePublicKey.equals(this.oracleKeypair.publicKey)) return

    const matchingOracle = loadLocalKeypairForPublicKey(oraclePublicKey)
    if (!matchingOracle) {
      throw new Error(
        `Existing swarm was initialized with scoring oracle ${oraclePublicKey.toBase58()}, ` +
          `but ORACLE_WALLET resolves to ${this.oracleKeypair.publicKey.toBase58()} and no matching local keypair was found.`
      )
    }

    this.oracleKeypair = matchingOracle
    console.warn(
      chalk.yellow(
        `Existing swarm uses scoring oracle ${oraclePublicKey.toBase58()}; using the matching local oracle keypair.`
      )
    )
  }

  private async writeFailureToArweave(agentId: number, failureSummary: string): Promise<string> {
    const uri = `ar://mock-${agentId}-${Date.now()}`
    this.failureTextByUri.set(uri, failureSummary)
    this.persistFailureText(uri, agentId, failureSummary)
    return uri
  }

  private readFailureText(uri: string): string | null {
    const cached = this.failureTextByUri.get(uri)
    if (cached) return cached

    const index = this.readLineageStoreIndex()
    const fileName = index[uri]
    if (!fileName) return null

    const filePath = path.join(this.lineageStoreDir(), fileName)
    if (!fs.existsSync(filePath)) return null

    try {
      const stored = fs.readFileSync(filePath, 'utf8')
      this.failureTextByUri.set(uri, stored)
      return stored
    } catch {
      return null
    }
  }

  private persistFailureText(uri: string, agentId: number, failureSummary: string): void {
    try {
      const dir = this.lineageStoreDir()
      fs.mkdirSync(dir, { recursive: true })

      const fileName = `${agentId}-${Date.now()}.json`
      fs.writeFileSync(path.join(dir, fileName), failureSummary)

      const index = this.readLineageStoreIndex()
      index[uri] = fileName
      fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index, null, 2))
    } catch (error) {
      console.warn(chalk.yellow(`Could not persist local lineage memory: ${errorMessage(error)}`))
    }
  }

  private readLineageStoreIndex(): Record<string, string> {
    const indexPath = path.join(this.lineageStoreDir(), 'index.json')
    if (!fs.existsSync(indexPath)) return {}

    try {
      const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, string>)
        : {}
    } catch {
      return {}
    }
  }

  private lineageStoreDir(): string {
    return path.join(lineageMemoryRootDir(), this.swarmAddress ?? 'uninitialized')
  }

  private requireSwarmAddress(): string {
    if (!this.swarmAddress) {
      throw new Error('Swarm has not been initialized')
    }
    return this.swarmAddress
  }

  private async buildFailureSummary(agent: ChildAgent): Promise<string> {
    const score = agent.lastScore ?? 0
    const actual = agent.lastAccuracyDetails?.actual ?? null
    const claimed = agent.lastAccuracyDetails?.claimed ?? null
    const best = agent.lastAccuracyDetails?.best ?? null
    const delta = agent.lastAccuracyDetails?.delta ?? null
    const breakdown = agent.lastScoringBreakdown ?? null

    let failureReason: string
    if (claimed !== null && actual !== null && delta !== null && delta > 0.005) {
      const ratio = actual.apy > 0 ? claimed / actual.apy : 0
      failureReason =
        ratio > 1.1
          ? `Hallucinated APY ${(ratio).toFixed(1)}x higher than real (claimed ${(claimed * 100).toFixed(2)}%, actual ${(actual.apy * 100).toFixed(2)}%)`
          : `APY accuracy insufficient (claimed ${(claimed * 100).toFixed(2)}%, actual ${(actual.apy * 100).toFixed(2)}%)`
    } else if (breakdown && breakdown.relevance < 35) {
      failureReason = `Output structure or evidence was incomplete (relevance ${breakdown.relevance}/40).`
    } else if (breakdown && breakdown.accuracy < 35) {
      failureReason = `Oracle accuracy score was too low (${breakdown.accuracy}/40): ${agent.lastAccuracyDetails?.reason ?? 'missing verifiable claims'}.`
    } else if (breakdown && breakdown.efficiency < 15) {
      failureReason = `Execution was too slow for the efficiency rubric (${breakdown.efficiency}/20).`
    } else {
      failureReason =
        agent.lastOracleFeedback ??
        `Composite score ${score}/100 fell below threshold ${this.config.scoringThreshold}/100.`
    }

    const fallbackPostMortem = this.buildDeterministicPostMortem(agent, failureReason)
    const venicePostMortem =
      (await generateVenicePostMortem({
        agentId: agent.agentId,
        generation: agent.generation,
        taskType: agent.taskType,
        score,
        threshold: this.config.scoringThreshold,
        output: agent.lastOutput,
        oracleFeedback: agent.lastOracleFeedback,
        scoringBreakdown: breakdown,
        accuracyDetails: agent.lastAccuracyDetails
      })) ?? fallbackPostMortem

    return JSON.stringify({
      agentId: agent.agentId,
      generation: agent.generation,
      taskType: agent.taskType,
      score,
      failureReason: venicePostMortem.failureReason || failureReason,
      rootCause: venicePostMortem.rootCause,
      correctiveRules: venicePostMortem.correctiveRules,
      promptHints: venicePostMortem.promptHints,
      riskWarnings: venicePostMortem.riskWarnings,
      evidence: venicePostMortem.evidence,
      claimedAPY: claimed !== null ? parseFloat((claimed * 100).toFixed(2)) : null,
      actualAPY: actual ? { protocol: actual.protocol, apy: actual.apy, vault: actual.vault } : null,
      bestAvailableAPY: best ? { protocol: best.protocol, apy: best.apy, vault: best.vault } : null,
      oracleFeedback: agent.lastOracleFeedback,
      scoringBreakdown: breakdown,
      venicePostMortem,
      agentOutput: agent.lastOutput ? agent.lastOutput.slice(0, 4000) : null,
    })
  }

  private buildDeterministicPostMortem(
    agent: ChildAgent,
    failureReason: string
  ): LineagePostMortem {
    if (agent.taskType === 'YieldOptimizer') {
      return {
        failureReason,
        rootCause:
          'The output did not give the scoring oracle enough exact, current, and structured yield evidence to clear the threshold.',
        correctiveRules: [
          'Use only protocol, vault, APY, TVL, and risk values from the current live yield table.',
          'Set expectedAPY as a decimal, not a percent string, and make it match the chosen row exactly.',
          'Include a separate riskAssessment that cites TVL, liquidity depth, utilization, or volatility risk.',
          'Name a real second-best alternative from the live list and include its decimal APY.'
        ],
        promptHints: [
          'Return raw JSON only; no markdown fences or prose outside the object.',
          'Keep reasoning to two evidence-dense sentences with APY and TVL numbers.'
        ],
        riskWarnings: [
          'Do not optimize only for headline APY when TVL is thin or risk score is high.'
        ],
        evidence: [
          agent.lastOracleFeedback ?? failureReason,
          agent.lastAccuracyDetails?.reason ?? 'No detailed accuracy record was available.'
        ]
      }
    }

    return {
      failureReason,
      rootCause: 'The output missed required task-specific evidence or schema requirements.',
      correctiveRules: [
        'Match the requested JSON schema exactly.',
        'Include concrete evidence that the scoring oracle can validate.',
        'Prioritize correctness over broad generic explanation.'
      ],
      promptHints: ['Return only valid JSON with no markdown fences.'],
      riskWarnings: ['Avoid unsupported claims.'],
      evidence: [agent.lastOracleFeedback ?? failureReason]
    }
  }
}

function hashTo32Bytes(input: string): Buffer {
  return crypto.createHash('sha256').update(input).digest()
}

function claimFromAgentOutput(output: string): SpawnAgentClaim {
  const parsed = parseJsonObject(output)
  const protocol = String(
    parsed.recommendedProtocol ??
      parsed.bestProtocol ??
      parsed.protocol ??
      parsed.recommendedVault ??
      'unknown'
  )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32)

  const rawApy = Number(parsed.expectedAPY ?? parsed.currentAPY ?? parsed.apy ?? NaN)
  const normalizedApy = Number.isFinite(rawApy) ? (rawApy > 1 ? rawApy / 100 : rawApy) : 0
  const claimedApyBps = Math.max(0, Math.min(10_000, Math.round(normalizedApy * 10_000)))

  return {
    claimedApyBps,
    claimedProtocol: protocol || 'unknown',
    taskOutputHash: hashTo32Bytes(output)
  }
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text)
    return asObject(parsed)
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return {}
    try {
      return asObject(JSON.parse(match[0]))
    } catch {
      return {}
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function readProgramId(): PublicKey {
  const value = process.env.SWARM_PROGRAM_ID?.trim()
  if (!value) {
    console.warn(
      chalk.yellow(
        `SWARM_PROGRAM_ID is not set. Using default devnet program ${DEFAULT_PROGRAM_ID}.`
      )
    )
    return new PublicKey(DEFAULT_PROGRAM_ID)
  }
  return new PublicKey(value)
}

function findRepoRoot(startDir: string): string {
  let current = startDir

  for (;;) {
    if (fs.existsSync(path.join(current, 'Anchor.toml'))) return current
    const parent = path.dirname(current)
    if (parent === current) return process.cwd()
    current = parent
  }
}

function resolveConfigPath(filePath: string): string {
  const expanded = expandHome(filePath)
  return path.isAbsolute(expanded) ? expanded : path.resolve(REPO_ROOT, expanded)
}

function expandHome(filePath: string): string {
  if (filePath === '~') return os.homedir()
  if (filePath.startsWith('~/')) return path.join(os.homedir(), filePath.slice(2))
  return filePath
}

function loadWalletFromEnv(args: string[] = []): Keypair {
  const walletPath =
    readFlag(args, '--wallet') ||
    process.env.SWARM_AUTHORITY_WALLET ||
    process.env.ANCHOR_WALLET ||
    '~/.config/solana/id.json'
  const resolved = resolveConfigPath(walletPath)
  return readKeypairFile(resolved, 'Wallet')
}

async function loadRuntimeWallet(
  args: string[],
  connection: Connection
): Promise<{ wallet: Keypair; authorityPath: string | null; fresh: boolean }> {
  if (!args.includes('--fresh') && !args.includes('--new-swarm')) {
    return { wallet: loadWalletFromEnv(args), authorityPath: null, fresh: false }
  }

  const funder = loadWalletFromEnv(args)
  const { wallet, filePath } = createFreshAuthorityKeypair()
  await fundFreshAuthority(connection, funder, wallet)

  return { wallet, authorityPath: filePath, fresh: true }
}

function createFreshAuthorityKeypair(): { wallet: Keypair; filePath: string } {
  const wallet = Keypair.generate()
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  const filePath = path.join(SWARM_AUTHORITY_DIR, `authority-${stamp}-${wallet.publicKey.toBase58().slice(0, 8)}.json`)

  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(Array.from(wallet.secretKey)))

  return { wallet, filePath }
}

async function fundFreshAuthority(
  connection: Connection,
  funder: Keypair,
  authority: Keypair
): Promise<void> {
  if (process.env.SKIP_FRESH_AUTHORITY_FUNDING === 'true') {
    console.log(chalk.yellow('Skipping fresh authority funding because SKIP_FRESH_AUTHORITY_FUNDING=true'))
    return
  }

  const lamports = Number(process.env.FRESH_SWARM_SOL_LAMPORTS ?? 0.25 * LAMPORTS_PER_SOL)
  if (!Number.isFinite(lamports) || lamports <= 0) return

  const balance = await connection.getBalance(funder.publicKey, 'confirmed').catch(() => 0)
  if (balance <= lamports + 10_000) {
    console.warn(
      chalk.yellow(
        `Fresh authority ${authority.publicKey.toBase58()} was created but not funded; ` +
          `funder ${funder.publicKey.toBase58()} has insufficient SOL.`
      )
    )
    return
  }

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: funder.publicKey,
      toPubkey: authority.publicKey,
      lamports
    })
  )
  const signature = await sendAndConfirmTransaction(connection, tx, [funder], {
    commitment: 'confirmed'
  })
  console.log(
    chalk.gray(
      `Funded fresh swarm authority ${authority.publicKey.toBase58()} with ${(lamports / LAMPORTS_PER_SOL).toFixed(3)} SOL: ${signature}`
    )
  )
}

function loadOracleKeypair(): Keypair {
  const walletPath = process.env.ORACLE_WALLET || DEFAULT_ORACLE_WALLET
  const resolved = resolveConfigPath(walletPath)

  if (!fs.existsSync(resolved)) {
    const generated = Keypair.generate()
    fs.mkdirSync(path.dirname(resolved), { recursive: true })
    fs.writeFileSync(resolved, JSON.stringify(Array.from(generated.secretKey)))
    return generated
  }

  return readKeypairFile(resolved, 'Oracle wallet')
}

function loadLocalKeypairForPublicKey(publicKey: PublicKey): Keypair | null {
  const candidates = [
    process.env.ORACLE_WALLET,
    DEFAULT_ORACLE_WALLET,
    path.join(REPO_ROOT, 'packages/agent-runtime/packages/scoring-oracle/oracle-keypair.json')
  ]
    .filter((candidate): candidate is string => Boolean(candidate))
    .map(resolveConfigPath)

  for (const candidate of Array.from(new Set(candidates))) {
    if (!fs.existsSync(candidate)) continue
    const keypair = readKeypairFile(candidate, 'Oracle wallet')
    if (keypair.publicKey.equals(publicKey)) return keypair
  }

  return null
}

function readKeypairFile(filePath: string, label: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  const secretKey = Array.isArray(raw) ? raw : raw.secretKey

  if (!Array.isArray(secretKey)) {
    throw new Error(`${label} file ${filePath} must contain a Solana secret key array`)
  }

  return Keypair.fromSecretKey(Uint8Array.from(secretKey))
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function numberOr(fallback: number, value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function chainNumber(value: unknown): number {
  if (value == null) return 0
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  if (typeof (value as { toNumber?: unknown }).toNumber === 'function') {
    return (value as { toNumber: () => number }).toNumber()
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function lineageMemoryRootDir(): string {
  return process.env.LINEAGE_MEMORY_DIR
    ? resolveConfigPath(process.env.LINEAGE_MEMORY_DIR)
    : path.join(REPO_ROOT, 'packages/agent-runtime/.lineage-memory')
}

function archiveLocalRuntimeState(swarmAddress?: string): void {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  const archiveBase = path.join(STATE_ARCHIVE_DIR, stamp)
  const targets = swarmAddress
    ? [
        { label: `agent-wallets-${swarmAddress}`, from: path.join(AGENT_WALLET_DIR, swarmAddress) },
        { label: `lineage-memory-${swarmAddress}`, from: path.join(lineageMemoryRootDir(), swarmAddress) }
      ]
    : [
        { label: 'agent-wallets', from: AGENT_WALLET_DIR },
        { label: 'lineage-memory', from: lineageMemoryRootDir() }
      ]

  let moved = 0
  fs.mkdirSync(archiveBase, { recursive: true })

  for (const target of targets) {
    if (!fs.existsSync(target.from)) continue
    const destination = path.join(archiveBase, target.label)
    fs.renameSync(target.from, destination)
    moved += 1
    console.log(chalk.gray(`Archived ${target.from} -> ${destination}`))
  }

  if (moved === 0) {
    console.log(chalk.yellow('No local generation state found to archive.'))
  }
}

function upsertEnvValue(filePath: string, key: string, value: string): void {
  const resolved = resolveConfigPath(filePath)
  const existing = fs.existsSync(resolved) ? fs.readFileSync(resolved, 'utf8') : ''
  const lines = existing ? existing.split(/\r?\n/) : []
  const nextLine = `${key}=${value}`
  let replaced = false

  const next = lines.map((line) => {
    if (!line.startsWith(`${key}=`)) return line
    replaced = true
    return nextLine
  })

  if (!replaced) {
    if (next.length > 0 && next[next.length - 1] !== '') next.push('')
    next.push(nextLine)
  }

  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  fs.writeFileSync(resolved, `${next.join('\n').replace(/\n+$/, '')}\n`)
}

function writeFreshSwarmEnv(authorityPath: string, swarmAddress: string): void {
  const relativeAuthorityPath = path.relative(REPO_ROOT, authorityPath)
  upsertEnvValue('.env', 'SWARM_AUTHORITY_WALLET', relativeAuthorityPath)
  upsertEnvValue('.env', 'ANCHOR_WALLET', relativeAuthorityPath)
  upsertEnvValue('.env', 'NEXT_PUBLIC_SWARM_ADDRESS', swarmAddress)
  upsertEnvValue('dashboard/.env.local', 'NEXT_PUBLIC_SWARM_ADDRESS', swarmAddress)

  console.log(chalk.green(`Updated local env files for fresh swarm ${swarmAddress}`))
}

function parseTask(value: string | undefined): TaskType {
  switch ((value || 'yield-optimizer').toLowerCase()) {
    case 'yield':
    case 'yield-optimizer':
    case 'yieldoptimizer':
      return 'YieldOptimizer'
    case 'code':
    case 'code-reviewer':
    case 'codereviewer':
      return 'CodeReviewer'
    case 'data':
    case 'data-synthesizer':
    case 'datasynthesizer':
      return 'DataSynthesizer'
    default:
      throw new Error(`Unknown task type: ${value}`)
  }
}

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  return args[index + 1]
}

function parseCliConfig(args: string[]): SwarmConfig {
  return {
    name: readFlag(args, '--name') || 'SwarmOS Hackathon Swarm',
    scoringThreshold: Number(readFlag(args, '--threshold') || 60),
    taskType: parseTask(readFlag(args, '--task')),
    agentsPerGeneration: Number(readFlag(args, '--agents') || 5),
    maxGenerations: Number(readFlag(args, '--generations') || 3)
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const config = parseCliConfig(args)
  const connection = new Connection(process.env.RPC_URL || 'https://api.devnet.solana.com', {
    commitment: 'confirmed'
  })

  if (args.includes('--reset-local-all')) {
    archiveLocalRuntimeState()
    return
  }

  const { wallet, authorityPath, fresh } = await loadRuntimeWallet(args, connection)
  const parent = new ParentAgent(config, connection, wallet)
  const swarmAddress = parent.client.swarmPDA(wallet.publicKey).toBase58()

  console.log(chalk.bold('SwarmOS ParentAgent starting'))
  console.log(
    chalk.gray(
      `task=${config.taskType} agents=${config.agentsPerGeneration} generations=${config.maxGenerations} threshold=${config.scoringThreshold}`
    )
  )

  if (fresh) {
    console.log(chalk.green(`Fresh swarm authority: ${wallet.publicKey.toBase58()}`))
    console.log(chalk.green(`Fresh swarm PDA: ${swarmAddress}`))
    if (authorityPath) {
      console.log(chalk.gray(`Authority keypair: ${path.relative(REPO_ROOT, authorityPath)}`))
      if (args.includes('--write-env')) {
        writeFreshSwarmEnv(authorityPath, swarmAddress)
      } else {
        console.log(
          chalk.gray(
            `Set NEXT_PUBLIC_SWARM_ADDRESS=${swarmAddress} in dashboard/.env.local to view this swarm.`
          )
        )
      }
    }
  }

  if (args.includes('--reset-local')) {
    archiveLocalRuntimeState(swarmAddress)
    return
  }

  if (args.includes('--reclaim-dead')) {
    await parent.reclaimDeadAgentFunds()
    return
  }

  await parent.runFullSwarm(args.includes('--forever'))
}

if (require.main === module) {
  main().catch((error) => {
    console.error(chalk.red(errorMessage(error)))
    process.exit(1)
  })
}
