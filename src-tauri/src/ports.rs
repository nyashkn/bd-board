//! What the app needs from a bead backend. Depends only on the domain.
//!
//! Snapshot and change-cursor methods land with the snapshot store (bdb-84h.6); they need
//! domain types (a snapshot, a cursor) that do not exist yet.

use crate::domain::{
    AddProjectOutcome, Bead, BeadDetail, BeadUpdateInput, BeadsLocation, CommentAuthor, DoltProbe,
    PathStatus, Project, ProjectKnowledge,
};

/// Where a project's beads are read from. Writes always go through the bd CLI.
pub(crate) trait BeadSource: Send + Sync {
    fn list_beads(&self, project_id: &str) -> Result<Vec<Bead>, String>;
    fn bead_detail(&self, project_id: &str, id: &str) -> Result<BeadDetail, String>;
    fn project_knowledge(&self, project_id: &str) -> Result<ProjectKnowledge, String>;
}

/// Every write operation. A readonly project refuses before anything runs.
pub(crate) trait BeadSink: Send + Sync {
    fn update_bead_status(&self, project_id: &str, id: &str, status: &str) -> Result<(), String>;
    fn update_bead(
        &self,
        project_id: &str,
        id: &str,
        update: BeadUpdateInput,
    ) -> Result<(), String>;
    fn preview_delete_bead(&self, project_id: &str, id: &str) -> Result<String, String>;
    fn delete_bead(&self, project_id: &str, id: &str) -> Result<(), String>;
    fn create_bead(
        &self,
        project_id: &str,
        title: &str,
        description: Option<&str>,
        kind: Option<&str>,
        parent: Option<&str>,
    ) -> Result<String, String>;
    fn add_comment(&self, project_id: &str, id: &str, text: &str) -> Result<(), String>;
    fn enable_events_journal(&self, project_id: &str) -> Result<(), String>;
}

/// Project-level operations that ask the tracker itself: discovery, probes, add and init.
pub(crate) trait ProjectAdmin: Send + Sync {
    fn list_projects(&self) -> Result<Vec<Project>, String>;
    fn probe_location(&self, path: &str) -> Result<BeadsLocation, String>;
    fn probe_dolt_mode(&self, project_id: &str) -> DoltProbe;
    fn check_path(&self, path: &str) -> PathStatus;
    fn add_project(&self, path: &str, name: Option<String>) -> Result<AddProjectOutcome, String>;
    fn init_project(
        &self,
        path: &str,
        prefix: Option<String>,
        name: Option<String>,
    ) -> Result<Project, String>;
    fn comment_author(&self, project_id: &str) -> Result<CommentAuthor, String>;
}
