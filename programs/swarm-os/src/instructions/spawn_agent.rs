use crate::errors::SwarmError;
use crate::state::*;
use crate::AgentSpawned;
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(agent_id: u64)]
pub struct SpawnAgent<'info> {
    #[account(
        init,
        payer = authority,
        space = Agent::LEN,
        seeds = [b"agent", swarm.key().as_ref(), &agent_id.to_le_bytes()],
        bump
    )]
    pub agent: Account<'info, Agent>,

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
    ctx: Context<SpawnAgent>,
    agent_id: u64,
    parent_id: Option<u64>,
    lineage_hash: [u8; 32],
) -> Result<()> {
    let clock = Clock::get()?;
    let swarm = &mut ctx.accounts.swarm;
    let agent = &mut ctx.accounts.agent;

    agent.agent_id = agent_id;
    agent.swarm = swarm.key();
    agent.parent_id = parent_id;
    agent.generation = swarm.generation;
    agent.task_type = swarm.task_type.clone();
    agent.status = AgentStatus::Active;
    agent.score = 0;
    agent.lineage_hash = lineage_hash;
    agent.spawn_timestamp = clock.unix_timestamp;
    agent.termination_timestamp = 0;
    agent.bump = ctx.bumps.agent;

    swarm.active_agent_count = swarm
        .active_agent_count
        .checked_add(1)
        .ok_or(SwarmError::ArithmeticOverflow)?;
    swarm.total_spawned = swarm
        .total_spawned
        .checked_add(1)
        .ok_or(SwarmError::ArithmeticOverflow)?;

    emit!(AgentSpawned {
        agent_id,
        generation: agent.generation,
        swarm: swarm.key(),
    });

    Ok(())
}
