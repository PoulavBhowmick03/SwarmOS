use anchor_lang::prelude::*;

#[error_code]
pub enum SwarmError {
    #[msg("Caller is not the swarm authority")]
    Unauthorized,
    #[msg("Agent status is invalid for this operation")]
    InvalidAgentStatus,
    #[msg("Agent does not belong to this swarm")]
    SwarmMismatch,
    #[msg("Score must be between 0 and 100")]
    InvalidScore,
    #[msg("Agent ID does not match the requested PDA seed")]
    AgentIdMismatch,
    #[msg("Name exceeds 32-character maximum")]
    NameTooLong,
    #[msg("Arweave URI exceeds 100-character maximum")]
    UriTooLong,
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
}
