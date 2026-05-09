use crate::errors::SwarmError;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

#[derive(Accounts)]
#[instruction(name: String)]
pub struct InitializeSwarm<'info> {
    #[account(
        init,
        payer = authority,
        space = Swarm::LEN,
        seeds = [b"swarm", authority.key().as_ref()],
        bump
    )]
    pub swarm: Account<'info, Swarm>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub treasury: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeSwarm>,
    name: String,
    scoring_threshold: u8,
    scoring_oracle: Pubkey,
    task_type: TaskType,
) -> Result<()> {
    require!(name.len() <= Swarm::MAX_NAME_LEN, SwarmError::NameTooLong);
    require!(scoring_threshold <= 100, SwarmError::InvalidScore);

    let swarm = &mut ctx.accounts.swarm;
    swarm.authority = ctx.accounts.authority.key();
    swarm.scoring_oracle = scoring_oracle;
    swarm.name = name;
    swarm.generation = 0;
    swarm.active_agent_count = 0;
    swarm.total_spawned = 0;
    swarm.scoring_threshold = scoring_threshold;
    swarm.treasury = ctx.accounts.treasury.key();
    swarm.task_type = task_type;
    swarm.bump = ctx.bumps.swarm;

    Ok(())
}
