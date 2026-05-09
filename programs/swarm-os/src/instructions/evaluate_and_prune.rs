use crate::errors::SwarmError;
use crate::state::*;
use crate::{AgentSurvived, AgentTerminated};
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(agent_id: u64)]
pub struct EvaluateAndPrune<'info> {
    #[account(
        mut,
        seeds = [b"agent", swarm.key().as_ref(), &agent_id.to_le_bytes()],
        bump = agent.bump,
        constraint = agent.swarm == swarm.key() @ SwarmError::SwarmMismatch
    )]
    pub agent: Account<'info, Agent>,

    #[account(
        init_if_needed,
        payer = authority,
        space = LineageMemory::LEN,
        seeds = [b"lineage", swarm.key().as_ref(), &agent_id.to_le_bytes()],
        bump
    )]
    pub lineage_memory: Account<'info, LineageMemory>,

    #[account(
        mut,
        constraint = swarm.authority == authority.key() @ SwarmError::Unauthorized
    )]
    pub swarm: Account<'info, Swarm>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<EvaluateAndPrune>,
    _agent_id: u64,
    failure_reason_hash: [u8; 32],
    arweave_uri: String,
) -> Result<()> {
    require!(
        arweave_uri.len() <= LineageMemory::MAX_ARWEAVE_URI_LEN,
        SwarmError::UriTooLong
    );
    require!(
        ctx.accounts.agent.status == AgentStatus::Scored,
        SwarmError::InvalidAgentStatus
    );

    let clock = Clock::get()?;
    let threshold = ctx.accounts.swarm.scoring_threshold;
    let agent_score = ctx.accounts.agent.score;
    let agent_generation = ctx.accounts.agent.generation;
    let agent_id = ctx.accounts.agent.agent_id;
    let task_type = ctx.accounts.agent.task_type.clone();
    let swarm_key = ctx.accounts.swarm.key();

    // Always persist the canonical bump so RespawnSuccessor can verify seeds
    // regardless of which path (survived/terminated) this account was first created on.
    ctx.accounts.lineage_memory.bump = ctx.bumps.lineage_memory;

    if agent_score < threshold {
        ctx.accounts.agent.status = AgentStatus::Terminated;
        ctx.accounts.agent.termination_timestamp = clock.unix_timestamp;

        let lineage = &mut ctx.accounts.lineage_memory;
        lineage.agent_id = agent_id;
        lineage.swarm = swarm_key;
        lineage.generation = agent_generation;
        lineage.task_type = task_type;
        lineage.failure_score = agent_score;
        lineage.failure_reason_hash = failure_reason_hash;
        lineage.arweave_uri = arweave_uri;
        lineage.timestamp = clock.unix_timestamp;

        emit!(AgentTerminated {
            agent_id,
            score: agent_score,
            generation: agent_generation,
        });
    } else {
        ctx.accounts.agent.status = AgentStatus::Survived;

        emit!(AgentSurvived {
            agent_id,
            score: agent_score,
        });
    }

    ctx.accounts.swarm.active_agent_count = ctx
        .accounts
        .swarm
        .active_agent_count
        .checked_sub(1)
        .ok_or(SwarmError::ArithmeticOverflow)?;

    Ok(())
}
