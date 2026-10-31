//! The dolt-sql adapter when the `dolt-sql` feature is off: every call is "source unavailable",
//! so the client router falls through to bd-cli exactly as it does for an unreachable server.

use crate::domain::BeadFeedMessage;

const OFF: &str = "source unavailable (dolt-sql): not built into this app";

#[derive(Default)]
pub struct DoltWatches {
    _off: (),
}

impl DoltWatches {
    pub(crate) fn start(
        &self,
        _project_id: &str,
        _send: impl Fn(BeadFeedMessage) -> bool + Send + 'static,
    ) -> Result<u32, String> {
        Err(OFF.to_string())
    }

    pub(crate) fn stop(&self, _id: u32) {}

    pub fn cancel_all(&self) {}
}
