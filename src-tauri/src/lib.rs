use serde::Serialize;
use std::env;
use std::process::Command;

mod adapters;
mod app;
mod artifacts;
// pub so tests/ can drive the real commands against a `bd init` fixture.
pub mod commands;
mod domain;
mod ports;
pub mod registry;
pub mod rum;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopProbe {
    pub bd_binary: String,
    pub bd_version: String,
    pub registry_path: String,
    pub project_count: usize,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(app::FeedWatches::default());

    #[cfg(feature = "wdio")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .on_page_load(|webview, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Started {
                use tauri::Manager;
                webview.state::<app::FeedWatches>().cancel_all();
            }
        })
        .setup(|_| {
            #[cfg(debug_assertions)]
            match desktop_probe() {
                Ok(probe) => {
                    println!("desktop probe: {} {}", probe.bd_binary, probe.bd_version);
                }
                Err(err) => {
                    eprintln!("desktop probe failed: {}", err);
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            desktop_probe,
            commands::list_projects,
            commands::add_project,
            commands::remove_project,
            commands::probe_project,
            commands::probe_dolt_mode,
            commands::init_project,
            commands::list_beads,
            commands::get_bead_detail,
            commands::read_artifact,
            commands::get_project_knowledge,
            commands::update_bead_status,
            commands::update_bead,
            commands::preview_delete_bead,
            commands::delete_bead,
            commands::create_bead,
            commands::add_comment,
            commands::comment_author,
            commands::rename_project,
            commands::check_project_path,
            commands::relocate_project,
            commands::watch_bead_feed,
            commands::unwatch_bead_feed,
            commands::enable_events_journal,
            rum::rum_config,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                use tauri::Manager;
                app.state::<app::FeedWatches>().cancel_all();
            }
        });
}

#[tauri::command]
fn desktop_probe() -> Result<DesktopProbe, String> {
    let bd_version = resolve_bd_version()?;
    let bd_binary = find_bd_binary()?.to_string_lossy().to_string();

    let registry_path = registry::registry_path()?.to_string_lossy().to_string();
    let registry = registry::load()?;
    let project_count = registry.projects.len();

    Ok(DesktopProbe {
        bd_binary,
        bd_version,
        registry_path,
        project_count,
    })
}

fn find_bd_binary() -> Result<std::path::PathBuf, String> {
    let candidates = app::bd_candidates();
    for candidate in candidates {
        if let Ok(output) = Command::new(&candidate).arg("--version").output() {
            if output.status.success() {
                return Ok(std::path::PathBuf::from(candidate));
            }
        }
    }
    Err("bd binary not found in any candidate".to_string())
}

fn resolve_bd_version() -> Result<String, String> {
    let candidates = app::bd_candidates();
    for candidate in candidates {
        if let Ok(output) = Command::new(&candidate).arg("--version").output() {
            if output.status.success() {
                return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
            }
        }
    }
    Err("bd binary not found in any candidate".to_string())
}
