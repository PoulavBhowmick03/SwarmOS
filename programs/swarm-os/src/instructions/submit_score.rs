use crate::errors::SwarmError;
use crate::state::*;
use crate::AgentScored;
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(agent_id: u64)]
pub struct SubmitScore<'info> {
    #[account(
        mut,
        seeds = [b"agent", swarm.key().as_ref(), &agent_id.to_le_bytes()],
        bump = agent.bump,
        constraint = agent.swarm == swarm.key() @ SwarmError::SwarmMismatch,
        constraint = agent.agent_id == agent_id @ SwarmError::AgentIdMismatch
    )]
    pub agent: Account<'info, Agent>,

    #[account(
        constraint = swarm.scoring_oracle == oracle.key() @ SwarmError::Unauthorized
    )]
    pub swarm: Account<'info, Swarm>,

    pub oracle: Signer<'info>,
}

pub fn handler(ctx: Context<SubmitScore>, _agent_id: u64, score: u8) -> Result<()> {
    require!(score <= 100, SwarmError::InvalidScore);

    let agent = &mut ctx.accounts.agent;

    require!(
        agent.status == AgentStatus::Active,
        SwarmError::InvalidAgentStatus
    );

    agent.score = score;
    agent.status = AgentStatus::Scored;

    emit!(AgentScored {
        agent_id: agent.agent_id,
        score,
    });

    Ok(())
}
