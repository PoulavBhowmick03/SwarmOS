use crate::errors::SwarmError;
use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct BumpGeneration<'info> {
    #[account(
        mut,
        constraint = swarm.authority == authority.key() @ SwarmError::Unauthorized
    )]
    pub swarm: Account<'info, Swarm>,

    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<BumpGeneration>) -> Result<()> {
    ctx.accounts.swarm.generation = ctx
        .accounts
        .swarm
        .generation
        .checked_add(1)
        .ok_or(SwarmError::ArithmeticOverflow)?;
    Ok(())
}
