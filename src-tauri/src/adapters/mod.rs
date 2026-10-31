//! Implementations of the ports. Depend on ports and domain, never on commands or app.

pub(crate) mod bd_cli;
#[cfg(feature = "dolt-sql")]
pub(crate) mod dolt_sql;
#[cfg(not(feature = "dolt-sql"))]
#[path = "dolt_sql_off.rs"]
pub(crate) mod dolt_sql;
