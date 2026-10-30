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
/// Time between SIGTERM and SIGKILL when a call times out.
pub const TIMEOUT_GRACE: Duration = Duration::from_secs(2);

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

/// The shared outcome of one queued read. Joiners wait on it.
type Flight<V> = Arc<(Mutex<Option<Result<V, String>>>, Condvar)>;

struct Slots {
    active: usize,
    next_ticket: u64,
    serving: u64,
}

pub struct Queue<V> {
    limit: usize,
    slots: Mutex<Slots>,
    changed: Condvar,
    /// Reads that are queued but have not started. A flight leaves this map the moment it
    /// starts (under the same lock joiners use), so a call never shares a read that began
    /// before the call was made: it could predate a write that finished in between.
    flights: Mutex<HashMap<String, Flight<V>>>,
}

/// Wakes joiners with an error if the leader unwinds, and forgets an unstarted flight.
struct FlightGuard<'a, V> {
    queue: &'a Queue<V>,
    key: &'a str,
    flight: Flight<V>,
}

impl<V> Drop for FlightGuard<'_, V> {
    fn drop(&mut self) {
        self.queue.forget(self.key, &self.flight);
        let mut slot = self.flight.0.lock().unwrap_or_else(|e| e.into_inner());
        if slot.is_none() {
            *slot = Some(Err("bd call failed before it finished".to_string()));
        }
        self.flight.1.notify_all();
    }
}

impl<V> Queue<V> {
    fn forget(&self, key: &str, flight: &Flight<V>) {
        let mut flights = self.flights.lock().unwrap_or_else(|e| e.into_inner());
        if flights.get(key).is_some_and(|f| Arc::ptr_eq(f, flight)) {
            flights.remove(key);
        }
    }
}

impl<V: Clone> Queue<V> {
    pub fn new(limit: usize) -> Self {
        Self {
            limit,
            slots: Mutex::new(Slots {
                active: 0,
                next_ticket: 0,
                serving: 0,
            }),
            changed: Condvar::new(),
            flights: Mutex::new(HashMap::new()),
        }
    }

    /// Run `f` once a slot is free, in arrival order. A `Some` key joins an identical read
    /// that is still waiting for its turn and returns its result instead of running `f`.
    pub fn run(
        &self,
        key: Option<&str>,
        f: impl FnOnce() -> Result<V, String>,
    ) -> Result<V, String> {
        let Some(key) = key else {
            return self.gated(|| {}, f);
        };
        let flight = {
            let mut flights = self.flights.lock().unwrap();
            if let Some(f) = flights.get(key) {
                let f = f.clone();
                drop(flights);
                let mut slot = f.0.lock().unwrap_or_else(|e| e.into_inner());
                while slot.is_none() {
                    slot = f.1.wait(slot).unwrap_or_else(|e| e.into_inner());
                }
                return slot.clone().unwrap();
            }
            let f: Flight<V> = Arc::new((Mutex::new(None), Condvar::new()));
            flights.insert(key.to_string(), f.clone());
            f
        };
        let guard = FlightGuard {
            queue: self,
            key,
            flight,
        };
        let out = self.gated(|| self.forget(key, &guard.flight), f);
        *guard.flight.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(out.clone());
        out
    }

    fn gated<R>(&self, on_start: impl FnOnce(), f: impl FnOnce() -> R) -> R {
        {
            let mut slots = self.slots.lock().unwrap_or_else(|e| e.into_inner());
            let ticket = slots.next_ticket;
            slots.next_ticket += 1;
            while slots.serving != ticket || slots.active >= self.limit {
                slots = self.changed.wait(slots).unwrap_or_else(|e| e.into_inner());
            }
            slots.serving += 1;
            slots.active += 1;
            on_start();
            self.changed.notify_all();
        }
        // Release on drop so a panicking `f` cannot wedge the project.
        struct Release<'a, V>(&'a Queue<V>);
        impl<V> Drop for Release<'_, V> {
            fn drop(&mut self) {
                self.0
                    .slots
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .active -= 1;
                self.0.changed.notify_all();
            }
        }
        let _release = Release(self);
        f()
    }
}

pub type Queues<V> = Mutex<HashMap<String, Arc<Queue<V>>>>;

