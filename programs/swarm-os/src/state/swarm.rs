use crate::state::agent::TaskType;
use anchor_lang::prelude::*;

#[account]
pub struct Swarm {
    pub authority: Pubkey,       // 32
    pub scoring_oracle: Pubkey,  // 32
    pub name: String,            // 4 + 32
    pub generation: u64,         // 8
    pub active_agent_count: u32, // 4
    pub total_spawned: u64,      // 8
    pub scoring_threshold: u8,   // 1
    pub treasury: Pubkey,        // 32
    pub task_type: TaskType,     // 1
    pub bump: u8,                // 1
}

impl Swarm {
    pub const MAX_NAME_LEN: usize = 32;

    pub const LEN: usize = 8                      // discriminator
        + 32                                       // authority
        + 32                                       // scoring_oracle
        + 4 + Self::MAX_NAME_LEN                   // name
        + 8                                        // generation
        + 4                                        // active_agent_count
        + 8                                        // total_spawned
        + 1                                        // scoring_threshold
        + 32                                       // treasury
        + 1                                        // task_type
        + 1; // bump
}
