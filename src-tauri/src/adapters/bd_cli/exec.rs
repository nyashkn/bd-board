//! Spawning bd: candidate binaries, launch plan (readonly shim), the per-project queue,
//! error text, and JSON helpers.

use super::queue::{
    is_read_call, output_with_timeout, queue_for, timeout_from_env, Queues, TIMEOUT_GRACE,
};
use crate::registry::{self, RegistryEntry};
use serde_json::Value;
use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

const BD_FALLBACK: &str = "/opt/homebrew/bin/bd";
const MAX_BUFFER: usize = 64 * 1024 * 1024;

pub(crate) fn bd_candidates() -> Vec<String> {
    let mut candidates = Vec::new();

    // (a) BD_BIN when set and non-empty
    if let Ok(bin) = env::var("BD_BIN") {
        if !bin.is_empty() {
            candidates.push(bin);
        }
    }

    // (b) $HOME/.local/bin/bd — the wrapper
    if let Ok(home) = env::var("HOME") {
        candidates.push(format!("{}/.local/bin/bd", home));
    }

    // (c) "bd" from PATH
    candidates.push("bd".to_string());

    // (d) Fallback
    candidates.push(BD_FALLBACK.to_string());

    candidates
}

/// What to spawn for a project: the candidate binaries and extra environment.
pub struct BdLaunch {
    pub candidates: Vec<String>,
    pub env: Vec<(String, String)>,
}

pub(crate) fn is_executable_file(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        path.metadata()
            .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        path.is_file()
    }
}

/// Absolute path of the first usable bd candidate (the shim needs a path in REAL_BD).
pub(crate) fn resolve_real_bd(
    candidates: &[String],
    executable: &dyn Fn(&Path) -> bool,
) -> Result<String, String> {
    let path_dirs: Vec<PathBuf> = env::var_os("PATH")
        .map(|p| env::split_paths(&p).collect())
        .unwrap_or_default();
    for candidate in candidates {
        if candidate.contains('/') {
            if executable(Path::new(candidate)) {
                return Ok(candidate.clone());
            }
            continue;
        }
        for dir in &path_dirs {
            let full = dir.join(candidate);
            if executable(&full) {
                return Ok(full.to_string_lossy().to_string());
            }
        }
    }
    Err(bd_not_found_message(candidates))
}

/// Minimum bd the board supports; mirrors MIN_BD_VERSION_LIVE_UPDATES in src/lib/bd-version.ts.
pub(crate) const MIN_BD_VERSION: &str = "1.3.0";

/// Mirrors bdNotFoundMessage in src/lib/bd-errors.ts: say what is missing, how to install it
/// and how to point the board at it.
pub(crate) fn bd_not_found_message(tried: &[String]) -> String {
    let now = env::var("BD_BIN")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| "unset".to_string());
    format!(
        "bd not found (tried: {}). Install bd {} or newer (brew install beads), or set BD_BIN to the full path of the binary (.env.local for the web app, the environment for the desktop app; now: {}).",
        tried.join(", "),
        MIN_BD_VERSION,
        now
    )
}

pub(crate) fn shim_path() -> Result<String, String> {
    if let Ok(p) = env::var("BD_READONLY_SHIM") {
        if !p.is_empty() {
            return Ok(p);
        }
    }
    let rel = "scripts/readonly/bd-readonly";
    let mut options: Vec<PathBuf> = Vec::new();
    if let Some(dir) = env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(Path::to_path_buf))
    {
        options.push(dir.join(rel));
        options.push(dir.join("../Resources").join(rel));
        options.push(dir.join("../lib/bd board").join(rel));
    }
    // Dev builds run from the repo checkout.
    options.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join(rel));
    options
        .into_iter()
        .find(|p| is_executable_file(p))
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| {
            "read-only shim scripts/readonly/bd-readonly not found (set BD_READONLY_SHIM)"
                .to_string()
        })
}

