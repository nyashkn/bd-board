//! Integration tests against a REAL `bd init` fixture under a fake HOME.
//! Skipped (with a message) when `bd` is not on PATH. HOME and the bd-related
//! env are set once, before any test body runs; nothing touches the real registry.

use bd_board_desktop::desktop;
use serde_json::json;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

struct World {
    root: PathBuf,
    p: PathBuf,
    ro: PathBuf,
    a: String,
    b: String,
    c: String,
    x: String,
    y: String,
}

fn bd(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("bd")
        .current_dir(dir)
        .args(args)
        .output()
        .expect("run bd");
    assert!(
        out.status.success(),
        "bd {:?} failed: {}",
        args,
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn world() -> Option<&'static World> {
    static W: OnceLock<Option<World>> = OnceLock::new();
    W.get_or_init(|| {
        if Command::new("bd").arg("--version").output().is_err() {
            eprintln!("SKIPPED: `bd` is not on PATH; install bd >= 1.3.0 to run these tests");
            return None;
        }
        let root = std::env::temp_dir().join(format!("bdb-rs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let home = root.join("home");
        std::fs::create_dir_all(home.join(".config/bd-board")).unwrap();
        // Process-wide, once, before anything reads them.
        std::env::set_var("HOME", &home);
        for k in [
            "BD_BIN",
            "BD_BOARD_AUTHOR",
            "BD_ACTOR",
            "BEADS_ACTOR",
            "BEADS_DIR",
        ] {
            std::env::remove_var(k);
        }
        let shim = Path::new(env!("CARGO_MANIFEST_DIR")).join("../scripts/readonly/bd-readonly");
        std::env::set_var("BD_READONLY_SHIM", shim);

        let init = |name: &str| {
            let dir = root.join(name);
            std::fs::create_dir_all(&dir).unwrap();
            bd(&dir, &["init", "-p", name, "--non-interactive"]);
            dir
        };
        let p = init("p");
        std::fs::create_dir_all(p.join("docs")).unwrap();
        std::fs::write(p.join("docs/notes.md"), "# hi").unwrap();
        let a = bd(&p, &["create", "--title", "blocker", "--silent"]);
        let b = bd(&p, &["create", "--title", "waiting", "--silent"]);
        let arts = json!([{"path": "docs/notes.md", "label": "Notes"}]).to_string();
        let meta = json!({ "artifacts": arts }).to_string();
        let c = bd(
            &p,
            &[
                "create",
                "--title",
                "with artifacts",
                "--silent",
                "--spec-id",
                "docs/spec.md",
                "--external-ref",
                "https://example.com/t/1",
                "--metadata",
                &meta,
            ],
        );
        bd(&p, &["dep", "add", &b, &a]); // b depends on a: b blocked, a ready
        bd(&p, &["config", "set", "actor", "fixture-actor"]);

        let ro = init("ro");
        let x = bd(
            &ro,
            &[
                "create", "--title", "labelled", "--type", "epic", "--label", "wo", "--silent",
            ],
        );
        let y = bd(
            &ro,
            &[
                "create", "--title", "other", "--type", "epic", "--label", "infra", "--silent",
            ],
        );

        let registry = json!({"version": 1, "projects": [
            {"id": "p", "path": p, "label": "P"},
            {"id": "ro", "path": ro, "label": "RO", "readonly": true, "filterLabel": " wo "},
        ]});
        std::fs::write(
            home.join(".config/bd-board/projects.json"),
            registry.to_string(),
        )
        .unwrap();
        Some(World {
            root,
            p,
            ro,
            a,
            b,
            c,
            x,
            y,
        })
    })
    .as_ref()
}

struct Cleanup<'a>(&'a Path);
impl Drop for Cleanup<'_> {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(self.0);
    }
}

/// One test, run in order: they share one fixture and one process-wide HOME, and the
/// temp root is removed at the end (also on a failed assertion).
#[test]
fn real_bd_fixture() {
    let Some(w) = world() else { return };
    let _cleanup = Cleanup(&w.root);
    read_artifact_allowed_types_and_limits(w);
    read_artifact_refuses_escapes_and_missing_files(w);
    registry_roundtrips_readonly_and_filter_label();
    readonly_launch_runs_the_shim_with_real_bd_and_the_filter(w);
    blocked_and_ready_map_from_real_bd_output(w);
    comment_author_follows_the_fixture_actor();
    write_guard_refuses_readonly_and_changes_nothing(w);
}

fn read_artifact_allowed_types_and_limits(w: &World) {
    let d = w.p.join("docs");
    std::fs::write(d.join("a.html"), "<p>x</p>").unwrap();
    std::fs::write(d.join("a.txt"), "t").unwrap();
    std::fs::write(d.join("a.json"), "{}").unwrap();
    std::fs::write(d.join("a.png"), [1u8, 2, 3]).unwrap();
    std::fs::write(d.join("a.svg"), "<svg/>").unwrap();
    for (f, kind) in [
        ("docs/notes.md", "markdown"),
        ("docs/a.html", "html"),
        ("docs/a.txt", "text"),
        ("docs/a.json", "json"),
        ("docs/a.png", "image"),
        ("docs/a.svg", "image"),
    ] {
        let got = desktop::read_artifact("p".into(), f.into()).unwrap();
        assert_eq!(got.kind, kind, "{f}");
    }
    let png = desktop::read_artifact("p".into(), "docs/a.png".into()).unwrap();
    assert_eq!(png.content, "data:image/png;base64,AQID");

    // 2 MB cap: exactly 2 MB passes, one byte more is refused.
    std::fs::write(d.join("ok.txt"), vec![b'a'; 2 * 1024 * 1024]).unwrap();
    std::fs::write(d.join("big.txt"), vec![b'a'; 2 * 1024 * 1024 + 1]).unwrap();
    assert!(desktop::read_artifact("p".into(), "docs/ok.txt".into()).is_ok());
    let err = desktop::read_artifact("p".into(), "docs/big.txt".into()).unwrap_err();
    assert!(err.contains("2 MB"), "{err}");

    // other extension
    std::fs::write(d.join("run.sh"), "x").unwrap();
    assert!(desktop::read_artifact("p".into(), "docs/run.sh".into())
        .unwrap_err()
        .contains("not allowed"));
}

