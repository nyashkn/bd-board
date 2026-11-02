//! Events-journal change feed (mirrors src/lib/bead-feed-server.ts)

use super::exec::{bd_error_message, exec_bd, launch_for, BdCapture};
use crate::domain::BeadFeedMessage;
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

const FEED_PAGE_SIZE: usize = 1000;
const JOURNAL_DISABLED_MARKER: &str = "events journal is disabled";
const TRUNCATED_CODE: &str = "events_journal_truncated";

#[derive(Debug, PartialEq)]
enum FeedLine {
    Record {
        seq: i64,
        op: String,
        issue_ids: Vec<String>,
    },
    Truncated {
        head: i64,
    },
}

fn parse_feed_line(line: &str) -> Option<FeedLine> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    let value: Value = serde_json::from_str(trimmed).ok()?;
    let obj = value.as_object()?;

    if obj.get("code").and_then(Value::as_str) == Some(TRUNCATED_CODE) {
        if let Some(head) = obj.get("head").and_then(Value::as_i64) {
            return Some(FeedLine::Truncated { head });
        }
    }

    let seq = obj.get("seq").and_then(Value::as_i64)?;
    let op = obj.get("op").and_then(Value::as_str)?.to_string();

    let mut issue_ids = Vec::new();
    let issue_id = obj
        .get("issue_id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty());
    if let Some(id) = issue_id {
        issue_ids.push(id.to_string());
    }
    let target = obj
        .get("dep")
        .and_then(|d| d.get("target"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty());
    if let Some(t) = target {
        if Some(t) != issue_id {
            issue_ids.push(t.to_string());
        }
    }
    Some(FeedLine::Record { seq, op, issue_ids })
}

fn tail_args(since: i64, limit: Option<usize>, follow: bool) -> Vec<String> {
    let mut args: Vec<String> = ["events", "tail", "--json", "--since"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    args.push(since.to_string());
    if let Some(limit) = limit {
        args.push("--limit".to_string());
        args.push(limit.to_string());
    }
    if follow {
        args.push("--follow".to_string());
    }
    args
}

#[derive(Debug, PartialEq)]
enum DrainOutcome {
    Ready(i64),
    Disabled,
    Unsupported(String),
}

fn find_truncated_head(stdout: &str) -> Option<i64> {
    stdout.lines().find_map(|l| match parse_feed_line(l) {
        Some(FeedLine::Truncated { head }) => Some(head),
        _ => None,
    })
}

fn record_seqs(stdout: &str) -> Vec<i64> {
    stdout
        .lines()
        .filter_map(|l| match parse_feed_line(l) {
            Some(FeedLine::Record { seq, .. }) => Some(seq),
            _ => None,
        })
        .collect()
}

fn drain_journal(
    exec: &mut dyn FnMut(&[String]) -> Result<BdCapture, String>,
    since: i64,
) -> DrainOutcome {
    let mut cur = since;
    let mut checked_reset = false;
    let mut first = true;

    loop {
        let r = match exec(&tail_args(cur, Some(FEED_PAGE_SIZE), false)) {
            Ok(r) => r,
            Err(err) => return DrainOutcome::Unsupported(err),
        };
        if first && r.stderr.contains(JOURNAL_DISABLED_MARKER) {
            return DrainOutcome::Disabled;
        }
        if !r.status.success() {
            if let Some(head) = find_truncated_head(&r.stdout) {
                return DrainOutcome::Ready(head);
            }
            return DrainOutcome::Unsupported(bd_error_message(&r.stdout, &r.stderr, &r.status));
        }

        let seqs = record_seqs(&r.stdout);
        if let Some(last) = seqs.last() {
            cur = *last;
        }
        if seqs.len() == FEED_PAGE_SIZE {
            first = false;
            continue;
        }

        if first && seqs.is_empty() && cur > 0 && !checked_reset {
            let v = match exec(&tail_args(cur - 1, Some(1), false)) {
                Ok(v) => v,
                Err(err) => return DrainOutcome::Unsupported(err),
            };
            let valid = if v.status.success() {
                record_seqs(&v.stdout).first() == Some(&cur)
            } else {
                find_truncated_head(&v.stdout).is_some_and(|head| head >= cur)
            };
            if !valid {
                cur = 0;
                checked_reset = true;
                first = true;
                continue;
            }
        }

        return DrainOutcome::Ready(cur);
    }
}

#[derive(Default)]
pub struct FeedWatch {
    cancelled: AtomicBool,
    child: Mutex<Option<Child>>,
}

impl FeedWatch {
    fn kill_child(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.kill();
            }
        }
    }
}