/// A readonly project runs the shim with REAL_BD set to the normally resolved bd;
/// filterLabel is only honoured together with readonly. Others are unchanged.
pub(crate) fn plan_launch(
    entry: Option<&RegistryEntry>,
    candidates: Vec<String>,
    shim: &dyn Fn() -> Result<String, String>,
    real_bd: &dyn Fn(&[String]) -> Result<String, String>,
) -> Result<BdLaunch, String> {
    let Some(entry) = entry.filter(|e| e.readonly) else {
        return Ok(BdLaunch {
            candidates,
            env: Vec::new(),
        });
    };
    let env = vec![
        ("REAL_BD".to_string(), real_bd(&candidates)?),
        (
            "BD_FILTER_LABEL".to_string(),
            entry.effective_filter_label().unwrap_or_default(),
        ),
    ];
    Ok(BdLaunch {
        candidates: vec![shim()?],
        env,
    })
}

pub(crate) fn launch_for(dir: &Path) -> Result<BdLaunch, String> {
    let dir_str = dir.to_string_lossy();
    let registry = registry::load()?;
    // Same folder registered twice: a readonly entry wins, never the other way round.
    let entry = registry
        .projects
        .iter()
        .filter(|e| e.path == dir_str)
        .max_by_key(|e| e.readonly);
    plan_launch(entry, bd_candidates(), &shim_path, &|c| {
        resolve_real_bd(c, &is_executable_file)
    })
}

pub(crate) fn bd_error_message(
    stdout: &str,
    stderr: &str,
    status: &std::process::ExitStatus,
) -> String {
    let stdout_trim = stdout.trim();
    let stderr_trim = stderr.trim();

    // Try to parse stdout as JSON and extract message or error
    if !stdout_trim.is_empty() {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(stdout_trim) {
            // Check for message field
            if let Some(msg) = json.get("message").and_then(|v| v.as_str()) {
                if !msg.is_empty() {
                    let mut result = msg.to_string();
                    if let Some(hint) = json.get("hint").and_then(|v| v.as_str()) {
                        if !hint.is_empty() {
                            result.push_str(&format!(" ({})", hint));
                        }
                    }
                    return result;
                }
            }

            // Check for error field
            if let Some(err) = json.get("error").and_then(|v| v.as_str()) {
                if !err.is_empty() {
                    let mut result = err.to_string();
                    if let Some(hint) = json.get("hint").and_then(|v| v.as_str()) {
                        if !hint.is_empty() {
                            result.push_str(&format!(" ({})", hint));
                        }
                    }
                    return result;
                }
            }
        }
    }

    // Fall back to stderr
    if !stderr_trim.is_empty() {
        return format!("bd exited with status {}: {}", status, stderr_trim);
    }

    // Last resort
    format!("bd exited with status {}", status)
}

#[derive(Clone)]
pub(crate) struct BdCapture {
    pub(crate) bin: String,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
    pub(crate) status: std::process::ExitStatus,
}

pub(crate) fn exec_bd(dir: &Path, args: &[&str]) -> Result<BdCapture, String> {
    exec_bd_with(dir, args, timeout_from_env())
}

pub(crate) fn exec_bd_with(
    dir: &Path,
    args: &[&str],
    timeout: std::time::Duration,
) -> Result<BdCapture, String> {
    static QUEUES: OnceLock<Queues<BdCapture>> = OnceLock::new();
    let queue = queue_for(&QUEUES, &dir.to_string_lossy());
    // Reads with the same args share a process; mutations always run.
    let key = is_read_call(args).then(|| format!("{:?}", args));
    queue.run(key.as_deref(), || spawn_bd(dir, args, timeout))
}

pub(crate) fn timeout_message(args: &[&str], timeout: std::time::Duration) -> String {
    let mut msg = format!(
        "bd {} timed out after {}s and was stopped",
        args.first().unwrap_or(&""),
        timeout.as_secs()
    );
    if !is_read_call(args) {
        msg.push_str("; the command may have been applied, so check before retrying");
    }
    msg
}

