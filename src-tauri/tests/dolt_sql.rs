#![cfg(feature = "dolt-sql")]
//! The dolt-sql connector against a REAL `dolt sql-server` (127.0.0.1, a free port) holding a bd
//! 1.3.2 server-mode fixture of synthetic beads, all under a temp HOME. Skipped with a message
//! when `dolt` or `bd` is not installed (CI). Only processes started here are stopped, by PID.

use bd_board_desktop::commands as desktop;
use bd_board_desktop::test_support;
use serde_json::{json, Value};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

fn block<F: std::future::Future>(f: F) -> F::Output {
    tauri::async_runtime::block_on(f)
}

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

fn bd(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("bd")
        .current_dir(dir)
        .args(args)
        .output()
        .expect("run bd");
    assert!(
        out.status.success(),
        "bd {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

struct World {
    root: PathBuf,
    proj: PathBuf,
    ids: Vec<String>,
    server: Child,
}

// Stops the one server this test started, by PID, even when an assertion fails.
impl Drop for World {
    fn drop(&mut self) {
        let _ = self.server.kill();
        let _ = self.server.wait();
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn have(tool: &str) -> bool {
    Command::new(tool)
        .arg(if tool == "dolt" {
            "version"
        } else {
            "--version"
        })
        .output()
        .is_ok_and(|o| o.status.success())
}

fn world() -> Option<World> {
    {
        if !have("bd") || !have("dolt") {
            eprintln!("SKIPPED: dolt and bd must both be on PATH for the dolt-sql tests");
            return None;
        }
        let root = std::env::temp_dir().join(format!("bdb-sql-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let home = root.join("home");
        let data = root.join("dolt");
        let proj = root.join("proj");
        for d in [home.join(".config/bd-board"), data.clone(), proj.clone()] {
            std::fs::create_dir_all(d).unwrap();
        }
        std::env::set_var("HOME", &home);
        for k in [
            "BD_BIN",
            "BD_BOARD_AUTHOR",
            "BD_ACTOR",
            "BEADS_ACTOR",
            "BEADS_DIR",
            "BEADS_DOLT_PASSWORD",
            "BEADS_DOLT_SERVER_TLS",
            "BEADS_DOLT_SERVER_USER",
            "BEADS_CREDENTIALS_FILE",
        ] {
            std::env::remove_var(k);
        }
        for (k, v) in [
            ("user.name", "fixture"),
            ("user.email", "fixture@example.com"),
        ] {
            Command::new("dolt")
                .args(["config", "--global", "--add", k, v])
                .output()
                .unwrap();
        }
        let port = free_port();
        let server = Command::new("dolt")
            .current_dir(&data)
            .args(["sql-server", "-H", "127.0.0.1", "-P", &port.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("start dolt sql-server");
        let up = Instant::now();
        while TcpStream::connect(("127.0.0.1", port)).is_err() {
            assert!(up.elapsed() < Duration::from_secs(20), "dolt did not start");
            std::thread::sleep(Duration::from_millis(100));
        }
        bd(
            &proj,
            &[
                "init",
                "-p",
                "syn",
                "--server",
                "--server-host",
                "127.0.0.1",
                "--server-port",
                &port.to_string(),
                "--server-user",
                "root",
                "--non-interactive",
                "--skip-agents",
                "--skip-hooks",
            ],
        );
        let make = |args: &[&str]| {
            let mut a = vec!["create", "--silent"];
            a.extend_from_slice(args);
            bd(&proj, &a)
        };
        let epic = make(&[
            "--title",
            "Epic one",
            "-t",
            "epic",
            "-p",
            "1",
            "-d",
            "desc é \"q\"",
        ]);
        let child = make(&[
            "--title", "Child", "--parent", &epic, "-l", "alpha", "-l", "beta",
        ]);
        let blocked = make(&[
            "--title",
            "Blocked task",
            "-t",
            "bug",
            "-p",
            "0",
            "--acceptance",
            "ac",
            "--design",
            "dz",
            "--notes",
            "n",
            "-a",
            "alice",
            "-l",
            "alpha",
        ]);
        let closed = make(&["--title", "To close"]);
        let gate = make(&["--title", "A gate", "-t", "gate", "-p", "3"]);
        let meta = make(&[
            "--title",
            "Meta",
            "--metadata",
            r#"{"k":"v","n":1}"#,
            "--spec-id",
            "specs/a.md",
            "--external-ref",
            "gh-9",
        ]);
        let deferred = make(&["--title", "Deferred", "--defer", "+72h"]);
        let plain = make(&["--title", "Plain"]);
        bd(&proj, &["dep", "add", &blocked, &child]);
        bd(&proj, &["dep", "add", &meta, &epic, "--type", "related"]);
        bd(
            &proj,
            &["dep", "add", &meta, &blocked, "--type", "discovered-from"],
        );
        bd(&proj, &["dep", "add", &gate, &meta]);
        bd(
            &proj,
            &[
                "dep",
                "add",
                &deferred,
                &plain,
                "--type",
                "conditional-blocks",
            ],
        );
        bd(&proj, &["comment", &child, "first comment"]);
        std::thread::sleep(Duration::from_millis(1100)); // distinct second: a stable order
        bd(&proj, &["comment", &child, "second comment"]);
        bd(&proj, &["close", &closed, "--reason", "done"]);
        bd(&proj, &["update", &meta, "--status", "in_progress"]);

        let url = format!("mysql://127.0.0.1:{port}/syn");
        let dead = free_port();
        let silent = TcpListener::bind("127.0.0.1:0").unwrap();
        let silent_port = silent.local_addr().unwrap().port();
        std::mem::forget(silent); // accepts connections in the kernel, never answers
        let proj_s = proj.to_string_lossy().to_string();
        let registry = json!({"version": 1, "projects": [
            // a local server-mode project: bd is there for readiness
            {"id": "auto", "path": proj_s, "label": "Auto"},
            // an explicit hub with no local bd: read-only, readiness unavailable
            {"id": "hub", "path": proj_s, "label": "Hub", "sources": [url]},
            {"id": "down", "path": proj_s, "label": "Down",
             "sources": [format!("mysql://127.0.0.1:{dead}/syn")]},
            {"id": "plain", "path": proj_s, "label": "Plain",
             "sources": ["mysql://dolt-hub.example:3306/mydb"]},
            {"id": "stuck", "path": proj_s, "label": "Stuck",
             "sources": [format!("mysql://127.0.0.1:{silent_port}/syn")]},
        ]});
        std::fs::write(
            home.join(".config/bd-board/projects.json"),
            registry.to_string(),
        )
        .unwrap();
        Some(World {
            root,
            proj,
            ids: vec![epic, child, blocked, closed, gate, meta, deferred, plain],
            server,
        })
    }
}

fn by_id(snapshot: &Value) -> Vec<Value> {
    let mut beads = snapshot["beads"].as_array().unwrap().clone();
    beads.sort_by_key(|b| b["id"].as_str().unwrap().to_string());
    beads
}

fn snapshot(project: &str) -> Value {
    serde_json::to_value(block(desktop::dolt_sql_snapshot(project.into(), None)).unwrap()).unwrap()
}

fn sql_snapshot_equals_bd_export_field_for_field_and_returns_every_row(w: &World) {
    let via_bd =
        serde_json::to_value(block(desktop::get_project_snapshot("auto".into(), None)).unwrap())
            .unwrap();
    let via_sql = snapshot("auto");
    assert_eq!(by_id(&via_sql), by_id(&via_bd));
    // Closed beads and gates are in it, which `bd list` (without --all) hides.
    let ids: Vec<&str> = via_sql["beads"]
        .as_array()
        .unwrap()
        .iter()
        .map(|b| b["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids.len(), w.ids.len(), "{ids:?}");
    for id in &w.ids {
        assert!(ids.contains(&id.as_str()), "{id} missing");
    }
    let listed = bd(&w.proj, &["list", "--json"]);
    assert!(!listed.contains(&w.ids[3]) && !listed.contains(&w.ids[4]));
    // Readiness stays on bd for a project that has one: the very same answers.
    assert_eq!(via_sql["ready"], via_bd["ready"]);
    assert_eq!(via_sql["blocked"], via_bd["blocked"]);
    assert!(via_sql.get("readiness_unavailable").is_none());
    // The cursor is the Dolt head, 32 base32 characters.
    let cursor = via_sql["cursor"].as_str().unwrap();
    assert!(
        cursor.len() == 32
            && cursor
                .bytes()
                .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'v'))
    );
}

fn a_hub_without_a_local_bd_is_read_only_and_flags_missing_readiness() {
    let snap = snapshot("hub");
    assert!(snap["ready"].is_null() && snap["blocked"].is_null());
    assert_eq!(snap["readiness_unavailable"], true);
    assert_eq!(
        by_id(&snap),
        by_id(
            &serde_json::to_value(
                block(desktop::get_project_snapshot("auto".into(), None)).unwrap()
            )
            .unwrap()
        )
    );
    let err = block(desktop::add_comment("hub".into(), "x".into(), "hi".into())).unwrap_err();
    assert!(err.contains("read-only"), "{err}");
}

fn comments_come_back_oldest_first(w: &World) {
    let got = block(desktop::dolt_sql_comments(
        "hub".into(),
        w.ids[1].clone(),
        None,
    ))
    .unwrap();
    let texts: Vec<String> = got.iter().map(|c| c.text.clone()).collect();
    assert_eq!(texts, ["first comment", "second comment"]);
}

fn a_bd_write_reaches_the_probe_within_two_seconds(w: &World) {
    let (tx, rx) = mpsc::channel::<Value>();
    let stop = test_support::dolt_watch("hub", Duration::from_secs(1), move |m| tx.send(m).is_ok())
        .unwrap();
    let live = rx.recv_timeout(Duration::from_secs(5)).unwrap();
    assert_eq!(live["type"], "live");

    let t0 = Instant::now();
    bd(&w.proj, &["comment", &w.ids[7], "probe me"]);
    let change = rx
        .recv_timeout(Duration::from_secs(2))
        .expect("no change within 2 s");
    let seen = t0.elapsed();
    assert_eq!(change["type"], "change");
    // A comment-only commit names the bead, so the client patches just its comments.
    assert_eq!(change["ops"], json!(["comment"]));
    assert_eq!(change["issueIds"], json!([w.ids[7]]));
    eprintln!("bd comment -> probe change: {seen:?}");
    assert!(seen < Duration::from_secs(2));

    // Anything else is "refresh everything": no ids, no ops.
    bd(&w.proj, &["update", &w.ids[7], "--priority", "1"]);
    let change = rx.recv_timeout(Duration::from_secs(3)).unwrap();
    assert_eq!(change["ops"], json!([]));
    stop.store(true, std::sync::atomic::Ordering::Relaxed);
}

fn a_remote_source_without_tls_is_refused_before_any_connection() {
    let t0 = Instant::now();
    let err = block(desktop::dolt_sql_snapshot("plain".into(), None))
        .err()
        .expect("must fail");
    assert_eq!(
        err,
        "source misconfigured (dolt-sql): remote source requires tls=true"
    );
    assert!(t0.elapsed() < Duration::from_millis(500));
}

fn a_down_or_silent_server_fails_fast_so_the_next_source_runs() {
    for (project, why) in [
        ("down", "connection refused"),
        ("stuck", "connection timed out"),
    ] {
        let t0 = Instant::now();
        let err = block(desktop::dolt_sql_snapshot(project.into(), None))
            .err()
            .expect("must fail");
        assert!(
            t0.elapsed() < Duration::from_millis(3500),
            "{project}: {:?}",
            t0.elapsed()
        );
        assert!(
            err.starts_with("source unavailable (dolt-sql)") && err.contains(why),
            "{err}"
        );
        assert!(!err.contains("127.0.0.1") && !err.contains("root"), "{err}");
    }
}

fn snapshot_time_against_the_temp_server(w: &World) {
    let mut times: Vec<Duration> = (0..21)
        .map(|_| {
            let t = Instant::now();
            block(desktop::dolt_sql_snapshot("hub".into(), None)).unwrap();
            t.elapsed()
        })
        .collect();
    times.sort();
    eprintln!(
        "dolt-sql snapshot ({} beads, hub = no bd): first {:?}, median {:?}, max {:?}",
        w.ids.len(),
        times[0],
        times[10],
        times[20]
    );
    for (what, project, sql) in [
        ("dolt-sql + bd ready/blocked", "auto", true),
        ("bd-cli", "auto", false),
    ] {
        let t = Instant::now();
        if sql {
            block(desktop::dolt_sql_snapshot(project.into(), None)).unwrap();
        } else {
            block(desktop::get_project_snapshot(project.into(), None)).unwrap();
        }
        eprintln!("{what} snapshot: {:?}", t.elapsed());
    }
}

#[test]
fn dolt_sql_connector_against_a_real_server() {
    let Some(w) = world() else { return };
    sql_snapshot_equals_bd_export_field_for_field_and_returns_every_row(&w);
    a_hub_without_a_local_bd_is_read_only_and_flags_missing_readiness();
    comments_come_back_oldest_first(&w);
    a_bd_write_reaches_the_probe_within_two_seconds(&w);
    a_remote_source_without_tls_is_refused_before_any_connection();
    a_down_or_silent_server_fails_fast_so_the_next_source_runs();
    snapshot_time_against_the_temp_server(&w);
}
