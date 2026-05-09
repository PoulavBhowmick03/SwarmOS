use anchor_lang::prelude::*;

#[account]
pub struct Agent {
    pub agent_id: u64,              // 8
    pub swarm: Pubkey,              // 32
    pub parent_id: Option<u64>,     // 9
    pub generation: u64,            // 8
    pub task_type: TaskType,        // 1
    pub status: AgentStatus,        // 1
    pub score: u8,                  // 1
    pub lineage_hash: [u8; 32],     // 32
    pub claimed_apy_bps: u16,       // 2
    pub claimed_protocol: String,   // 4 + 32
    pub task_output_hash: [u8; 32], // 32
    pub spawn_timestamp: i64,       // 8
    pub termination_timestamp: i64, // 8
    pub bump: u8,                   // 1
}

impl Agent {
    pub const MAX_CLAIMED_PROTOCOL_LEN: usize = 32;

    pub const LEN: usize = 8  // discriminator
        + 8                   // agent_id
        + 32                  // swarm
        + 9                   // parent_id (Option<u64>: 1 tag + 8 value)
        + 8                   // generation
        + 1                   // task_type
        + 1                   // status
        + 1                   // score
        + 32                  // lineage_hash
        + 2                   // claimed_apy_bps
        + 4 + Self::MAX_CLAIMED_PROTOCOL_LEN // claimed_protocol
        + 32                  // task_output_hash
        + 8                   // spawn_timestamp
        + 8                   // termination_timestamp
        + 1; // bump
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum AgentStatus {
    Active,
    Scored,
    Survived,
    Terminated,
    Respawned,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum TaskType {
    YieldOptimizer,
    CodeReviewer,
    DataSynthesizer,
}
