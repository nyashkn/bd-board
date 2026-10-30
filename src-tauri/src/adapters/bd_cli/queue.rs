//! Per-project bd call queue. Embedded Dolt holds a process lock, so parallel `bd` calls
//! against one project serialize badly; calls for a project run through a bounded gate
//! (default 1, 4 once the probe shows a reachable Dolt server), identical reads share one
//! process (single-flight), and every spawn has a timeout so a hung bd cannot hold the gate
//! forever. Two FIFO lanes: user calls go before background polls; nothing is preempted.
//!
//! When the app quits, bd children are not killed: they lead their own process group, so
//! neither Ctrl-C in `tauri dev` nor the exit reaches them, and the timeout thread dies with
//! the app. They end by themselves: a write runs to completion (killing it mid-flight is
//! worse), and a read that outlives the app gets EPIPE on its closed pipes.

use std::collections::HashMap;
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex, OnceLock};
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

/// Concurrency for projects on a reachable Dolt server; embedded Dolt stays at 1.
pub const SERVER_CONCURRENCY: usize = 4;

/// The explicit BD_BOARD_BD_CONCURRENCY, if valid; it beats the probe-based default.
pub fn env_concurrency() -> Option<usize> {
    std::env::var("BD_BOARD_BD_CONCURRENCY")
        .ok()
        .and_then(|v| v.parse().ok())
        .filter(|n| *n >= 1)
}

pub fn concurrency_from_env() -> usize {
    env_concurrency().unwrap_or(1)
}

/// What the probe says about a project's limit: server and reachable = 4, embedded = 1,
/// anything else unknown (keep the current limit).
pub fn concurrency_for_probe(embedded: Option<bool>, connection_ok: Option<bool>) -> Option<usize> {
    match (embedded, connection_ok) {
        (Some(true), _) => Some(1),
        (Some(false), Some(true)) => Some(SERVER_CONCURRENCY),
        _ => None,
    }
}

/// 'user' = a bead open or a write; 'background' = an interval poll or the probe.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Priority {
    User,
    Background,
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

/// A queued read and its lane flag.
type Pending<V> = (Flight<V>, Arc<AtomicBool>);

/// A call waiting for a slot. `urgent` is the user lane; a user joiner can set it later.
struct Waiter {
    id: u64,
    urgent: Arc<AtomicBool>,
}

struct Slots {
    active: usize,
    next_id: u64,
    waiting: Vec<Waiter>,
}

impl Slots {
    /// Next to run: the oldest user call, else the oldest background call.
    fn head(&self) -> Option<u64> {
        self.waiting
            .iter()
            .find(|w| w.urgent.load(Ordering::SeqCst))
            .or(self.waiting.first())
            .map(|w| w.id)
    }
}

pub struct Queue<V> {
    limit: AtomicUsize,
    slots: Mutex<Slots>,
    changed: Condvar,
    /// Reads that are queued but have not started, with their lane flag. A flight leaves this
    /// map the moment it starts (under the same lock joiners use), so a call never shares a
    /// read that began before the call was made: it could predate a write that finished in between.
    flights: Mutex<HashMap<String, Pending<V>>>,
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
        if flights
            .get(key)
            .is_some_and(|(f, _)| Arc::ptr_eq(f, flight))
        {
            flights.remove(key);
        }
    }
}

impl<V: Clone> Queue<V> {
    pub fn new(limit: usize) -> Self {
        Self {
            limit: AtomicUsize::new(limit),
            slots: Mutex::new(Slots {
                active: 0,
                next_id: 0,
                waiting: Vec::new(),
            }),
            changed: Condvar::new(),
            flights: Mutex::new(HashMap::new()),
        }
    }

    /// Change the bound at runtime (e.g. once the probe shows a Dolt server). Never preempts.
    pub fn set_limit(&self, limit: usize) {
        self.limit.store(limit, Ordering::SeqCst);
        self.wake();
    }

    /// Wake every waiter to re-check its turn (taking the lock so none misses it).
    fn wake(&self) {
        drop(self.slots.lock().unwrap_or_else(|e| e.into_inner()));
        self.changed.notify_all();
    }

