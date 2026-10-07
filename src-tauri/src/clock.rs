use std::sync::atomic::{AtomicI64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// UTC epoch milliseconds (R2).
///
/// Never local time, never a formatted string, never the server clock. Device
/// clocks are wrong; a monotonic local logical clock decides ordering, and the
/// wall clock is only ever used for display.
static LAST: AtomicI64 = AtomicI64::new(0);

pub fn now_ms() -> i64 {
    let wall = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default();

    // Strictly non-decreasing. Two writes in the same millisecond would
    // otherwise share `updated_at`, and `ORDER BY updated_at DESC` would stop
    // being a total order.
    let mut previous = LAST.load(Ordering::Relaxed);
    loop {
        let next = if wall > previous { wall } else { previous + 1 };
        match LAST.compare_exchange_weak(previous, next, Ordering::Relaxed, Ordering::Relaxed) {
            Ok(_) => return next,
            Err(observed) => previous = observed,
        }
    }
}
