//! What the app needs from a bead backend. Depends only on the domain.
//!
use crate::domain::{
    AddProjectOutcome, Bead, BeadDetail, BeadUpdateInput, BeadsLocation, Comment, CommentAuthor,
    DoltProbe, PathStatus, Project, ProjectKnowledge, ProjectSnapshot,
};

/// Where a project's beads are read from. Writes always go through the bd CLI.
pub(crate) trait BeadSource: Send + Sync {
    fn list_beads(&self, project_id: &str) -> Result<Vec<Bead>, String>;
    fn bead_detail(&self, project_id: &str, id: &str) -> Result<BeadDetail, String>;
    fn project_knowledge(&self, project_id: &str) -> Result<ProjectKnowledge, String>;
    /// Everything the UI reads in one call; concurrent calls for a project share work.
    /// `background`: a refresh nobody waits on; it yields to user calls in the bd queue.
    fn snapshot(&self, project_id: &str, background: bool) -> Result<ProjectSnapshot, String>;
    /// One bead's comments, to patch a snapshot after a comment-only change.
    fn bead_comments(
        &self,
        project_id: &str,
        id: &str,
        background: bool,
    ) -> Result<Vec<Comment>, String>;
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
