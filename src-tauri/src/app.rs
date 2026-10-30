//! Connector selection. Commands call in here; this picks the adapter behind each port.
//! The snapshot store itself lives in the client; the adapter coalesces concurrent `snapshot` calls.
//!
//! Automatic selection (configured URL scheme, then a capability probe, then fallback to
//! bd-cli) lands here.

use crate::adapters::bd_cli::BdCli;
use crate::ports::{BeadSink, BeadSource, ProjectAdmin};

/// `bd` binary candidates, for the desktop probe in lib.rs.
pub(crate) use crate::adapters::bd_cli::bd_candidates;
/// Managed Tauri state for the live change feeds.
pub use crate::adapters::bd_cli::FeedWatches;

pub(crate) fn source_for(_project_id: &str) -> &'static dyn BeadSource {
    &BdCli
}

pub(crate) fn sink_for(_project_id: &str) -> &'static dyn BeadSink {
    &BdCli
}

pub(crate) fn admin() -> &'static dyn ProjectAdmin {
    &BdCli
}
