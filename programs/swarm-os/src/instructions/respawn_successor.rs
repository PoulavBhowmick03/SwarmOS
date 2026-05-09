use crate::errors::SwarmError;
use crate::state::*;
use crate::AgentRespawned;
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(new_agent_id: u64, parent_agent_id: u64)]
pub struct RespawnSuccessor<'info> {
    #[account(
        init,
        payer = authority,
        space = Agent::LEN,
        seeds = [b"agent", swarm.key().as_ref(), &new_agent_id.to_le_bytes()],
        bump
    )]
    pub new_agent: Account<'info, Agent>,

    #[account(
        seeds = [b"lineage", swarm.key().as_ref(), &parent_agent_id.to_le_bytes()],
        bump = parent_lineage.bump,
        constraint = parent_lineage.swarm == swarm.key() @ SwarmError::SwarmMismatch
    )]
    pub parent_lineage: Account<'info, LineageMemory>,

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
    ctx: Context<RespawnSuccessor>,
    new_agent_id: u64,
    parent_agent_id: u64,
) -> Result<()> {
    let clock = Clock::get()?;

    let lineage_hash = ctx.accounts.parent_lineage.failure_reason_hash;
    let parent_generation = ctx.accounts.parent_lineage.generation;
    let task_type = ctx.accounts.parent_lineage.task_type.clone();
    let swarm_key = ctx.accounts.swarm.key();

    let new_agent = &mut ctx.accounts.new_agent;
    new_agent.agent_id = new_agent_id;
    new_agent.swarm = swarm_key;
    new_agent.parent_id = Some(parent_agent_id);
    new_agent.generation = parent_generation
        .checked_add(1)
        .ok_or(SwarmError::ArithmeticOverflow)?;
    new_agent.task_type = task_type;
    new_agent.status = AgentStatus::Active;
    new_agent.score = 0;
    new_agent.lineage_hash = lineage_hash;
    new_agent.spawn_timestamp = clock.unix_timestamp;
    new_agent.termination_timestamp = 0;
    new_agent.bump = ctx.bumps.new_agent;

    ctx.accounts.swarm.active_agent_count = ctx
        .accounts
        .swarm
        .active_agent_count
        .checked_add(1)
        .ok_or(SwarmError::ArithmeticOverflow)?;
    ctx.accounts.swarm.total_spawned = ctx
        .accounts
        .swarm
        .total_spawned
        .checked_add(1)
        .ok_or(SwarmError::ArithmeticOverflow)?;

    emit!(AgentRespawned {
        new_agent_id,
        parent_agent_id,
        lineage_hash,
    });

    Ok(())
}
