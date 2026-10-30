//! The `#[tauri::command]` driver functions: thin glue from IPC to the ports (via `app`).
//! Names, signatures and serde shapes are the mocked-IPC e2e contract.

use crate::app::{self, FeedWatches};
use crate::artifacts::{self, ArtifactFile};
use crate::domain::{
    AddProjectOutcome, Bead, BeadDetail, BeadFeedMessage, BeadsLocation, Comment, CommentAuthor,
    DoltProbe, PathStatus, Project, ProjectKnowledge, ProjectSnapshot,
};
use crate::registry::{self, resolve_dir, RegistryEntry};

// Tests drive the commands with this input type.
pub use crate::domain::BeadUpdateInput;

/// Run a bd-spawning command off the main thread; the per-project queue paces the spawns.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn watch_bead_feed(
    project_id: String,
    since: i64,
    on_message: tauri::ipc::Channel<BeadFeedMessage>,
    watches: tauri::State<'_, FeedWatches>,
) -> Result<u32, String> {
    let dir = resolve_dir(&project_id)?;
    watches.start(dir, since, move |m| on_message.send(m).is_ok())
}

#[tauri::command]
pub fn unwatch_bead_feed(watch_id: u32, watches: tauri::State<'_, FeedWatches>) {
    watches.stop(watch_id);
}

#[tauri::command]
pub async fn enable_events_journal(project_id: String) -> Result<(), String> {
    blocking(move || app::sink_for(&project_id).enable_events_journal(&project_id)).await
}

#[tauri::command]
pub async fn comment_author(project_id: String) -> Result<CommentAuthor, String> {
    blocking(move || app::admin().comment_author(&project_id)).await
}

#[tauri::command]
pub async fn list_projects() -> Result<Vec<Project>, String> {
    blocking(|| app::admin().list_projects()).await
}

#[tauri::command]
pub async fn list_beads(project_id: String) -> Result<Vec<Bead>, String> {
    blocking(move || app::source_for(&project_id).list_beads(&project_id)).await
}

#[tauri::command]
pub async fn get_bead_detail(project_id: String, id: String) -> Result<BeadDetail, String> {
    blocking(move || app::source_for(&project_id).bead_detail(&project_id, &id)).await
}

#[tauri::command]
pub async fn get_project_snapshot(project_id: String) -> Result<ProjectSnapshot, String> {
    blocking(move || app::source_for(&project_id).snapshot(&project_id)).await
}

#[tauri::command]
pub async fn get_bead_comments(project_id: String, id: String) -> Result<Vec<Comment>, String> {
    blocking(move || app::source_for(&project_id).bead_comments(&project_id, &id)).await
}

#[tauri::command]
pub fn read_artifact(project_id: String, path: String) -> Result<ArtifactFile, String> {
    artifacts::read_artifact_inner(&resolve_dir(&project_id)?, &path)
}

#[tauri::command]
pub async fn get_project_knowledge(project_id: String) -> Result<ProjectKnowledge, String> {
    blocking(move || app::source_for(&project_id).project_knowledge(&project_id)).await
}

#[tauri::command]
pub async fn update_bead_status(
    project_id: String,
    id: String,
    status: String,
) -> Result<(), String> {
    blocking(move || app::sink_for(&project_id).update_bead_status(&project_id, &id, &status)).await
}

#[tauri::command]
pub async fn update_bead(
    project_id: String,
    id: String,
    update: BeadUpdateInput,
) -> Result<(), String> {
    blocking(move || app::sink_for(&project_id).update_bead(&project_id, &id, update)).await
}

#[tauri::command]
pub async fn preview_delete_bead(project_id: String, id: String) -> Result<String, String> {
    blocking(move || app::sink_for(&project_id).preview_delete_bead(&project_id, &id)).await
}

#[tauri::command]
pub async fn delete_bead(project_id: String, id: String) -> Result<(), String> {
    blocking(move || app::sink_for(&project_id).delete_bead(&project_id, &id)).await
}

#[tauri::command]
pub async fn create_bead(
    project_id: String,
    title: String,
    description: Option<String>,
    r#type: Option<String>,
    parent: Option<String>,
) -> Result<String, String> {
    blocking(move || {
        app::sink_for(&project_id).create_bead(
            &project_id,
            &title,
            description.as_deref(),
            r#type.as_deref(),
            parent.as_deref(),
        )
    })
    .await
}

#[tauri::command]
pub async fn add_comment(project_id: String, id: String, text: String) -> Result<(), String> {
    blocking(move || app::sink_for(&project_id).add_comment(&project_id, &id, &text)).await
}

#[tauri::command]
pub async fn probe_project(path: String) -> Result<BeadsLocation, String> {
    blocking(move || app::admin().probe_location(&path)).await
}

/// Which Dolt mode is this project in (`bd dolt show --json`), plus its registry `sources`.
/// Never fails: an error or a 2 s timeout comes back in `error`. Not `probe_project` (the
/// registry probe).
#[tauri::command]
pub async fn probe_dolt_mode(project_id: String) -> DoltProbe {
    blocking(move || Ok(app::admin().probe_dolt_mode(&project_id)))
        .await
        .unwrap_or_else(|err| DoltProbe::error(err, vec![]))
}

#[tauri::command]
pub async fn check_project_path(path: String) -> PathStatus {
    tauri::async_runtime::spawn_blocking(move || app::admin().check_path(&path))
        .await
        .unwrap_or_else(|e| PathStatus::Invalid {
            reason: e.to_string(),
        })
}

#[tauri::command]
pub async fn add_project(path: String, name: Option<String>) -> Result<AddProjectOutcome, String> {
    blocking(move || app::admin().add_project(&path, name)).await
}

#[tauri::command]
pub fn remove_project(id: String) -> Result<(), String> {
    registry::remove(&id)
}

#[tauri::command]
pub async fn init_project(
    path: String,
    prefix: Option<String>,
    name: Option<String>,
) -> Result<Project, String> {
    blocking(move || app::admin().init_project(&path, prefix, name)).await
}

#[tauri::command]
pub fn rename_project(id: String, name: String) -> Result<RegistryEntry, String> {
    registry::rename(&id, name)
}

#[tauri::command]
pub fn relocate_project(id: String, path: String) -> Result<RegistryEntry, String> {
    registry::relocate(&id, path)
}
