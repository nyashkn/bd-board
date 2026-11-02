//! The change probe: `HASHOF('HEAD')` on the project's pooled connection, once a second while a
//! watch is open. Every bd write makes a Dolt commit, so a moved head means something changed.
//! It sends the same `BeadFeedMessage` shape as the events-journal feed, so the UI needs nothing new.

use super::session::Delta;
use super::DoltSql;
use crate::domain::BeadFeedMessage;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Inside the 1-2 s the owner asked for. A local probe costs 0.1 ms, a remote one one round trip.
pub(crate) const POLL: Duration = Duration::from_secs(1);
const TICK: Duration = Duration::from_millis(50);

/// Polls until `stop` is set or `send` returns false. Returns on the first error after sending it:
/// the client retries, and the router decides whether another source takes over.
pub(crate) fn watch_loop(
    db: &DoltSql,
    stop: &AtomicBool,
    poll: Duration,
    send: &dyn Fn(BeadFeedMessage) -> bool,
) {
    let mut last = match db.head() {
        Ok(head) => head,
        Err(message) => {
            send(BeadFeedMessage::Error { message });
            return;
        }
    };
    if !send(BeadFeedMessage::Live { seq: 0 }) {
        return;
    }
    let mut seq = 0;
    loop {
        let mut waited = Duration::ZERO;
        while waited < poll {
            if stop.load(Ordering::Relaxed) {
                return;
            }
            std::thread::sleep(TICK);
            waited += TICK;
        }
        let head = match db.head() {
            Ok(head) => head,
            Err(message) => {
                send(BeadFeedMessage::Error { message });
                return;
            }
        };
        if head == last {
            continue;
        }
        seq += 1;
        // A failed or unclear delta is not an error: no ids and no ops means "refresh everything".
        let (issue_ids, ops) = match db.delta(&last, &head) {
            Ok(Delta::Comments(ids)) if !ids.is_empty() => (ids, vec!["comment".to_string()]),
            _ => (vec![], vec![]),
        };
        last = head;
        if !send(BeadFeedMessage::Change {
            seq,
            issue_ids,
            ops,
        }) {
            return;
        }
    }
}

/// Managed Tauri state: the open probes, so a page load or app exit can stop them all.
#[derive(Default)]
pub struct DoltWatches {
    next: AtomicU32,
    stops: Mutex<HashMap<u32, Arc<AtomicBool>>>,
}

impl DoltWatches {
    pub(crate) fn start(
        &self,
        project_id: &str,
        send: impl Fn(BeadFeedMessage) -> bool + Send + 'static,
    ) -> Result<u32, String> {
        let db = super::handle_for(project_id)?;
        let id = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        let stop = Arc::new(AtomicBool::new(false));
        self.stops
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id, stop.clone());
        std::thread::spawn(move || watch_loop(&db, &stop, POLL, &send));
        Ok(id)
    }

    pub(crate) fn stop(&self, id: u32) {
        if let Some(stop) = self
            .stops
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&id)
        {
            stop.store(true, Ordering::Relaxed);
        }
    }

    pub fn cancel_all(&self) {
        for (_, stop) in self.stops.lock().unwrap_or_else(|e| e.into_inner()).drain() {
            stop.store(true, Ordering::Relaxed);
        }
    }
}
