//! Types and pure logic. Imports nothing from the crate except other domain modules.

pub mod bd_json;
pub mod bead;
pub mod dolt;
#[cfg_attr(not(feature = "dolt-sql"), allow(dead_code))]
pub mod dolt_rows;
pub mod feed;
pub mod graph;
pub mod knowledge;
pub mod project;
pub mod snapshot;

pub use bead::{Bead, BeadDetail, BeadUpdateInput, Comment};
pub use dolt::DoltProbe;
#[cfg(feature = "dolt-sql")]
pub use dolt::{CredentialsRef, DoltLogin};
pub use feed::BeadFeedMessage;
pub use knowledge::ProjectKnowledge;
pub use project::{
    AddProjectOutcome, BeadsLocation, CommentAuthor, PathStatus, Project, ProjectCounts,
};
pub use snapshot::ProjectSnapshot;
