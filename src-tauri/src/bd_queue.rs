//! Per-project bd call queue. Embedded Dolt holds a process lock, so parallel `bd` calls
//! against one project serialize badly; calls for a project run through a bounded gate
//! (default 1), identical reads share one process (single-flight), and every spawn has a
//! timeout so a hung bd cannot hold the gate forever.

use std::collections::HashMap;
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};

pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(60);

/// bd subcommands that only read, so identical in-flight calls can share one process.
const READ_COMMANDS: &[&str] = &[
    "list", "show", "comments", "blocked", "ready", "count", "export", "where",
];

pub fn is_read_call(args: &[&str]) -> bool {
    args.first().is_some_and(|a| READ_COMMANDS.contains(a))
}

pub fn concurrency_from_env() -> usize {
    std::env::var("BD_BOARD_BD_CONCURRENCY")
        .ok()
        .and_then(|v| v.parse().ok())
        .filter(|n| *n >= 1)
        .unwrap_or(1)
}

pub fn timeout_from_env() -> Duration {
    std::env::var("BD_BOARD_BD_TIMEOUT_MS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .filter(|n| *n > 0)
        .map(Duration::from_millis)
        .unwrap_or(DEFAULT_TIMEOUT)
}

type Flight<T> = Arc<(Mutex<Option<T>>, Condvar)>;

pub struct Queue<T> {
    limit: usize,
    active: Mutex<usize>,
    freed: Condvar,
    flights: Mutex<HashMap<String, Flight<T>>>,
}

impl<T: Clone> Queue<T> {
    pub fn new(limit: usize) -> Self {
        Self {
            limit,
            active: Mutex::new(0),
            freed: Condvar::new(),
            flights: Mutex::new(HashMap::new()),
        }
    }

    /// Run `f` once a slot is free. A `Some` key joins an identical pending call and
    /// returns its result instead of running `f`.
    pub fn run(&self, key: Option<&str>, f: impl FnOnce() -> T) -> T {
        let Some(key) = key else {
            return self.gated(f);
        };
        let (flight, leader) = {
            let mut flights = self.flights.lock().unwrap();
            match flights.get(key) {
                Some(f) => (f.clone(), false),
                None => {
                    let f: Flight<T> = Arc::new((Mutex::new(None), Condvar::new()));
                    flights.insert(key.to_string(), f.clone());
                    (f, true)
                }
            }
        };
        if leader {
            let out = self.gated(f);
            self.flights.lock().unwrap().remove(key);
            *flight.0.lock().unwrap() = Some(out.clone());
            flight.1.notify_all();
            return out;
        }
        let mut slot = flight.0.lock().unwrap();
        while slot.is_none() {
            slot = flight.1.wait(slot).unwrap();
        }
        slot.clone().unwrap()
    }

    fn gated(&self, f: impl FnOnce() -> T) -> T {
        {
            let mut active = self.active.lock().unwrap();
            while *active >= self.limit {
                active = self.freed.wait(active).unwrap();
            }
            *active += 1;
        }
        // Release on drop so a panicking `f` cannot wedge the project.
        struct Release<'a, T>(&'a Queue<T>);
        impl<T> Drop for Release<'_, T> {
            fn drop(&mut self) {
                *self.0.active.lock().unwrap() -= 1;
                self.0.freed.notify_one();
            }
        }
        let _release = Release(self);
        f()
    }
}

pub type Queues<T> = Mutex<HashMap<String, Arc<Queue<T>>>>;

/// One queue per project directory, created on first use.
pub fn queue_for<T: Clone + Send + 'static>(
    registry: &'static OnceLock<Queues<T>>,
    dir: &str,
) -> Arc<Queue<T>> {
    let map = registry.get_or_init(|| Mutex::new(HashMap::new()));
    map.lock()
        .unwrap()
        .entry(dir.to_string())
        .or_insert_with(|| Arc::new(Queue::new(concurrency_from_env())))
        .clone()
}

pub struct Captured {
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub status: std::process::ExitStatus,
}