pub(crate) fn spawn_bd(
    dir: &Path,
    args: &[&str],
    timeout: std::time::Duration,
) -> Result<BdCapture, String> {
    let BdLaunch { candidates, env } = launch_for(dir)?;

    for candidate in &candidates {
        let mut cmd = Command::new(candidate);
        cmd.current_dir(dir).args(args).envs(env.iter().cloned());

        match output_with_timeout(&mut cmd, timeout, TIMEOUT_GRACE) {
            Ok(Err(())) => return Err(timeout_message(args, timeout)),
            Ok(Ok(output)) => {
                if output.stdout.len() > MAX_BUFFER {
                    return Err("bd output exceeded buffer".to_string());
                }

                return Ok(BdCapture {
                    bin: candidate.clone(),
                    stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                    stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                    status: output.status,
                });
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                continue;
            }
            Err(err) => {
                return Err(format!("failed to run {}: {}", candidate, err));
            }
        }
    }

    // Exhausted all candidates
    Err(bd_not_found_message(&candidates))
}

pub(crate) fn run_bd(dir: &Path, args: &[&str]) -> Result<String, String> {
    let cap = exec_bd(dir, args)?;
    if cap.status.success() {
        Ok(cap.stdout)
    } else {
        Err(bd_error_message(&cap.stdout, &cap.stderr, &cap.status))
    }
}

pub(crate) fn bd_json(dir: &Path, args: &[&str]) -> Result<Value, String> {
    let raw = run_bd(dir, args)?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(Value::Array(Vec::new()));
    }
    serde_json::from_str(trimmed).map_err(|err| err.to_string())
}

pub(crate) fn bd_json_lines(dir: &Path, args: &[&str]) -> Result<Vec<Value>, String> {
    let raw = run_bd(dir, args)?;
    raw.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(|line| serde_json::from_str(line).map_err(|err| err.to_string()))
        .collect()
}

pub(crate) fn bd_json_array(dir: &Path, args: &[&str]) -> Option<Vec<Value>> {
    bd_json(dir, args).ok()?.as_array().cloned()
}

