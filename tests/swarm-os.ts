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
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  getAccount,
  getAssociatedTokenAddressSync,
  mintTo,
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

function findAgentUsdcAta(agent: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, agent, true);
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

  const AGENT_USDC_FUNDING_AMOUNT = 10_000;
  const INITIAL_TREASURY_USDC = 1_000_000;
  const AGENT_IDS = [new BN(0), new BN(1), new BN(2)];
  const HIGH_APY_AGENT_ID = new BN(3);
  const SUCCESSOR_ID = new BN(4);

  const AGENT_CLAIMS = [
    {
      claimedApyBps: 926,
      claimedProtocol: "Kamino",
      output: JSON.stringify({ protocol: "Kamino", apy: 0.0926 }),
    },
    {
      claimedApyBps: 440,
      claimedProtocol: "JupiterLend",
      output: JSON.stringify({ protocol: "JupiterLend", apy: 0.044 }),
    },
    {
      claimedApyBps: 1120,
      claimedProtocol: "Drift",
      output: JSON.stringify({ protocol: "Drift", apy: 0.112 }),
    },
  ];

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

    // Create and fund the swarm treasury token account
    treasury = await createAccount(
      provider.connection,
      authority,
      usdcMint,
      authority.publicKey
    );
    await mintTo(
      provider.connection,
      authority,
      usdcMint,
      treasury,
      authority,
      INITIAL_TREASURY_USDC
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
    const treasuryAccount = await getAccount(provider.connection, treasury, "confirmed");

    assert.equal(swarm.name, "TestSwarm");
    assert.equal(swarm.scoringThreshold, SCORING_THRESHOLD);
    assert.ok(swarm.generation.eqn(0), "generation should be 0");
    assert.equal(swarm.activeAgentCount, 0);
    assert.ok(swarm.totalSpawned.eqn(0), "totalSpawned should be 0");
    assert.ok(swarm.authority.equals(authority.publicKey));
    assert.ok(swarm.scoringOracle.equals(oracle.publicKey));
    assert.ok(swarm.treasury.equals(treasury));
    assert.equal(Number(treasuryAccount.amount), INITIAL_TREASURY_USDC);
  });

  // ---------------------------------------------------------------------------
  // 2. Spawn 3 agents
  // ---------------------------------------------------------------------------

  it("spawns 3 agents with stored claims and USDC ATAs", async () => {
    const zeroHash = Array(32).fill(0);

    for (let i = 0; i < AGENT_IDS.length; i++) {
      const agentId = AGENT_IDS[i];
      const claim = AGENT_CLAIMS[i];
      const [agentPda] = findAgentPda(swarmPda, agentId, program.programId);
      const agentUsdcAta = findAgentUsdcAta(agentPda, usdcMint);

      await withBlockhashRetry(() =>
        program.methods
          .spawnAgent({
            agentId,
            parentId: null,
            lineageHash: zeroHash,
            claimedApyBps: claim.claimedApyBps,
            claimedProtocol: claim.claimedProtocol,
            taskOutputHash: sha256(claim.output),
          })
          .accounts({
            agent: agentPda,
            agentUsdcAta,
            swarm: swarmPda,
            swarmTreasury: treasury,
            authority: authority.publicKey,
            usdcMint,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([authority])
          .rpc({ commitment: "confirmed" })
      );
    }

    const swarm = await program.account.swarm.fetch(swarmPda, "confirmed");
    assert.equal(swarm.activeAgentCount, 3, "should have 3 active agents");
    assert.ok(swarm.totalSpawned.eqn(3), "totalSpawned should be 3");

    // Verify each agent account and its funded USDC ATA
    for (let i = 0; i < AGENT_IDS.length; i++) {
      const [agentPda] = findAgentPda(swarmPda, AGENT_IDS[i], program.programId);
      const agentUsdcAta = findAgentUsdcAta(agentPda, usdcMint);
      const agent = await program.account.agent.fetch(agentPda, "confirmed");
      const agentTokenAccount = await getAccount(provider.connection, agentUsdcAta, "confirmed");

      assert.ok(agent.agentId.eqn(i), `agent ${i} id mismatch`);
      assert.ok(agent.swarm.equals(swarmPda));
      assert.ok(agent.generation.eqn(0));
      assert.equal(agent.score, 0);
      assert.isNull(agent.parentId);
      assert.deepEqual(agent.status, { active: {} });
      assert.equal(agent.claimedApyBps, AGENT_CLAIMS[i].claimedApyBps);
      assert.equal(agent.claimedProtocol, AGENT_CLAIMS[i].claimedProtocol);
      assert.deepEqual(agent.taskOutputHash, sha256(AGENT_CLAIMS[i].output));
      assert.ok(agentTokenAccount.owner.equals(agentPda));
      assert.ok(agentTokenAccount.mint.equals(usdcMint));
      assert.equal(Number(agentTokenAccount.amount), AGENT_USDC_FUNDING_AMOUNT);
    }

    const treasuryAccount = await getAccount(provider.connection, treasury, "confirmed");
    assert.equal(
      Number(treasuryAccount.amount),
      INITIAL_TREASURY_USDC - AGENT_IDS.length * AGENT_USDC_FUNDING_AMOUNT,
      "treasury should fund each spawned agent"
    );
  });

  // ---------------------------------------------------------------------------
  // 3. Suspicious score rejection and token reclaim
  // ---------------------------------------------------------------------------

  it("rejects suspicious top scores for extreme APY claims and reclaims USDC on termination", async () => {
    const zeroHash = Array(32).fill(0);
    const [agentPda] = findAgentPda(swarmPda, HIGH_APY_AGENT_ID, program.programId);
    const [lineagePda] = findLineagePda(swarmPda, HIGH_APY_AGENT_ID, program.programId);
    const agentUsdcAta = findAgentUsdcAta(agentPda, usdcMint);

    await withBlockhashRetry(() =>
      program.methods
        .spawnAgent({
          agentId: HIGH_APY_AGENT_ID,
          parentId: null,
          lineageHash: zeroHash,
          claimedApyBps: 6000,
          claimedProtocol: "ImaginaryStablecoinVault",
          taskOutputHash: sha256(JSON.stringify({ protocol: "ImaginaryStablecoinVault", apy: 0.6 })),
        })
        .accounts({
          agent: agentPda,
          agentUsdcAta,
          swarm: swarmPda,
          swarmTreasury: treasury,
          authority: authority.publicKey,
          usdcMint,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc({ commitment: "confirmed" })
    );

    try {
      await withBlockhashRetry(() =>
        program.methods
          .submitScore(HIGH_APY_AGENT_ID, 90)
          .accounts({
            agent: agentPda,
            swarm: swarmPda,
            oracle: oracle.publicKey,
          })
          .signers([oracle])
          .rpc({ commitment: "confirmed" })
      );
      assert.fail("submitScore should reject a suspicious high score");
    } catch (error) {
      assert.include(String(error), "SuspiciousScore");
    }

    const stillActiveAgent = await program.account.agent.fetch(agentPda, "confirmed");
    assert.equal(stillActiveAgent.score, 0);
    assert.deepEqual(stillActiveAgent.status, { active: {} });

    await withBlockhashRetry(() =>
      program.methods
        .submitScore(HIGH_APY_AGENT_ID, 55)
        .accounts({
          agent: agentPda,
          swarm: swarmPda,
          oracle: oracle.publicKey,
        })
        .signers([oracle])
        .rpc({ commitment: "confirmed" })
    );

    const scoredAgent = await program.account.agent.fetch(agentPda, "confirmed");
    assert.equal(scoredAgent.score, 55);
    assert.deepEqual(scoredAgent.status, { scored: {} });

    const treasuryBefore = await getAccount(provider.connection, treasury, "confirmed");

    await withBlockhashRetry(() =>
      program.methods
        .evaluateAndPrune(
          HIGH_APY_AGENT_ID,
          sha256("Extreme stablecoin APY claim failed on-chain sanity checks"),
          "ar://high-apy-agent"
        )
        .accounts({
          agent: agentPda,
          lineageMemory: lineagePda,
          swarm: swarmPda,
          agentUsdcAta,
          swarmTreasury: treasury,
          authority: authority.publicKey,
          usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc({ commitment: "confirmed" })
    );

    const treasuryAfter = await getAccount(provider.connection, treasury, "confirmed");
    const agentTokenAccount = await getAccount(provider.connection, agentUsdcAta, "confirmed");
    const terminatedAgent = await program.account.agent.fetch(agentPda, "confirmed");
    const swarm = await program.account.swarm.fetch(swarmPda, "confirmed");

    assert.equal(
      Number(treasuryAfter.amount),
      Number(treasuryBefore.amount) + AGENT_USDC_FUNDING_AMOUNT,
      "termination should reclaim agent USDC to treasury"
    );
    assert.equal(Number(agentTokenAccount.amount), 0);
    assert.deepEqual(terminatedAgent.status, { terminated: {} });
    assert.equal(swarm.activeAgentCount, 3, "suspicious agent should be pruned");
  });

  // ---------------------------------------------------------------------------
  // 4. Submit scores
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
  // 5. Evaluate and prune
  //    agent0 (75) -> survived, agent1 (45) -> terminated, agent2 (82) -> survived
  // ---------------------------------------------------------------------------

  it("evaluates agents: agent0 and agent2 survive, agent1 is terminated", async () => {
    const emptyHash = Array(32).fill(0);
    const agent1FailureText = "Agent 1 failed: poor yield optimization strategy";
    const agent1FailureHash = sha256(agent1FailureText);
    const agent1ArweaveUri = "ar://Qm000000000000000000000000000000000000000000";
    let treasuryBeforeAgent1Termination = 0;
    let treasuryAfterAgent1Termination = 0;

    for (let i = 0; i < AGENT_IDS.length; i++) {
      const agentId = AGENT_IDS[i];
      const [agentPda] = findAgentPda(swarmPda, agentId, program.programId);
      const [lineagePda] = findLineagePda(swarmPda, agentId, program.programId);
      const agentUsdcAta = findAgentUsdcAta(agentPda, usdcMint);

      const isTerminated = i === 1;
      const failureHash = isTerminated ? agent1FailureHash : emptyHash;
      const arweaveUri = isTerminated ? agent1ArweaveUri : "";

      if (isTerminated) {
        const treasuryBefore = await getAccount(provider.connection, treasury, "confirmed");
        treasuryBeforeAgent1Termination = Number(treasuryBefore.amount);
      }

      await withBlockhashRetry(() =>
        program.methods
          .evaluateAndPrune(agentId, failureHash, arweaveUri)
          .accounts({
            agent: agentPda,
            lineageMemory: lineagePda,
            swarm: swarmPda,
            agentUsdcAta,
            swarmTreasury: treasury,
            authority: authority.publicKey,
            usdcMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([authority])
          .rpc({ commitment: "confirmed" })
      );

      if (isTerminated) {
        const treasuryAfter = await getAccount(provider.connection, treasury, "confirmed");
        treasuryAfterAgent1Termination = Number(treasuryAfter.amount);
      }
    }

    // Verify agent statuses
    const [agent0Pda] = findAgentPda(swarmPda, AGENT_IDS[0], program.programId);
    const [agent1Pda] = findAgentPda(swarmPda, AGENT_IDS[1], program.programId);
    const [agent2Pda] = findAgentPda(swarmPda, AGENT_IDS[2], program.programId);
    const agent1UsdcAta = findAgentUsdcAta(agent1Pda, usdcMint);

    const agent0 = await program.account.agent.fetch(agent0Pda, "confirmed");
    const agent1 = await program.account.agent.fetch(agent1Pda, "confirmed");
    const agent2 = await program.account.agent.fetch(agent2Pda, "confirmed");
    const agent1TokenAccount = await getAccount(provider.connection, agent1UsdcAta, "confirmed");

    assert.deepEqual(agent0.status, { survived: {} }, "agent0 should have survived");
    assert.deepEqual(agent1.status, { terminated: {} }, "agent1 should be terminated");
    assert.deepEqual(agent2.status, { survived: {} }, "agent2 should have survived");
    assert.notEqual(
      agent1.terminationTimestamp.toNumber(),
      0,
      "agent1 termination timestamp should be set"
    );
    assert.equal(Number(agent1TokenAccount.amount), 0, "terminated agent USDC ATA should be empty");
    assert.equal(
      treasuryAfterAgent1Termination,
      treasuryBeforeAgent1Termination + AGENT_USDC_FUNDING_AMOUNT,
      "agent1 USDC should return to treasury on termination"
    );

    // All three agents are no longer Active after evaluation.
    const swarm = await program.account.swarm.fetch(swarmPda, "confirmed");
    assert.equal(swarm.activeAgentCount, 0, "should have no active agents after prune");
  });

  // ---------------------------------------------------------------------------
  // 6. Verify LineageMemory PDA was created for agent 1
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
  // 7. Respawn successor for agent 1
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
    assert.ok(swarm.totalSpawned.eqn(5), "totalSpawned should be 5");
  });

  // ---------------------------------------------------------------------------
  // 8. Verify successor lineage_hash matches agent 1's failure_reason_hash
  // ---------------------------------------------------------------------------

  it("verifies successor has lineage_hash matching agent1 failure_reason_hash", async () => {
    const [successorPda] = findAgentPda(swarmPda, SUCCESSOR_ID, program.programId);
    const [agent1LineagePda] = findLineagePda(swarmPda, AGENT_IDS[1], program.programId);

    const successor = await program.account.agent.fetch(successorPda, "confirmed");
    const lineage = await program.account.lineageMemory.fetch(agent1LineagePda, "confirmed");

    assert.ok(successor.agentId.eqn(4), "successor agent id should be 4");
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