/// Like `Command::output`, but kills the child and errors once `timeout` passes.
pub fn output_with_timeout(
    cmd: &mut Command,
    timeout: Duration,
) -> std::io::Result<Result<Captured, ()>> {
    let mut child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    fn drain(mut r: impl Read + Send + 'static) -> std::thread::JoinHandle<Vec<u8>> {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = r.read_to_end(&mut buf);
            buf
        })
    }
    let out = drain(child.stdout.take().expect("piped"));
    let err = drain(child.stderr.take().expect("piped"));
    let deadline = Instant::now() + timeout;
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break Some(status);
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        std::thread::sleep(Duration::from_millis(5));
    };
    let stdout = out.join().unwrap_or_default();
    let stderr = err.join().unwrap_or_default();
    Ok(status
        .map(|status| Captured {
            stdout,
            stderr,
            status,
        })
        .ok_or(()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn gate_runs_one_at_a_time() {
        let q = Arc::new(Queue::<usize>::new(1));
        let running = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let hs: Vec<_> = (0..4)
            .map(|i| {
                let (q, running, peak) = (q.clone(), running.clone(), peak.clone());
                std::thread::spawn(move || {
                    q.run(None, || {
                        let now = running.fetch_add(1, Ordering::SeqCst) + 1;
                        peak.fetch_max(now, Ordering::SeqCst);
                        std::thread::sleep(Duration::from_millis(20));
                        running.fetch_sub(1, Ordering::SeqCst);
                        i
                    })
                })
            })
            .collect();
        for h in hs {
            h.join().unwrap();
        }
        assert_eq!(peak.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn higher_limit_allows_overlap() {
        let q = Arc::new(Queue::<()>::new(2));
        let running = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let hs: Vec<_> = (0..4)
            .map(|_| {
                let (q, running, peak) = (q.clone(), running.clone(), peak.clone());
                std::thread::spawn(move || {
                    q.run(None, || {
                        let now = running.fetch_add(1, Ordering::SeqCst) + 1;
                        peak.fetch_max(now, Ordering::SeqCst);
                        std::thread::sleep(Duration::from_millis(30));
                        running.fetch_sub(1, Ordering::SeqCst);
                    })
                })
            })
            .collect();
        for h in hs {
            h.join().unwrap();
        }
        assert_eq!(peak.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn identical_keys_share_one_call() {
        let q = Arc::new(Queue::<usize>::new(1));
        let calls = Arc::new(AtomicUsize::new(0));
        let hs: Vec<_> = (0..5)
            .map(|_| {
                let (q, calls) = (q.clone(), calls.clone());
                std::thread::spawn(move || {
                    q.run(Some("k"), || {
                        std::thread::sleep(Duration::from_millis(80));
                        calls.fetch_add(1, Ordering::SeqCst) + 1
                    })
                })
            })
            .collect();
        let results: Vec<_> = hs.into_iter().map(|h| h.join().unwrap()).collect();
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(results.iter().all(|r| *r == 1));
        // finished calls are not cached
        assert_eq!(q.run(Some("k"), || 7), 7);
    }

    #[test]
    fn errors_reach_every_joiner_and_the_gate_survives() {
        let q = Arc::new(Queue::<Result<(), String>>::new(1));
        let hs: Vec<_> = (0..3)
            .map(|_| {
                let q = q.clone();
                std::thread::spawn(move || {
                    q.run(Some("k"), || {
                        std::thread::sleep(Duration::from_millis(50));
                        Err("boom".to_string())
                    })
                })
            })
            .collect();
        for h in hs {
            assert_eq!(h.join().unwrap(), Err("boom".to_string()));
        }
        assert_eq!(q.run(None, || Ok(())), Ok(()));
    }

    #[test]
    fn a_panic_releases_the_gate() {
        let q = Arc::new(Queue::<u8>::new(1));
        let q2 = q.clone();
        let _ = std::thread::spawn(move || q2.run(None, || panic!("x"))).join();
        assert_eq!(q.run(None, || 1), 1);
    }

    #[test]
    fn classifies_reads() {
        assert!(is_read_call(&["show", "x", "--json"]));
        assert!(!is_read_call(&["update", "x"]));
        assert!(!is_read_call(&[]));
    }

    #[test]
    fn timeout_kills_a_hung_child() {
        let started = Instant::now();
        let r = output_with_timeout(Command::new("sleep").arg("5"), Duration::from_millis(100));
        assert!(matches!(r, Ok(Err(()))));
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn fast_child_returns_its_output() {
        let r = output_with_timeout(Command::new("echo").arg("hi"), Duration::from_secs(5))
            .unwrap()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&r.stdout).trim(), "hi");
        assert!(r.status.success());
    }
}
