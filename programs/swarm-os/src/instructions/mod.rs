pub mod bump_generation;
pub mod evaluate_and_prune;
pub mod initialize_swarm;
pub mod respawn_successor;
pub mod spawn_agent;
pub mod submit_score;

// Glob re-exports are required: Anchor's #[derive(Accounts)] generates
// __client_accounts_* modules that #[program] resolves via crate::.
#[allow(ambiguous_glob_reexports)]
pub use bump_generation::*;
#[allow(ambiguous_glob_reexports)]
pub use evaluate_and_prune::*;
#[allow(ambiguous_glob_reexports)]
pub use initialize_swarm::*;
#[allow(ambiguous_glob_reexports)]
pub use respawn_successor::*;
#[allow(ambiguous_glob_reexports)]
pub use spawn_agent::*;
#[allow(ambiguous_glob_reexports)]
pub use submit_score::*;
