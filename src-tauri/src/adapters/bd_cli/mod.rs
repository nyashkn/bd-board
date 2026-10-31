//! The bd CLI adapter: everything that spawns `bd`.

mod exec;
mod feed;
mod probe;
mod projects;
mod queue;
mod reads;
mod snapshot;
mod writes;

use crate::domain::{
    AddProjectOutcome, Bead, BeadDetail, BeadUpdateInput, BeadsLocation, Comment, CommentAuthor,
    DoltProbe, PathStatus, Project, ProjectKnowledge, ProjectSnapshot,
};
use crate::ports::{BeadSink, BeadSource, ProjectAdmin};

pub(crate) use exec::bd_candidates;
pub use feed::FeedWatches;
#[cfg(feature = "dolt-sql")]
pub(crate) use probe::probe_dolt_mode;
#[cfg(feature = "dolt-sql")]
pub(crate) use snapshot::{coalesced, readiness_inner as readiness, Slots};

/// Reads and writes through the bd CLI, the only backend today.
pub(crate) struct BdCli;

impl BeadSource for BdCli {
    fn list_beads(&self, project_id: &str) -> Result<Vec<Bead>, String> {
        reads::list_beads_inner(project_id)
    }

    fn bead_detail(&self, project_id: &str, id: &str) -> Result<BeadDetail, String> {
        reads::get_bead_detail_inner(project_id, id)
    }

    fn project_knowledge(&self, project_id: &str) -> Result<ProjectKnowledge, String> {
        reads::get_project_knowledge_inner(project_id)
    }

    fn snapshot(&self, project_id: &str, background: bool) -> Result<ProjectSnapshot, String> {
        snapshot::snapshot_inner(project_id, background)
    }

    fn bead_comments(
        &self,
        project_id: &str,
        id: &str,
        background: bool,
    ) -> Result<Vec<Comment>, String> {
        snapshot::bead_comments_inner(project_id, id, background)
    }
}

impl BeadSink for BdCli {
    fn update_bead_status(&self, project_id: &str, id: &str, status: &str) -> Result<(), String> {
        writes::update_bead_status_inner(project_id, id, status)
    }

    fn update_bead(
        &self,
        project_id: &str,
        id: &str,
        update: BeadUpdateInput,
    ) -> Result<(), String> {
        writes::update_bead_inner(project_id, id, update)
    }

    fn preview_delete_bead(&self, project_id: &str, id: &str) -> Result<String, String> {
        writes::preview_delete_bead_inner(project_id, id)
    }

    fn delete_bead(&self, project_id: &str, id: &str) -> Result<(), String> {
        writes::delete_bead_inner(project_id, id)
    }

    fn create_bead(
        &self,
        project_id: &str,
        title: &str,
        description: Option<&str>,
        kind: Option<&str>,
        parent: Option<&str>,
    ) -> Result<String, String> {
        writes::create_bead_inner(project_id, title, description, kind, parent)
    }

    fn add_comment(&self, project_id: &str, id: &str, text: &str) -> Result<(), String> {
        writes::add_comment_inner(project_id, id, text)
    }

    fn enable_events_journal(&self, project_id: &str) -> Result<(), String> {
        writes::enable_events_journal_inner(project_id)
    }
}

impl ProjectAdmin for BdCli {
    fn list_projects(&self) -> Result<Vec<Project>, String> {
        projects::list_projects()
    }

    fn probe_location(&self, path: &str) -> Result<BeadsLocation, String> {
        probe::probe_beads_location(std::path::Path::new(path))
    }

    fn probe_dolt_mode(&self, project_id: &str) -> DoltProbe {
        probe::probe_dolt_mode(project_id)
    }

    fn check_path(&self, path: &str) -> PathStatus {
        projects::check_path(path)
    }

    fn add_project(&self, path: &str, name: Option<String>) -> Result<AddProjectOutcome, String> {
        projects::add_project(path, name)
    }

    fn init_project(
        &self,
        path: &str,
        prefix: Option<String>,
        name: Option<String>,
    ) -> Result<Project, String> {
        projects::init_project(path, prefix, name)
    }

    fn comment_author(&self, project_id: &str) -> Result<CommentAuthor, String> {
        projects::comment_author_inner(project_id)
    }
}