pub(crate) fn run_bd_mut(dir: &Path, args: &[String]) -> Result<String, String> {
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_bd(dir, &arg_refs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timeout_message_warns_only_for_writes() {
        let t = std::time::Duration::from_secs(60);
        assert!(!super::timeout_message(&["show", "x"], t).contains("may have been applied"));
        assert!(super::timeout_message(&["update", "x"], t).contains("may have been applied"));
    }

    #[test]
    fn bd_error_message_extracts_message_field_from_json() {
        let stdout = r#"{"error":"no_beads_directory","hint":"run bd init","message":"no beads project found","schema_version":1}"#;
        let stderr = "";
        let status = std::process::Command::new("false").output().unwrap().status;

        let result = bd_error_message(stdout, stderr, &status);
        assert_eq!(result, "no beads project found (run bd init)");
    }

    #[test]
    fn bd_error_message_extracts_error_field_when_message_missing() {
        let stdout = r#"{"error":"some_error","hint":"try this","schema_version":1}"#;
        let stderr = "";
        let status = std::process::Command::new("false").output().unwrap().status;

        let result = bd_error_message(stdout, stderr, &status);
        assert_eq!(result, "some_error (try this)");
    }

    #[test]
    fn bd_error_message_falls_back_to_stderr() {
        let stdout = "";
        let stderr = "boom";
        let status = std::process::Command::new("false").output().unwrap().status;

        let result = bd_error_message(stdout, stderr, &status);
        assert!(result.contains("boom"));
    }

    fn entry(readonly: bool, filter: Option<&str>) -> RegistryEntry {
        RegistryEntry {
            id: "p".into(),
            path: "/p".into(),
            label: "P".into(),
            readonly,
            filter_label: filter.map(String::from),
            sources: vec![],
        }
    }

    fn plan(e: Option<&RegistryEntry>) -> Result<BdLaunch, String> {
        plan_launch(
            e,
            vec!["/x/bd".to_string(), "bd".to_string()],
            &|| Ok("/repo/scripts/readonly/bd-readonly".to_string()),
            &|_| Ok("/x/bd".to_string()),
        )
    }

    #[test]
    fn plan_launch_leaves_normal_projects_unchanged() {
        for e in [
            None,
            Some(entry(false, None)),
            Some(entry(false, Some("wo"))),
        ] {
            let l = plan(e.as_ref()).unwrap();
            assert_eq!(l.candidates, vec!["/x/bd".to_string(), "bd".to_string()]);
            assert!(l.env.is_empty());
        }
    }

    #[test]
    fn plan_launch_runs_the_shim_for_readonly_projects() {
        let l = plan(Some(&entry(true, None))).unwrap();
        assert_eq!(
            l.candidates,
            vec!["/repo/scripts/readonly/bd-readonly".to_string()]
        );
        assert!(l
            .env
            .contains(&("REAL_BD".to_string(), "/x/bd".to_string())));
        assert!(l
            .env
            .contains(&("BD_FILTER_LABEL".to_string(), String::new())));
    }

    #[test]
    fn plan_launch_passes_filter_label_only_with_readonly() {
        let l = plan(Some(&entry(true, Some("wo")))).unwrap();
        assert!(l
            .env
            .contains(&("BD_FILTER_LABEL".to_string(), "wo".to_string())));
    }

    #[test]
    fn plan_launch_fails_when_the_shim_or_bd_is_missing() {
        let e = entry(true, None);
        let no_shim = plan_launch(Some(&e), vec![], &|| Err("no shim".into()), &|_| {
            Ok("/x/bd".into())
        });
        assert!(no_shim.is_err());
        let no_bd = plan_launch(Some(&e), vec![], &|| Ok("/s".into()), &|_| {
            Err("no bd".into())
        });
        assert!(no_bd.is_err());
    }

    #[test]
    fn resolve_real_bd_picks_first_usable_path() {
        let only_y = |p: &Path| p == Path::new("/y/bd");
        assert_eq!(
            resolve_real_bd(&["/x/bd".to_string(), "/y/bd".to_string()], &only_y).unwrap(),
            "/y/bd"
        );
        assert!(resolve_real_bd(&["/x/bd".to_string()], &|_| false).is_err());
    }

    #[test]
    fn bd_candidates_includes_wrapper_before_fallback() {
        // When BD_BIN is not set, we should get the wrapper and fallback
        let candidates = bd_candidates();

        // The wrapper should be in the list
        let home = std::env::var("HOME").unwrap_or_default();
        let wrapper_path = format!("{}/.local/bin/bd", home);

        assert!(
            candidates.contains(&wrapper_path),
            "Wrapper path not found in candidates"
        );
        assert!(
            candidates.contains(&BD_FALLBACK.to_string()),
            "Fallback not found in candidates"
        );

        // Wrapper should come before the fallback
        let wrapper_idx = candidates.iter().position(|c| c == &wrapper_path).unwrap();
        let fallback_idx = candidates.iter().position(|c| c == BD_FALLBACK).unwrap();
        assert!(
            wrapper_idx < fallback_idx,
            "Wrapper should come before fallback"
        );
        assert!(
            wrapper_idx < fallback_idx,
            "Wrapper should come before fallback"
        );
    }

    #[test]
    fn bd_not_found_message_names_minimum_install_and_bd_bin() {
        let m = bd_not_found_message(&["bd".to_string(), "/opt/homebrew/bin/bd".to_string()]);
        assert!(m.starts_with("bd not found (tried: bd, /opt/homebrew/bin/bd)"));
        assert!(m.contains("1.3.0"));
        assert!(m.contains("brew install beads"));
        assert!(m.contains("BD_BIN"));
    }
}
