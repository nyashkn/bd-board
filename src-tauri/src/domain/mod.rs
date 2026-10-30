//! Types and pure logic. Imports nothing from the crate except other domain modules.

pub mod bd_json;
pub mod bead;
pub mod dolt;
pub mod feed;
pub mod graph;
pub mod knowledge;
pub mod project;

pub use bead::{Bead, BeadDetail, BeadUpdateInput};
pub use dolt::DoltProbe;
pub use feed::BeadFeedMessage;
pub use knowledge::ProjectKnowledge;
pub use project::{
    AddProjectOutcome, BeadsLocation, CommentAuthor, PathStatus, Project, ProjectCounts,
};
