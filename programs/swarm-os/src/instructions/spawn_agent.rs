use crate::errors::SwarmError;
use crate::state::*;
use crate::AgentSpawned;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

pub const AGENT_USDC_FUNDING_AMOUNT: u64 = 10_000;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SpawnAgentArgs {
    pub agent_id: u64,
    pub parent_id: Option<u64>,
    pub lineage_hash: [u8; 32],
    pub claimed_apy_bps: u16,
    pub claimed_protocol: String,
    pub task_output_hash: [u8; 32],
}

#[derive(Accounts)]
#[instruction(args: SpawnAgentArgs)]
pub struct SpawnAgent<'info> {
    #[account(
        init,
        payer = authority,
        space = Agent::LEN,
        seeds = [b"agent", swarm.key().as_ref(), &args.agent_id.to_le_bytes()],
        bump
    )]
    pub agent: Account<'info, Agent>,

    #[account(
        init,
        payer = authority,
        associated_token::mint = usdc_mint,
        associated_token::authority = agent,
    )]
    pub agent_usdc_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = swarm.authority == authority.key() @ SwarmError::Unauthorized
    )]
    pub swarm: Account<'info, Swarm>,

    #[account(
        mut,
        constraint = swarm_treasury.key() == swarm.treasury,
        constraint = swarm_treasury.mint == usdc_mint.key()
    )]
    pub swarm_treasury: Account<'info, TokenAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub usdc_mint: Account<'info, Mint>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<SpawnAgent>, args: SpawnAgentArgs) -> Result<()> {
    require!(args.claimed_apy_bps <= 10_000, SwarmError::InvalidScore);
    require!(
        args.claimed_protocol.len() <= Agent::MAX_CLAIMED_PROTOCOL_LEN,
        SwarmError::NameTooLong
    );

    let clock = Clock::get()?;
    let swarm_key = ctx.accounts.swarm.key();
    let generation;

    {
        let swarm = &mut ctx.accounts.swarm;
        let agent = &mut ctx.accounts.agent;

        agent.agent_id = args.agent_id;
        agent.swarm = swarm_key;
        agent.parent_id = args.parent_id;
        agent.generation = swarm.generation;
        agent.task_type = swarm.task_type.clone();
        agent.status = AgentStatus::Active;
        agent.score = 0;
        agent.lineage_hash = args.lineage_hash;
        agent.claimed_apy_bps = args.claimed_apy_bps;
        agent.claimed_protocol = args.claimed_protocol.clone();
        agent.task_output_hash = args.task_output_hash;
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

        generation = agent.generation;
    }

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.swarm_treasury.to_account_info(),
                to: ctx.accounts.agent_usdc_ata.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            },
        ),
        AGENT_USDC_FUNDING_AMOUNT,
    )?;

    emit!(AgentSpawned {
        agent_id: args.agent_id,
        generation,
        swarm: swarm_key,
        claimed_apy_bps: args.claimed_apy_bps,
    });

    Ok(())
}
