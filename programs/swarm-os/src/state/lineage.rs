use crate::state::agent::TaskType;
use anchor_lang::prelude::*;

#[account]
pub struct LineageMemory {
    pub agent_id: u64,                 // 8
    pub swarm: Pubkey,                 // 32
    pub generation: u64,               // 8
    pub task_type: TaskType,           // 1
    pub failure_score: u8,             // 1
    pub failure_reason_hash: [u8; 32], // 32
    pub arweave_uri: String,           // 4 + 100
    pub timestamp: i64,                // 8
    pub bump: u8,                      // 1
}

impl LineageMemory {
    pub const MAX_ARWEAVE_URI_LEN: usize = 100;

    pub const LEN: usize = 8                          // discriminator
        + 8                                            // agent_id
        + 32                                           // swarm
        + 8                                            // generation
        + 1                                            // task_type
        + 1                                            // failure_score
        + 32                                           // failure_reason_hash
        + 4 + Self::MAX_ARWEAVE_URI_LEN                // arweave_uri
        + 8                                            // timestamp
        + 1; // bump
}