#[derive(Default)]
pub struct FeedWatches {
    next_id: AtomicU32,
    watches: Arc<Mutex<HashMap<u32, Arc<FeedWatch>>>>,
}

impl FeedWatches {
    pub fn cancel_all(&self) {
        let all: Vec<Arc<FeedWatch>> = match self.watches.lock() {
            Ok(mut map) => map.drain().map(|(_, w)| w).collect(),
            Err(_) => return,
        };
        for watch in all {
            watch.cancelled.store(true, Ordering::SeqCst);
            watch.kill_child();
        }
    }
}

fn run_feed(dir: &Path, since: i64, watch: &FeedWatch, send: &dyn Fn(BeadFeedMessage) -> bool) {
    let emit = |msg: BeadFeedMessage| -> bool {
        if send(msg) {
            true
        } else {
            watch.cancelled.store(true, Ordering::SeqCst);
            watch.kill_child();
            false
        }
    };

    let mut bin = String::new();
    let bd_env = launch_for(dir).map(|l| l.env).unwrap_or_default();
    let outcome = {
        let mut exec = |args: &[String]| -> Result<BdCapture, String> {
            let refs: Vec<&str> = args.iter().map(String::as_str).collect();
            let cap = exec_bd(dir, &refs)?;
            if bin.is_empty() {
                bin = cap.bin.clone();
            }
            Ok(cap)
        };
        drain_journal(&mut exec, since)
    };

    let mut cur = match outcome {
        DrainOutcome::Disabled => {
            emit(BeadFeedMessage::Disabled);
            return;
        }
        DrainOutcome::Unsupported(message) => {
            emit(BeadFeedMessage::Unsupported { message });
            return;
        }
        DrainOutcome::Ready(seq) => {
            if !emit(BeadFeedMessage::Live { seq }) {
                return;
            }
            seq
        }
    };

    loop {
        if watch.cancelled.load(Ordering::SeqCst) {
            return;
        }
        let mut child = match Command::new(&bin)
            .current_dir(dir)
            .envs(bd_env.iter().cloned())
            .args(tail_args(cur, None, true))
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(child) => child,
            Err(err) => {
                emit(BeadFeedMessage::Error {
                    message: format!("failed to run {}: {}", bin, err),
                });
                return;
            }
        };
        let Some(stdout) = child.stdout.take() else {
            let _ = child.kill();
            let _ = child.wait();
            emit(BeadFeedMessage::Error {
                message: "bd events tail produced no stdout".to_string(),
            });
            return;
        };
        if let Ok(mut guard) = watch.child.lock() {
            *guard = Some(child);
        }
        if watch.cancelled.load(Ordering::SeqCst) {
            watch.kill_child();
        }

        let mut truncated = false;
        for line in BufReader::new(stdout).lines() {
            if watch.cancelled.load(Ordering::SeqCst) {
                break;
            }
            let Ok(line) = line else { break };
            match parse_feed_line(&line) {
                Some(FeedLine::Record { seq, op, issue_ids }) => {
                    cur = seq;
                    if !emit(BeadFeedMessage::Change {
                        seq,
                        issue_ids,
                        ops: vec![op],
                    }) {
                        break;
                    }
                }
                Some(FeedLine::Truncated { head }) => {
                    cur = head;
                    truncated = true;
                    if !emit(BeadFeedMessage::Change {
                        seq: head,
                        issue_ids: Vec::new(),
                        ops: Vec::new(),
                    }) {
                        break;
                    }
                }
                None => {}
            }
        }

        let child = watch.child.lock().ok().and_then(|mut g| g.take());
        let status = child.map(|mut c| {
            let _ = c.kill();
            c.wait()
        });
        if watch.cancelled.load(Ordering::SeqCst) {
            return;
        }
        if truncated {
            continue;
        }
        let status_text = match status {
            Some(Ok(s)) => s.to_string(),
            Some(Err(e)) => e.to_string(),
            None => "unknown".to_string(),
        };
        emit(BeadFeedMessage::Error {
            message: format!("bd events tail exited ({})", status_text),
        });
        return;
    }
}

