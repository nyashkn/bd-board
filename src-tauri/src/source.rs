use crate::desktop::{self, Bead, BeadDetail, ProjectKnowledge};

/// Where a project's beads are read from. Writes always go through the bd CLI.
pub trait BeadSource: Send + Sync {
    fn list_beads(&self, project_id: &str) -> Result<Vec<Bead>, String>;
    fn bead_detail(&self, project_id: &str, id: &str) -> Result<BeadDetail, String>;
    fn project_knowledge(&self, project_id: &str) -> Result<ProjectKnowledge, String>;
}

/// Reads through the bd CLI, the only source today.
pub struct BdCli;

impl BeadSource for BdCli {
    fn list_beads(&self, project_id: &str) -> Result<Vec<Bead>, String> {
        desktop::list_beads_inner(project_id)
    }

    fn bead_detail(&self, project_id: &str, id: &str) -> Result<BeadDetail, String> {
        desktop::get_bead_detail_inner(project_id, id)
    }

    fn project_knowledge(&self, project_id: &str) -> Result<ProjectKnowledge, String> {
        desktop::get_project_knowledge_inner(project_id)
    }
}

// Automatic selection (configured URL scheme, then a capability probe, then fallback to
// bd-cli) lands here.
pub fn source_for(_project_id: &str) -> &'static dyn BeadSource {
    &BdCli
}