    /// `run_prio` as a user call (the app always passes a priority; tests use this).
    #[cfg(test)]
    pub fn run(
        &self,
        key: Option<&str>,
        f: impl FnOnce() -> Result<V, String>,
    ) -> Result<V, String> {
        self.run_prio(key, Priority::User, f)
    }

    /// Run `f` once a slot is free: user calls first, then background, each in arrival order.
    /// A `Some` key joins an identical read that is still waiting for its turn and returns its
    /// result instead of running `f`; a user joiner moves a background read up to the user lane.
    pub fn run_prio(
        &self,
        key: Option<&str>,
        priority: Priority,
        f: impl FnOnce() -> Result<V, String>,
    ) -> Result<V, String> {
        let urgent = Arc::new(AtomicBool::new(priority == Priority::User));
        let Some(key) = key else {
            return self.gated(urgent, || {}, f);
        };
        let flight = {
            let mut flights = self.flights.lock().unwrap();
            if let Some((f, lane)) = flights.get(key) {
                let (f, lane) = (f.clone(), lane.clone());
                drop(flights);
                if priority == Priority::User && !lane.swap(true, Ordering::SeqCst) {
                    self.wake();
                }
                let mut slot = f.0.lock().unwrap_or_else(|e| e.into_inner());
                while slot.is_none() {
                    slot = f.1.wait(slot).unwrap_or_else(|e| e.into_inner());
                }
                return slot.clone().unwrap();
            }
            let f: Flight<V> = Arc::new((Mutex::new(None), Condvar::new()));
            flights.insert(key.to_string(), (f.clone(), urgent.clone()));
            f
        };
        let guard = FlightGuard {
            queue: self,
            key,
            flight,
        };
        let out = self.gated(urgent, || self.forget(key, &guard.flight), f);
        *guard.flight.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(out.clone());
        out
    }