impl FeedWatches {
    /// Starts a watch thread for `dir`; `send` returns false once the receiver is gone.
    pub(crate) fn start(
        &self,
        dir: PathBuf,
        since: i64,
        send: impl Fn(BeadFeedMessage) -> bool + Send + 'static,
    ) -> Result<u32, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let watch = Arc::new(FeedWatch::default());
        self.watches
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id, watch.clone());
        let registry = self.watches.clone();

        std::thread::spawn(move || {
            run_feed(&dir, since.max(0), &watch, &send);
            if let Ok(mut map) = registry.lock() {
                map.remove(&id);
            }
        });

        Ok(id)
    }

    pub(crate) fn stop(&self, watch_id: u32) {
        let removed = self
            .watches
            .lock()
            .ok()
            .and_then(|mut m| m.remove(&watch_id));
        if let Some(watch) = removed {
            watch.cancelled.store(true, Ordering::SeqCst);
            watch.kill_child();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_feed_line_dep_record_with_issue_and_target() {
        let line =
            r#"{"seq":7,"op":"dep_add","issue_id":"a","dep":{"kind":"blocks","target":"b"}}"#;
        let result = parse_feed_line(line);
        assert_eq!(
            result,
            Some(FeedLine::Record {
                seq: 7,
                op: "dep_add".to_string(),
                issue_ids: vec!["a".to_string(), "b".to_string()]
            })
        );
    }

    #[test]
    fn parse_feed_line_truncation() {
        let line = r#"{"code":"events_journal_truncated","error":"journal was reset","floor":0,"head":100,"since":50}"#;
        let result = parse_feed_line(line);
        assert_eq!(result, Some(FeedLine::Truncated { head: 100 }));
    }

    #[test]
    fn parse_feed_line_note_returns_none() {
        let line = "note: the events journal is disabled";
        assert_eq!(parse_feed_line(line), None);
    }

    #[test]
    fn parse_feed_line_garbage_returns_none() {
        assert_eq!(parse_feed_line("not json at all"), None);
        assert_eq!(parse_feed_line(""), None);
        assert_eq!(parse_feed_line("   "), None);
    }

    #[test]
    fn drain_journal_disabled() {
        let mut exec = |_args: &[String]| -> Result<BdCapture, String> {
            Ok(BdCapture {
                bin: "bd".to_string(),
                stdout: "".to_string(),
                stderr: "note: the events journal is disabled for this workspace (enable with 'bd config set events-journal true'); …"
                    .to_string(),
                status: std::process::Command::new("true").output().unwrap().status,
            })
        };
        let outcome = drain_journal(&mut exec, 0);
        assert_eq!(outcome, DrainOutcome::Disabled);
    }

    #[test]
    fn drain_journal_pagination() {
        let mut call_count = 0;
        let mut calls: Vec<Vec<String>> = Vec::new();
        let mut exec = |args: &[String]| -> Result<BdCapture, String> {
            call_count += 1;
            calls.push(args.to_vec());
            let stdout = if call_count == 1 {
                (1..=1000)
                    .map(|i| {
                        serde_json::json!({
                            "seq": i,
                            "op": "create",
                            "issue_id": format!("id-{}", i),
                        })
                        .to_string()
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            } else if call_count == 2 {
                (1001..=1003)
                    .map(|i| {
                        serde_json::json!({
                            "seq": i,
                            "op": "update",
                            "issue_id": format!("id-{}", i),
                        })
                        .to_string()
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            } else {
                String::new()
            };
            Ok(BdCapture {
                bin: "bd".to_string(),
                stdout,
                stderr: String::new(),
                status: std::process::Command::new("true").output().unwrap().status,
            })
        };
        let outcome = drain_journal(&mut exec, 0);
        assert_eq!(outcome, DrainOutcome::Ready(1003));
        assert_eq!(calls[1], tail_args(1000, Some(FEED_PAGE_SIZE), false));
    }

    #[test]
    fn drain_journal_truncated_head() {
        let mut exec = |_args: &[String]| -> Result<BdCapture, String> {
            Ok(BdCapture {
                bin: "bd".to_string(),
                stdout: r#"{"code":"events_journal_truncated","error":"reset","floor":0,"head":980,"since":0}"#
                    .to_string(),
                stderr: String::new(),
                status: std::process::Command::new("false").output().unwrap().status,
            })
        };
        let outcome = drain_journal(&mut exec, 0);
        assert_eq!(outcome, DrainOutcome::Ready(980));
    }

    #[test]
    fn drain_journal_unsupported() {
        let mut exec = |_args: &[String]| -> Result<BdCapture, String> {
            Ok(BdCapture {
                bin: "bd".to_string(),
                stdout: String::new(),
                stderr: "Error: unknown command \"events\" for \"bd\"".to_string(),
                status: std::process::Command::new("false").output().unwrap().status,
            })
        };
        let outcome = drain_journal(&mut exec, 0);
        match outcome {
            DrainOutcome::Unsupported(msg) => assert!(msg.contains("unknown command")),
            _ => panic!("expected Unsupported, got {:?}", outcome),
        }
    }

    #[test]
    fn drain_journal_stale_checkpoint() {
        let mut call_count = 0;
        let mut calls: Vec<Vec<String>> = Vec::new();
        let mut exec = |args: &[String]| -> Result<BdCapture, String> {
            call_count += 1;
            calls.push(args.to_vec());
            let stdout = String::new();
            Ok(BdCapture {
                bin: "bd".to_string(),
                stdout,
                stderr: String::new(),
                status: std::process::Command::new("true").output().unwrap().status,
            })
        };
        let outcome = drain_journal(&mut exec, 50);
        assert_eq!(outcome, DrainOutcome::Ready(0));
        assert_eq!(call_count, 3);
        assert_eq!(calls[0], tail_args(50, Some(FEED_PAGE_SIZE), false));
        assert_eq!(calls[1], tail_args(49, Some(1), false));
        assert_eq!(calls[2], tail_args(0, Some(FEED_PAGE_SIZE), false));
    }

    #[test]
    fn drain_journal_valid_checkpoint() {
        let mut call_count = 0;
        let mut exec = |_args: &[String]| -> Result<BdCapture, String> {
            call_count += 1;
            let stdout = if call_count == 1 {
                String::new()
            } else if call_count == 2 {
                serde_json::json!({
                    "seq": 50,
                    "op": "create",
                    "issue_id": "id-50",
                })
                .to_string()
            } else {
                String::new()
            };
            Ok(BdCapture {
                bin: "bd".to_string(),
                stdout,
                stderr: String::new(),
                status: std::process::Command::new("true").output().unwrap().status,
            })
        };
        let outcome = drain_journal(&mut exec, 50);
        assert_eq!(outcome, DrainOutcome::Ready(50));
        assert_eq!(call_count, 2);
    }
}
