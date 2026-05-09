import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import type { SwarmOs } from "../target/types/swarm_os";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
} from "@solana/spl-token";
import { assert } from "chai";
import * as crypto from "crypto";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function agentSeed(agentId: BN): Buffer {
  return agentId.toArrayLike(Buffer, "le", 8);
}

function sha256(text: string): number[] {
  return Array.from(crypto.createHash("sha256").update(text).digest());
}

function findSwarmPda(authority: PublicKey, programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("swarm"), authority.toBuffer()],
    programId
  );
}

function findAgentPda(swarm: PublicKey, agentId: BN, programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), swarm.toBuffer(), agentSeed(agentId)],
    programId
  );
}

function findLineagePda(swarm: PublicKey, agentId: BN, programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("lineage"), swarm.toBuffer(), agentSeed(agentId)],
    programId
  );
}

async function withBlockhashRetry<T>(send: () => Promise<T>, attempts = 5): Promise<T> {
  let lastError: unknown;

  for (let i = 0; i < attempts; i += 1) {
    try {
      return await send();
    } catch (error) {
      lastError = error;
      if (!String(error).includes("Blockhash not found") || i === attempts - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("swarm-os", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SwarmOs as Program<SwarmOs>;
  const authority = Keypair.generate();
  const oracle = Keypair.generate();

  let swarmPda: PublicKey;
  let treasury: PublicKey;
  let usdcMint: PublicKey;

  const AGENT_IDS = [new BN(0), new BN(1), new BN(2)];
  const SUCCESSOR_ID = new BN(3);

  // Scores: agent 0 = 75 (survive), agent 1 = 45 (terminate), agent 2 = 82 (survive)
  const SCORES = [75, 45, 82];
  const SCORING_THRESHOLD = 60;

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------

  before(async () => {
    await withBlockhashRetry(() =>
      provider.sendAndConfirm(
        new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: provider.wallet.publicKey,
            toPubkey: authority.publicKey,
            lamports: LAMPORTS_PER_SOL,
          }),
          SystemProgram.transfer({
            fromPubkey: provider.wallet.publicKey,
            toPubkey: oracle.publicKey,
            lamports: LAMPORTS_PER_SOL / 10,
          })
        )
      )
    );

    // Create a test USDC mint (6 decimals)
    usdcMint = await createMint(
      provider.connection,
      authority,
      authority.publicKey,
      null,
      6
    );

    // Create treasury token account
    treasury = await createAccount(
      provider.connection,
      authority,
      usdcMint,
      authority.publicKey
    );

    [swarmPda] = findSwarmPda(authority.publicKey, program.programId);
  });

  // ---------------------------------------------------------------------------
  // 1. Initialize swarm
  // ---------------------------------------------------------------------------

  it("initializes a swarm", async () => {
    await withBlockhashRetry(() =>
      program.methods
        .initializeSwarm("TestSwarm", SCORING_THRESHOLD, oracle.publicKey, { yieldOptimizer: {} })
        .accounts({
          swarm: swarmPda,
          authority: authority.publicKey,
          treasury,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc({ commitment: "confirmed" })
    );

    const swarm = await program.account.swarm.fetch(swarmPda, "confirmed");

    assert.equal(swarm.name, "TestSwarm");
    assert.equal(swarm.scoringThreshold, SCORING_THRESHOLD);
    assert.ok(swarm.generation.eqn(0), "generation should be 0");
    assert.equal(swarm.activeAgentCount, 0);
    assert.ok(swarm.totalSpawned.eqn(0), "totalSpawned should be 0");
    assert.ok(swarm.authority.equals(authority.publicKey));
    assert.ok(swarm.scoringOracle.equals(oracle.publicKey));
    assert.ok(swarm.treasury.equals(treasury));
  });

  // ---------------------------------------------------------------------------
  // 2. Spawn 3 agents
  // ---------------------------------------------------------------------------

  it("spawns 3 agents", async () => {
    const zeroHash = Array(32).fill(0);

    for (const agentId of AGENT_IDS) {
      const [agentPda] = findAgentPda(swarmPda, agentId, program.programId);

      await withBlockhashRetry(() =>
        program.methods
          .spawnAgent(agentId, null, zeroHash)
          .accounts({
            agent: agentPda,
            swarm: swarmPda,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([authority])
          .rpc({ commitment: "confirmed" })
      );
    }

    const swarm = await program.account.swarm.fetch(swarmPda, "confirmed");
    assert.equal(swarm.activeAgentCount, 3, "should have 3 active agents");
    assert.ok(swarm.totalSpawned.eqn(3), "totalSpawned should be 3");

    // Verify each agent account
    for (let i = 0; i < AGENT_IDS.length; i++) {
      const [agentPda] = findAgentPda(swarmPda, AGENT_IDS[i], program.programId);
      const agent = await program.account.agent.fetch(agentPda, "confirmed");

      assert.ok(agent.agentId.eqn(i), `agent ${i} id mismatch`);
      assert.ok(agent.swarm.equals(swarmPda));
      assert.ok(agent.generation.eqn(0));
      assert.equal(agent.score, 0);
      assert.isNull(agent.parentId);
      assert.deepEqual(agent.status, { active: {} });
    }
  });

  // ---------------------------------------------------------------------------
  // 3. Submit scores
  // ---------------------------------------------------------------------------

  it("submits scores: agent0=75, agent1=45, agent2=82", async () => {
    for (let i = 0; i < AGENT_IDS.length; i++) {
      const [agentPda] = findAgentPda(swarmPda, AGENT_IDS[i], program.programId);

      await withBlockhashRetry(() =>
        program.methods
          .submitScore(AGENT_IDS[i], SCORES[i])
          .accounts({
            agent: agentPda,
            swarm: swarmPda,
            oracle: oracle.publicKey,
          })
          .signers([oracle])
          .rpc({ commitment: "confirmed" })
      );
    }

    // Verify scored status
    for (let i = 0; i < AGENT_IDS.length; i++) {
      const [agentPda] = findAgentPda(swarmPda, AGENT_IDS[i], program.programId);
      const agent = await program.account.agent.fetch(agentPda, "confirmed");

      assert.equal(agent.score, SCORES[i], `agent ${i} score mismatch`);
      assert.deepEqual(agent.status, { scored: {} });
    }
  });

  // ---------------------------------------------------------------------------
  // 4. Evaluate and prune
  //    agent0 (75) → survived, agent1 (45) → terminated, agent2 (82) → survived
  // ---------------------------------------------------------------------------

  it("evaluates agents: agent0 and agent2 survive, agent1 is terminated", async () => {
    const emptyHash = Array(32).fill(0);
    const agent1FailureText = "Agent 1 failed: poor yield optimization strategy";
    const agent1FailureHash = sha256(agent1FailureText);
    const agent1ArweaveUri = "ar://Qm000000000000000000000000000000000000000000";

    for (let i = 0; i < AGENT_IDS.length; i++) {
      const agentId = AGENT_IDS[i];
      const [agentPda] = findAgentPda(swarmPda, agentId, program.programId);
      const [lineagePda] = findLineagePda(swarmPda, agentId, program.programId);

      const isTerminated = i === 1;
      const failureHash = isTerminated ? agent1FailureHash : emptyHash;
      const arweaveUri = isTerminated ? agent1ArweaveUri : "";

      await withBlockhashRetry(() =>
        program.methods
          .evaluateAndPrune(agentId, failureHash, arweaveUri)
          .accounts({
            agent: agentPda,
            lineageMemory: lineagePda,
            swarm: swarmPda,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([authority])
          .rpc({ commitment: "confirmed" })
      );
    }

    // Verify agent statuses
    const [agent0Pda] = findAgentPda(swarmPda, AGENT_IDS[0], program.programId);
    const [agent1Pda] = findAgentPda(swarmPda, AGENT_IDS[1], program.programId);
    const [agent2Pda] = findAgentPda(swarmPda, AGENT_IDS[2], program.programId);

    const agent0 = await program.account.agent.fetch(agent0Pda, "confirmed");
    const agent1 = await program.account.agent.fetch(agent1Pda, "confirmed");
    const agent2 = await program.account.agent.fetch(agent2Pda, "confirmed");

    assert.deepEqual(agent0.status, { survived: {} }, "agent0 should have survived");
    assert.deepEqual(agent1.status, { terminated: {} }, "agent1 should be terminated");
    assert.deepEqual(agent2.status, { survived: {} }, "agent2 should have survived");
    assert.notEqual(
      agent1.terminationTimestamp.toNumber(),
      0,
      "agent1 termination timestamp should be set"
    );

    // All three agents are no longer Active after evaluation.
    const swarm = await program.account.swarm.fetch(swarmPda, "confirmed");
    assert.equal(swarm.activeAgentCount, 0, "should have no active agents after prune");
  });

  // ---------------------------------------------------------------------------
  // 5. Verify LineageMemory PDA was created for agent 1
  // ---------------------------------------------------------------------------

  it("verifies LineageMemory PDA was created for agent 1", async () => {
    const agent1FailureText = "Agent 1 failed: poor yield optimization strategy";
    const expectedFailureHash = sha256(agent1FailureText);

    const [lineagePda] = findLineagePda(swarmPda, AGENT_IDS[1], program.programId);
    const lineage = await program.account.lineageMemory.fetch(lineagePda, "confirmed");

    assert.ok(lineage.agentId.eqn(1), "lineage agentId should be 1");
    assert.ok(lineage.swarm.equals(swarmPda));
    assert.ok(lineage.generation.eqn(0));
    assert.equal(lineage.failureScore, 45);
    assert.deepEqual(
      lineage.failureReasonHash,
      expectedFailureHash,
      "failure reason hash mismatch"
    );
    assert.equal(
      lineage.arweaveUri,
      "ar://Qm000000000000000000000000000000000000000000"
    );
    assert.deepEqual(lineage.taskType, { yieldOptimizer: {} });
    assert.notEqual(lineage.timestamp.toNumber(), 0);
  });

  // ---------------------------------------------------------------------------
  // 6. Respawn successor for agent 1
  // ---------------------------------------------------------------------------

  it("respawns a successor for terminated agent 1", async () => {
    const [agent1LineagePda] = findLineagePda(swarmPda, AGENT_IDS[1], program.programId);
    const [successorPda] = findAgentPda(swarmPda, SUCCESSOR_ID, program.programId);

    await withBlockhashRetry(() =>
      program.methods
        .respawnSuccessor(SUCCESSOR_ID, AGENT_IDS[1])
        .accounts({
          newAgent: successorPda,
          parentLineage: agent1LineagePda,
          swarm: swarmPda,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc({ commitment: "confirmed" })
    );

    const swarm = await program.account.swarm.fetch(swarmPda, "confirmed");
    assert.equal(swarm.activeAgentCount, 1, "should have 1 active agent after respawn");
    assert.ok(swarm.totalSpawned.eqn(4), "totalSpawned should be 4");
  });

  // ---------------------------------------------------------------------------
  // 7. Verify successor lineage_hash matches agent 1's failure_reason_hash
  // ---------------------------------------------------------------------------

  it("verifies successor has lineage_hash matching agent1 failure_reason_hash", async () => {
    const [successorPda] = findAgentPda(swarmPda, SUCCESSOR_ID, program.programId);
    const [agent1LineagePda] = findLineagePda(swarmPda, AGENT_IDS[1], program.programId);

    const successor = await program.account.agent.fetch(successorPda, "confirmed");
    const lineage = await program.account.lineageMemory.fetch(agent1LineagePda, "confirmed");

    assert.ok(successor.agentId.eqn(3), "successor agent id should be 3");
    assert.ok(successor.generation.eqn(1), "successor should be generation 1");
    assert.deepEqual(successor.status, { active: {} }, "successor should be active");
    assert.isNotNull(successor.parentId, "successor should have a parent");
    assert.ok(
      (successor.parentId as BN).eqn(1),
      "successor parent should be agent 1"
    );
    assert.deepEqual(
      successor.lineageHash,
      lineage.failureReasonHash,
      "successor lineageHash must match agent1 failureReasonHash"
    );
  });
});