    fn gated<R>(
        &self,
        urgent: Arc<AtomicBool>,
        on_start: impl FnOnce(),
        f: impl FnOnce() -> R,
    ) -> R {
        {
            let mut slots = self.slots.lock().unwrap_or_else(|e| e.into_inner());
            let id = slots.next_id;
            slots.next_id += 1;
            slots.waiting.push(Waiter { id, urgent });
            while slots.active >= self.limit.load(Ordering::SeqCst) || slots.head() != Some(id) {
                slots = self.changed.wait(slots).unwrap_or_else(|e| e.into_inner());
            }
            slots.waiting.retain(|w| w.id != id);
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
extern "C" {
    fn killpg(pgrp: i32, sig: i32) -> i32;
}

/// Signal the child's whole process group (it leads its own, see below), which also reaches
/// what the read-only shim spawns and would otherwise keep the pipes and the Dolt lock.
#[cfg(unix)]
fn signal_group(pgid: u32, sig: i32) -> bool {
    // SAFETY: plain libc call with integer arguments.
    unsafe { killpg(pgid as i32, sig) == 0 }
}

#[cfg(not(unix))]
fn signal_group(_pgid: u32, _sig: i32) -> bool {
    false
}

/// SIGTERM the group, give it `grace` to disappear, then SIGKILL whatever is left.
/// On non-unix only the direct child is killed.
fn stop_group(child: &mut std::process::Child, grace: Duration) {
    let pgid = child.id();
    if !signal_group(pgid, 15) {
        let _ = child.kill();
    }
    let until = Instant::now() + grace;
    // try_wait reaps the leader, so a gone group really answers ESRCH.
    while Instant::now() < until {
        let leader_gone = child.try_wait().map(|s| s.is_some()).unwrap_or(true);
        if leader_gone && !signal_group(pgid, 0) {
            break;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    signal_group(pgid, 9);
    let _ = child.kill();
    let _ = child.wait();
}

/// Like `Command::output`, but on `timeout` stops the child's whole process group (SIGTERM,
/// then SIGKILL after `grace`) and returns `Ok(Err(()))` without waiting on the pipes.
/// After a normal exit the pipes get `grace` to close; a stray helper holding them open
/// is killed and reported as an error so it cannot hold the queue slot.
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
    fn drain(mut r: impl Read + Send + 'static) -> mpsc::Receiver<Vec<u8>> {
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = r.read_to_end(&mut buf);
            let _ = tx.send(buf);
        });
        rx
    }
    let out = drain(child.stdout.take().expect("piped"));
    let err = drain(child.stderr.take().expect("piped"));
    let deadline = Instant::now() + timeout;
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if Instant::now() >= deadline {
            stop_group(&mut child, grace);
            // Do not wait on the readers: a survivor could hold the pipes open.
            return Ok(Err(()));
        }
        std::thread::sleep(Duration::from_millis(5));
    };
    let pipes_closed = Instant::now() + grace;
    let take = |rx: &mpsc::Receiver<Vec<u8>>| {
        rx.recv_timeout(pipes_closed.saturating_duration_since(Instant::now()))
            .ok()
    };
    match (take(&out), take(&err)) {
        (Some(stdout), Some(stderr)) => Ok(Ok(Captured {
            stdout,
            stderr,
            status,
        })),
        _ => {
            signal_group(child.id(), 9);
            Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "bd exited but a helper kept its output open and was stopped",
            ))
        }
    }
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

    fn start(
        q: &Arc<Queue<usize>>,
        key: Option<&'static str>,
        priority: Priority,
        order: &Arc<Mutex<Vec<&'static str>>>,
        name: &'static str,
    ) -> std::thread::JoinHandle<Result<usize, String>> {
        let (q, order) = (q.clone(), order.clone());
        let h = std::thread::spawn(move || {
            q.run_prio(key, priority, || {
                order.lock().unwrap().push(name);
                Ok(0)
            })
        });
        std::thread::sleep(ms(20)); // arrive in the order started
        h
    }

    #[test]
    fn user_calls_go_before_background_ones_fifo_inside_each_lane() {
        let q = Arc::new(Queue::<usize>::new(1));
        let order = Arc::new(Mutex::new(Vec::new()));
        let blocker = hold(&q, 150);
        let hs = vec![
            start(&q, None, Priority::Background, &order, "bg1"),
            start(&q, None, Priority::Background, &order, "bg2"),
            start(&q, None, Priority::User, &order, "u1"),
            start(&q, None, Priority::User, &order, "u2"),
        ];
        blocker.join().unwrap().unwrap();
        for h in hs {
            h.join().unwrap().unwrap();
        }
        assert_eq!(*order.lock().unwrap(), vec!["u1", "u2", "bg1", "bg2"]);
    }

    #[test]
    fn a_user_joiner_moves_a_queued_background_read_up() {
        let q = Arc::new(Queue::<usize>::new(1));
        let order = Arc::new(Mutex::new(Vec::new()));
        let blocker = hold(&q, 150);
        let other = start(&q, None, Priority::Background, &order, "other-bg");
        let poll = start(&q, Some("k"), Priority::Background, &order, "k");
        let user = {
            let q = q.clone();
            std::thread::spawn(move || q.run_prio(Some("k"), Priority::User, || Ok(99)))
        };
        blocker.join().unwrap().unwrap();
        for h in [other, poll] {
            h.join().unwrap().unwrap();
        }
        assert_eq!(user.join().unwrap(), Ok(0)); // shared the poll's call
        assert_eq!(*order.lock().unwrap(), vec!["k", "other-bg"]);
    }

    #[test]
    fn raising_the_limit_starts_queued_calls_at_once() {
        let q = Arc::new(Queue::<()>::new(1));
        let running = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let hs: Vec<_> = (0..4)
            .map(|_| {
                let (q, running, peak) = (q.clone(), running.clone(), peak.clone());
                std::thread::spawn(move || {
                    q.run(None, || {
                        let now = running.fetch_add(1, Ordering::SeqCst) + 1;
                        peak.fetch_max(now, Ordering::SeqCst);
                        std::thread::sleep(ms(200));
                        running.fetch_sub(1, Ordering::SeqCst);
                        Ok(())
                    })
                })
            })
            .collect();
        std::thread::sleep(ms(50));
        assert_eq!(running.load(Ordering::SeqCst), 1);
        q.set_limit(4);
        std::thread::sleep(ms(50));
        assert_eq!(running.load(Ordering::SeqCst), 4);
        for h in hs {
            h.join().unwrap().unwrap();
        }
        assert_eq!(peak.load(Ordering::SeqCst), 4);
    }

    #[test]
    fn the_probe_picks_four_for_a_reachable_server_and_one_for_embedded() {
        assert_eq!(concurrency_for_probe(Some(false), Some(true)), Some(4));
        assert_eq!(concurrency_for_probe(Some(true), None), Some(1));
        assert_eq!(concurrency_for_probe(Some(false), Some(false)), None);
        assert_eq!(concurrency_for_probe(Some(false), None), None);
        assert_eq!(concurrency_for_probe(None, None), None);
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

    #[cfg(unix)]
    fn pid_alive(pid: i32) -> bool {
        extern "C" {
            fn kill(pid: i32, sig: i32) -> i32;
        }
        // SAFETY: signal 0 only checks existence.
        unsafe { kill(pid, 0) == 0 }
    }

    #[cfg(unix)]
    fn read_pid(path: &std::path::Path) -> i32 {
        std::fs::read_to_string(path)
            .unwrap()
            .trim()
            .parse()
            .unwrap()
    }

    #[cfg(unix)]
    fn scratch(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("bdq-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    /// A TERM-ignoring grandchild holds the pipe, as the read-only shim's pipeline can.
    #[cfg(unix)]
    #[test]
    fn timeout_leaves_neither_leader_nor_grandchild_alive() {
        let d = scratch("gc");
        let script = format!(
            "echo $$ > {d}/leader; (trap '' TERM; sleep 30) & echo $! > {d}/gc; wait",
            d = d.display()
        );
        let started = Instant::now();
        let r = output_with_timeout(Command::new("sh").args(["-c", &script]), ms(300), ms(200));
        assert!(matches!(r, Ok(Err(()))));
        assert!(
            started.elapsed() < Duration::from_secs(3),
            "queue stayed blocked"
        );
        std::thread::sleep(ms(300));
        assert!(!pid_alive(read_pid(&d.join("leader"))));
        assert!(!pid_alive(read_pid(&d.join("gc"))));
    }

    /// The leader dies on SIGTERM at once; the real bd under it needs the grace to exit
    /// by itself before SIGKILL.
    #[cfg(unix)]
    #[test]
    fn group_gets_the_grace_before_sigkill() {
        let d = scratch("grace");
        let script = format!(
            "(trap 'touch {d}/term; exit 0' TERM; sleep 30 & wait) & echo $! > {d}/gc; wait",
            d = d.display()
        );
        let r = output_with_timeout(Command::new("sh").args(["-c", &script]), ms(300), ms(1000));
        assert!(matches!(r, Ok(Err(()))));
        assert!(
            d.join("term").exists(),
            "helper never saw SIGTERM before it was killed"
        );
        std::thread::sleep(ms(200));
        assert!(!pid_alive(read_pid(&d.join("gc"))));
    }

    /// Normal exit, but a helper keeps the pipe open: bounded wait, then kill and error.
    #[cfg(unix)]
    #[test]
    fn a_helper_holding_the_pipe_after_exit_is_stopped() {
        let d = scratch("stray");
        let script = format!("sleep 30 & echo $! > {d}/gc; exit 0", d = d.display());
        let started = Instant::now();
        let r = output_with_timeout(Command::new("sh").args(["-c", &script]), ms(5000), ms(300));
        assert_eq!(
            r.err().map(|e| e.kind()),
            Some(std::io::ErrorKind::TimedOut)
        );
        assert!(started.elapsed() < Duration::from_secs(3));
        std::thread::sleep(ms(300));
        assert!(!pid_alive(read_pid(&d.join("gc"))));
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
