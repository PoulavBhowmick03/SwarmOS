use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;
use state::*;

declare_id!("D9moMaWzJw3LVxnZkiXS7xrTUHmF4n3hJeDWCvbB7B1a");

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[event]
pub struct AgentSpawned {
    pub agent_id: u64,
    pub generation: u64,
    pub swarm: Pubkey,
}

#[event]
pub struct AgentScored {
    pub agent_id: u64,
    pub score: u8,
}

#[event]
pub struct AgentTerminated {
    pub agent_id: u64,
    pub score: u8,
    pub generation: u64,
}

#[event]
pub struct AgentSurvived {
    pub agent_id: u64,
    pub score: u8,
}

#[event]
pub struct AgentRespawned {
    pub new_agent_id: u64,
    pub parent_agent_id: u64,
    pub lineage_hash: [u8; 32],
}

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

#[program]
pub mod swarm_os {
    use super::*;

    pub fn initialize_swarm(
        ctx: Context<InitializeSwarm>,
        name: String,
        scoring_threshold: u8,
        scoring_oracle: Pubkey,
        task_type: TaskType,
    ) -> Result<()> {
        instructions::initialize_swarm::handler(
            ctx,
            name,
            scoring_threshold,
            scoring_oracle,
            task_type,
        )
    }

    pub fn spawn_agent(
        ctx: Context<SpawnAgent>,
        agent_id: u64,
        parent_id: Option<u64>,
        lineage_hash: [u8; 32],
    ) -> Result<()> {
        instructions::spawn_agent::handler(ctx, agent_id, parent_id, lineage_hash)
    }

    pub fn submit_score(ctx: Context<SubmitScore>, agent_id: u64, score: u8) -> Result<()> {
        instructions::submit_score::handler(ctx, agent_id, score)
    }

    pub fn evaluate_and_prune(
        ctx: Context<EvaluateAndPrune>,
        agent_id: u64,
        failure_reason_hash: [u8; 32],
        arweave_uri: String,
    ) -> Result<()> {
        instructions::evaluate_and_prune::handler(ctx, agent_id, failure_reason_hash, arweave_uri)
    }

    pub fn respawn_successor(
        ctx: Context<RespawnSuccessor>,
        new_agent_id: u64,
        parent_agent_id: u64,
    ) -> Result<()> {
        instructions::respawn_successor::handler(ctx, new_agent_id, parent_agent_id)
    }

    pub fn bump_generation(ctx: Context<BumpGeneration>) -> Result<()> {
        instructions::bump_generation::handler(ctx)
    }
}
