//! Every write command refuses a read-only project, with no `bd` involved (so it runs on CI).
//! HOME points at a temp dir for the whole process; this file has one test.

use bd_board_desktop::commands as c;
use serde_json::json;

fn block<F: std::future::Future>(f: F) -> F::Output {
    tauri::async_runtime::block_on(f)
}

fn refused<T: std::fmt::Debug>(what: &str, r: Result<T, String>) {
    let err = r.expect_err(what);
    assert!(err.contains("read-only"), "{what}: {err}");
}

#[test]
fn every_sink_method_refuses_a_readonly_project() {
    let home = std::env::temp_dir().join(format!("bdb-ro-{}", std::process::id()));
    std::fs::create_dir_all(home.join(".config/bd-board")).unwrap();
    std::env::set_var("HOME", &home);
    let registry = json!({"version": 1, "projects": [
        {"id": "ro", "path": "/nowhere", "label": "RO", "readonly": true},
        // reading only from a Dolt server: no local bd to write through
        {"id": "hub", "path": "/nowhere", "label": "Hub",
         "sources": ["mysql://dolt-hub.example:3306/mydb"]},
    ]});
    std::fs::write(
        home.join(".config/bd-board/projects.json"),
        registry.to_string(),
    )
    .unwrap();

    for id in ["ro", "hub"] {
        let p = || id.to_string();
        let s = |v: &str| v.to_string();
        refused(
            "update_bead_status",
            block(c::update_bead_status(p(), s("x-1"), s("open"))),
        );
        refused(
            "update_bead",
            block(c::update_bead(p(), s("x-1"), c::BeadUpdateInput::default())),
        );
        refused(
            "preview_delete_bead",
            block(c::preview_delete_bead(p(), s("x-1"))),
        );
        refused("delete_bead", block(c::delete_bead(p(), s("x-1"))));
        refused(
            "create_bead",
            block(c::create_bead(p(), s("t"), None, None, None)),
        );
        refused("add_comment", block(c::add_comment(p(), s("x-1"), s("hi"))));
        refused(
            "enable_events_journal",
            block(c::enable_events_journal(p())),
        );
    }
    let _ = std::fs::remove_dir_all(&home);
}
