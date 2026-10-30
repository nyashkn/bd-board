//! `snapshot`: export, then ready, then blocked, one after another (parallel is slower on the
//! embedded lock). Concurrent callers for a project share work, see `coalesced`.

use super::exec::{bd_json_array, run_bd};
use crate::domain::snapshot::build_snapshot;
use crate::domain::ProjectSnapshot;
use crate::registry::resolve_dir;
use serde_json::Value;
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::{Arc, Condvar, Mutex, OnceLock};

type Outcome<V> = Arc<(Mutex<Option<Result<V, String>>>, Condvar)>;

struct Slot<V> {
    running: Option<Outcome<V>>,
    trailing: Option<Outcome<V>>,
}

type Slots<V> = Mutex<HashMap<String, Slot<V>>>;

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn new_outcome<V>() -> Outcome<V> {
    Arc::new((Mutex::new(None), Condvar::new()))
}

fn wait<V: Clone>(outcome: &Outcome<V>) -> Result<V, String> {
    let mut slot = lock(&outcome.0);
    while slot.is_none() {
        slot = outcome.1.wait(slot).unwrap_or_else(|e| e.into_inner());
    }
    slot.clone().unwrap()
}

/// Publishes the result, or an error if `build` unwinds, and frees the slot for the next caller.
struct Publish<'a, V> {
    slots: &'a Slots<V>,
    key: &'a str,
    outcome: Outcome<V>,
}

impl<V> Drop for Publish<'_, V> {
    fn drop(&mut self) {
        {
            let mut slot = lock(&self.outcome.0);
            if slot.is_none() {
                *slot = Some(Err("snapshot failed before it finished".to_string()));
            }
        }
        self.outcome.1.notify_all();
        if let Some(s) = lock(self.slots).get_mut(self.key) {
            if s.running
                .as_ref()
                .is_some_and(|r| Arc::ptr_eq(r, &self.outcome))
            {
                s.running = None;
            }
        }
    }
}

/// One run at a time per key. Callers that arrive while it runs join a single trailing run that
/// starts when it ends, so a burst costs at most two runs and no caller gets a result that began
/// before its call (a write may have landed in between).
fn coalesced<V: Clone>(
    slots: &Slots<V>,
    key: &str,
    build: impl FnOnce() -> Result<V, String>,
) -> Result<V, String> {
    let (mine, behind) = {
        let mut map = lock(slots);
        let slot = map.entry(key.to_string()).or_insert(Slot {
            running: None,
            trailing: None,
        });
        if let Some(trailing) = &slot.trailing {
            let joined = trailing.clone();
            drop(map);
            return wait(&joined);
        }
        let mine = new_outcome();
        match &slot.running {
            Some(running) => {
                slot.trailing = Some(mine.clone());
                (mine, Some(running.clone()))
            }
            None => {
                slot.running = Some(mine.clone());
                (mine, None)
            }
        }
    };
    let guard = Publish {
        slots,
        key,
        outcome: mine.clone(),
    };
    if let Some(running) = behind {
        let _ = wait(&running);
        let mut map = lock(slots);
        if let Some(slot) = map.get_mut(key) {
            slot.running = slot.trailing.take();
        }
    }
    let out = build();
    *lock(&mine.0) = Some(out.clone());
    drop(guard);
    out
}

fn parse_lines(raw: &str) -> Result<Vec<Value>, String> {
    raw.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(|l| serde_json::from_str(l).map_err(|e| e.to_string()))
        .collect()
}

fn hash_of(parts: &[&str]) -> String {
    let mut hasher = DefaultHasher::new();
    parts.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn build(dir: &std::path::Path) -> Result<ProjectSnapshot, String> {
    let exported = run_bd(dir, &["export"])?;
    let ready = run_bd(dir, &["ready", "--json", "-n", "0"]).ok();
    let blocked = run_bd(dir, &["blocked", "--json"]).ok();
    let rows = |raw: &Option<String>| -> Option<Vec<Value>> {
        let text = raw.as_deref()?.trim();
        if text.is_empty() {
            return Some(Vec::new());
        }
        serde_json::from_str::<Value>(text)
            .ok()?
            .as_array()
            .cloned()
    };
    let cursor = hash_of(&[
        &exported,
        ready.as_deref().unwrap_or(""),
        blocked.as_deref().unwrap_or(""),
    ]);
    Ok(build_snapshot(
        &parse_lines(&exported)?,
        rows(&ready).as_deref(),
        rows(&blocked).as_deref(),
        cursor,
    ))
}

pub(crate) fn snapshot_inner(project_id: &str) -> Result<ProjectSnapshot, String> {
    static SLOTS: OnceLock<Slots<ProjectSnapshot>> = OnceLock::new();
    let dir = resolve_dir(project_id)?;
    let slots = SLOTS.get_or_init(|| Mutex::new(HashMap::new()));
    coalesced(slots, &dir.to_string_lossy(), || build(&dir))
}

pub(crate) fn bead_comments_inner(
    project_id: &str,
    id: &str,
) -> Result<Vec<crate::domain::Comment>, String> {
    let dir = resolve_dir(project_id)?;
    let rows = bd_json_array(&dir, &["comments", id, "--json"])
        .ok_or_else(|| format!("bd comments {id} returned no list"))?;
    Ok(rows
        .iter()
        .map(crate::domain::bd_json::map_comment)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    #[test]
    fn a_burst_costs_at_most_two_runs_and_never_shares_a_run_that_began_earlier() {
        let slots: Arc<Slots<usize>> = Arc::new(Mutex::new(HashMap::new()));
        let runs = Arc::new(AtomicUsize::new(0));
        let handles: Vec<_> = (0..6)
            .map(|i| {
                let (slots, runs) = (slots.clone(), runs.clone());
                std::thread::spawn(move || {
                    // The first caller is already running when the rest arrive.
                    std::thread::sleep(Duration::from_millis(if i == 0 { 0 } else { 30 }));
                    let called_after_runs = runs.load(Ordering::SeqCst);
                    let n = coalesced(&slots, "p", || {
                        std::thread::sleep(Duration::from_millis(120));
                        Ok(runs.fetch_add(1, Ordering::SeqCst) + 1)
                    })
                    .unwrap();
                    (called_after_runs, n)
                })
            })
            .collect();
        let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
        assert_eq!(runs.load(Ordering::SeqCst), 2);
        // The late callers all got run 2, which began after they called.
        assert_eq!(results.iter().filter(|(_, n)| *n == 2).count(), 5);
    }

    #[test]
    fn a_failed_run_reaches_its_joiners_and_the_key_is_free_again() {
        let slots: Slots<usize> = Mutex::new(HashMap::new());
        let err = coalesced(&slots, "p", || Err("boom".to_string())).unwrap_err();
        assert_eq!(err, "boom");
        assert_eq!(coalesced(&slots, "p", || Ok(7)).unwrap(), 7);
    }

    #[test]
    fn a_panicking_run_does_not_wedge_the_key() {
        let slots: Arc<Slots<usize>> = Arc::new(Mutex::new(HashMap::new()));
        let s = slots.clone();
        let _ = std::thread::spawn(move || coalesced(&s, "p", || panic!("bd blew up"))).join();
        assert_eq!(coalesced(&slots, "p", || Ok(1)).unwrap(), 1);
    }

    #[test]
    fn cursor_changes_with_the_content() {
        assert_eq!(hash_of(&["a", "b"]), hash_of(&["a", "b"]));
        assert_ne!(hash_of(&["a", "b"]), hash_of(&["a", "c"]));
    }
}