fn read_artifact_refuses_escapes_and_missing_files(w: &World) {
    let secret = w.root.join("secret.md");
    std::fs::write(&secret, "SECRET").unwrap();
    std::os::unix::fs::symlink(&secret, w.p.join("docs/link.md")).unwrap();
    for bad in [
        "../secret.md".to_string(),
        "docs/../../secret.md".to_string(),
        secret.to_string_lossy().to_string(),
        "docs/link.md".to_string(),
        "".to_string(),
    ] {
        let r = desktop::read_artifact("p".into(), bad.clone());
        assert!(r.is_err(), "{bad} must be refused");
        assert!(!format!("{r:?}").contains("SECRET"));
    }
    let err = desktop::read_artifact("p".into(), "docs/nope.md".into()).unwrap_err();
    assert!(err.contains("not found"), "{err}");
    assert!(
        desktop::read_artifact("nope".into(), "docs/notes.md".into())
            .unwrap_err()
            .contains("unknown project")
    );
}

fn registry_roundtrips_readonly_and_filter_label() {
    let reg = bd_board_desktop::registry::load().unwrap();
    let ro = reg.projects.iter().find(|e| e.id == "ro").unwrap();
    assert!(ro.readonly);
    assert_eq!(ro.effective_filter_label(), Some("wo".to_string())); // trimmed
    let p = reg.projects.iter().find(|e| e.id == "p").unwrap();
    assert!(!p.readonly && p.effective_filter_label().is_none());

    let projects = desktop::list_projects().unwrap();
    let ro = projects.iter().find(|p| p.id == "ro").unwrap();
    assert!(ro.readonly);
    assert_eq!(ro.filter_label.as_deref(), Some("wo"));
    assert!(!projects.iter().find(|p| p.id == "p").unwrap().readonly);
}

fn readonly_launch_runs_the_shim_with_real_bd_and_the_filter(w: &World) {
    // list goes through plan_launch -> shim (REAL_BD, BD_FILTER_LABEL=wo): only the labelled bead.
    let beads = desktop::list_beads("ro".into()).unwrap();
    let ids: Vec<_> = beads.iter().map(|b| b.id.clone()).collect();
    assert!(ids.contains(&w.x), "{ids:?}");
    assert!(
        !ids.contains(&w.y),
        "filter must hide the other bead: {ids:?}"
    );
    // the unfiltered project shows everything
    assert_eq!(desktop::list_beads("p".into()).unwrap().len(), 3);
}

fn write_guard_refuses_readonly_and_changes_nothing(w: &World) {
    let before = bd(&w.ro, &["list", "--all", "--json"]);
    let refused = |r: Result<(), String>| {
        let e = r.unwrap_err();
        assert!(e.contains("read-only"), "{e}");
    };
    refused(desktop::update_bead_status(
        "ro".into(),
        w.x.clone(),
        "closed".into(),
    ));
    refused(desktop::update_bead(
        "ro".into(),
        w.x.clone(),
        desktop::BeadUpdateInput {
            title: Some("hacked".into()),
            ..Default::default()
        },
    ));
    refused(desktop::delete_bead("ro".into(), w.x.clone()));
    refused(desktop::add_comment("ro".into(), w.x.clone(), "hi".into()));
    assert!(
        desktop::create_bead("ro".into(), "new".into(), None, None, None)
            .unwrap_err()
            .contains("read-only")
    );
    assert!(desktop::preview_delete_bead("ro".into(), w.x.clone())
        .unwrap_err()
        .contains("read-only"));
    assert_eq!(before, bd(&w.ro, &["list", "--all", "--json"]));

    // and a normal project still writes
    desktop::add_comment("p".into(), w.c.clone(), "a note".into()).unwrap();
    let detail = desktop::get_bead_detail("p".into(), w.c.clone()).unwrap();
    assert!(detail.comments.iter().any(|c| c.text == "a note"));
}

fn comment_author_follows_the_fixture_actor() {
    let a = desktop::comment_author("p".into()).unwrap();
    assert_eq!(a.name, "fixture-actor");
    assert_eq!(a.source.as_deref(), Some("bd config actor"));
}

fn blocked_and_ready_map_from_real_bd_output(w: &World) {
    let beads = desktop::list_beads("p".into()).unwrap();
    let get = |id: &str| beads.iter().find(|b| b.id == id).unwrap();
    assert_eq!(get(&w.b).waiting_on.as_deref(), Some(&[w.a.clone()][..]));
    assert_eq!(get(&w.b).ready, Some(false));
    assert_eq!(get(&w.a).ready, Some(true));
    assert_eq!(get(&w.c).ready, Some(true));
    assert!(get(&w.a).waiting_on.as_ref().map_or(true, |v| v.is_empty()));

    let p = desktop::list_projects()
        .unwrap()
        .into_iter()
        .find(|p| p.id == "p")
        .unwrap();
    assert_eq!((p.counts.total, p.counts.blocked, p.counts.open), (3, 1, 2));

    // metadata / spec_id / external_ref survive the adapter
    let c = get(&w.c);
    assert_eq!(c.spec_id.as_deref(), Some("docs/spec.md"));
    assert_eq!(c.external_ref.as_deref(), Some("https://example.com/t/1"));
    assert!(c.metadata.is_some());
}