/// One queue per project directory, created on first use.
pub fn queue_for<V: Clone + Send + 'static>(
    registry: &'static OnceLock<Queues<V>>,
    dir: &str,
) -> Arc<Queue<V>> {
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

#[cfg(unix)]
fn signal_group(pid: u32, sig: i32) {
    extern "C" {
        fn killpg(pgrp: i32, sig: i32) -> i32;
    }
    // The child leads its own process group (see below), so this reaches the shim's real
    // bd and filter too, which would otherwise keep the pipes and the Dolt lock.
    unsafe {
        killpg(pid as i32, sig);
    }
}

#[cfg(not(unix))]
fn signal_group(_pid: u32, _sig: i32) {}

/// Like `Command::output`, but on `timeout` stops the child's whole process group (SIGTERM,
/// then SIGKILL after `grace`) and returns `Ok(Err(()))` without waiting on the pipes.
pub fn output_with_timeout(
    cmd: &mut Command,
    timeout: Duration,
    grace: Duration,
) -> std::io::Result<Result<Captured, ()>> {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
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
            signal_group(child.id(), 15);
            let kill_at = Instant::now() + grace;
            while child.try_wait()?.is_none() && Instant::now() < kill_at {
                std::thread::sleep(Duration::from_millis(5));
            }
            signal_group(child.id(), 9);
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        std::thread::sleep(Duration::from_millis(5));
    };
    let Some(status) = status else {
        // Do not join the readers: a survivor could hold the pipes open indefinitely.
        return Ok(Err(()));
    };
    Ok(Ok(Captured {
        stdout: out.join().unwrap_or_default(),
        stderr: err.join().unwrap_or_default(),
        status,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::mpsc;

    fn ms(n: u64) -> Duration {
        Duration::from_millis(n)
    }

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
                        std::thread::sleep(ms(20));
                        running.fetch_sub(1, Ordering::SeqCst);
                        Ok(i)
                    })
                })
            })
            .collect();
        for h in hs {
            h.join().unwrap().unwrap();
        }
        assert_eq!(peak.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn runs_in_arrival_order() {
        let q = Arc::new(Queue::<usize>::new(1));
        let order = Arc::new(Mutex::new(Vec::new()));
        let blocker = {
            let q = q.clone();
            std::thread::spawn(move || {
                q.run(None, || {
                    std::thread::sleep(ms(100));
                    Ok(0)
                })
            })
        };
        std::thread::sleep(ms(20));
        let mut hs = vec![];
        for i in 1..=5 {
            let (q, order) = (q.clone(), order.clone());
            hs.push(std::thread::spawn(move || {
                q.run(None, || {
                    order.lock().unwrap().push(i);
                    Ok(i)
                })
            }));
            std::thread::sleep(ms(10));
        }
        blocker.join().unwrap().unwrap();
        for h in hs {
            h.join().unwrap().unwrap();
        }
        assert_eq!(*order.lock().unwrap(), vec![1, 2, 3, 4, 5]);
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
                        std::thread::sleep(ms(30));
                        running.fetch_sub(1, Ordering::SeqCst);
                        Ok(())
                    })
                })
            })
            .collect();
        for h in hs {
            h.join().unwrap().unwrap();
        }
        assert_eq!(peak.load(Ordering::SeqCst), 2);
    }

    /// Hold the only slot so later calls queue behind it.
    fn hold(q: &Arc<Queue<usize>>, millis: u64) -> std::thread::JoinHandle<Result<usize, String>> {
        let q = q.clone();
        let h = std::thread::spawn(move || {
            q.run(None, || {
                std::thread::sleep(ms(millis));
                Ok(0)
            })
        });
        std::thread::sleep(ms(20));
        h
    }

    #[test]
    fn queued_identical_reads_share_one_call() {
        let q = Arc::new(Queue::<usize>::new(1));
        let calls = Arc::new(AtomicUsize::new(0));
        let blocker = hold(&q, 100);
        let hs: Vec<_> = (0..5)
            .map(|_| {
                let (q, calls) = (q.clone(), calls.clone());
                std::thread::spawn(move || {
                    q.run(Some("k"), || Ok(calls.fetch_add(1, Ordering::SeqCst) + 1))
                })
            })
            .collect();
        blocker.join().unwrap().unwrap();
        let results: Vec<_> = hs.into_iter().map(|h| h.join().unwrap().unwrap()).collect();
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(results.iter().all(|r| *r == 1));
        // finished calls are not cached
        assert_eq!(q.run(Some("k"), || Ok(7)), Ok(7));
    }

    #[test]
    fn a_read_after_a_write_never_gets_a_read_that_started_before_it() {
        let q = Arc::new(Queue::<usize>::new(2));
        let earlier = {
            let q = q.clone();
            std::thread::spawn(move || {
                q.run(Some("k"), || {
                    std::thread::sleep(ms(200));
                    Ok(1)
                })
            })
        };
        std::thread::sleep(ms(30)); // the earlier read is now running
        q.run(None, || Ok(0)).unwrap(); // a write completes while it runs
        assert_eq!(q.run(Some("k"), || Ok(2)), Ok(2));
        assert_eq!(earlier.join().unwrap(), Ok(1));
    }

    #[test]
    fn errors_reach_every_joiner_and_the_gate_survives() {
        let q = Arc::new(Queue::<usize>::new(1));
        let blocker = hold(&q, 100);
        let hs: Vec<_> = (0..3)
            .map(|_| {
                let q = q.clone();
                std::thread::spawn(move || q.run(Some("k"), || Err("boom".to_string())))
            })
            .collect();
        blocker.join().unwrap().unwrap();
        for h in hs {
            assert_eq!(h.join().unwrap(), Err("boom".to_string()));
        }
        assert_eq!(q.run(None, || Ok(1)), Ok(1));
    }

    #[test]
    fn a_panicking_shared_read_wakes_its_joiners_and_later_reads_start_fresh() {
        let q = Arc::new(Queue::<usize>::new(1));
        let blocker = hold(&q, 150);
        let leader = {
            let q = q.clone();
            std::thread::spawn(move || q.run(Some("k"), || panic!("spawn failed")))
        };
        std::thread::sleep(ms(20));
        let (tx, rx) = mpsc::channel();
        let joiner = {
            let q = q.clone();
            std::thread::spawn(move || tx.send(q.run(Some("k"), || Ok(9))).unwrap())
        };
        blocker.join().unwrap().unwrap();
        assert!(leader.join().is_err());
        let got = rx
            .recv_timeout(Duration::from_secs(3))
            .expect("joiner hung");
        assert!(got.is_err());
        joiner.join().unwrap();
        assert_eq!(q.run(Some("k"), || Ok(5)), Ok(5));
    }

    #[test]
    fn a_panic_releases_the_gate() {
        let q = Arc::new(Queue::<usize>::new(1));
        let q2 = q.clone();
        let _ = std::thread::spawn(move || q2.run(None, || panic!("x"))).join();
        assert_eq!(q.run(None, || Ok(1)), Ok(1));
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
        let r = output_with_timeout(Command::new("sleep").arg("5"), ms(100), ms(100));
        assert!(matches!(r, Ok(Err(()))));
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    /// Like the read-only shim's filter pipeline: a grandchild that outlives the shim and
    /// ignores SIGTERM keeps the pipe (and in real life the Dolt lock) open.
    #[cfg(unix)]
    #[test]
    fn timeout_stops_a_grandchild_that_holds_the_pipe() {
        let marker = std::env::temp_dir().join(format!("bdq-gc-{}", std::process::id()));
        let script = format!(
            "(trap '' TERM; sleep 30; touch {m}) & wait",
            m = marker.display()
        );
        let started = Instant::now();
        let r = output_with_timeout(Command::new("sh").args(["-c", &script]), ms(100), ms(200));
        assert!(matches!(r, Ok(Err(()))));
        assert!(
            started.elapsed() < Duration::from_secs(3),
            "queue stayed blocked"
        );
        // the group is gone: nothing is left to finish the sleep
        assert!(!marker.exists());
    }

    #[test]
    fn fast_child_returns_its_output() {
        let r = output_with_timeout(
            Command::new("echo").arg("hi"),
            Duration::from_secs(5),
            ms(100),
        )
        .unwrap()
        .unwrap();
        assert_eq!(String::from_utf8_lossy(&r.stdout).trim(), "hi");
        assert!(r.status.success());
    }
}
