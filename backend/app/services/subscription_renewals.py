"""In-process scheduler for monthly subscription renewals.

`charge_due_subscriptions` has always existed, and `POST /api/payments/subscriptions/
run-recurring` has always been able to trigger it -- but nothing ever called that endpoint.
No cron entry, no worker, nothing in the compose file. So renewals simply never happened:
every membership ran to `next_charge_at`, fell out of the entitlement grace window, and
quietly stopped working, which is the "subscriptions don't renew by themselves" report.

Relying on an external scheduler that has to be wired up correctly on every deployment is
exactly how that happened, so the app now drives the job itself: one daemon thread, started
with the app, that wakes on an interval and charges whatever is due. The HTTP endpoint stays
for manual kicks and for an external cron that wants to own the schedule instead.

Safety properties:

* **Never charges twice.** A renewal advances `next_charge_at` by a period inside the same
  transaction that records the payment, so a row stops being "due" the moment it is charged.
  Two overlapping runs are additionally prevented by the module-level lock below.
* **Never blocks the app.** Everything runs on its own thread with its own session, and every
  failure is swallowed and logged: a provider outage must not take the API down with it.
* **Idempotent across restarts.** Due-ness is computed from the database, never from
  in-memory state, so a restart mid-cycle loses nothing.
"""

from __future__ import annotations

import atexit
import logging
import threading

from app.config import settings

logger = logging.getLogger(__name__)

# Renewals are due on a 30-day boundary, so checking a few times a day is plenty: it bounds
# how late a renewal can be to a few hours while keeping the provider traffic negligible.
_DEFAULT_INTERVAL_SECONDS = 6 * 60 * 60

# A short first run so a deployment picks up anything that fell due while the process was
# down, without making startup wait for the provider.
_STARTUP_DELAY_SECONDS = 90

_thread: threading.Thread | None = None
_thread_lock = threading.Lock()
_stop_event = threading.Event()
_run_lock = threading.Lock()


def _interval_seconds() -> float:
    configured = getattr(settings, "payments_recurring_charge_interval_seconds", 0) or 0
    try:
        normalized = float(configured)
    except (TypeError, ValueError):
        normalized = 0.0
    if normalized <= 0:
        return float(_DEFAULT_INTERVAL_SECONDS)
    # A floor keeps a misconfigured value from turning into a charge loop against the provider.
    return max(normalized, 300.0)


def run_subscription_renewals_once() -> dict[str, int] | None:
    """Charge everything currently due. Returns None when another run is already in flight."""
    if not _run_lock.acquire(blocking=False):
        logger.info("Subscription renewal run skipped: a previous run is still in flight")
        return None
    try:
        from app.database import SessionLocal
        from app.services.payments import charge_due_subscriptions

        db = SessionLocal()
        try:
            result = charge_due_subscriptions(db)
            if result.get("due"):
                logger.info(
                    "Subscription renewals processed: due=%s charged=%s failed=%s expired=%s",
                    result.get("due"),
                    result.get("charged"),
                    result.get("failed"),
                    result.get("expired"),
                )
            return result
        finally:
            try:
                db.close()
            except Exception:
                logger.exception("Subscription renewal run could not close its session")
    except Exception:
        logger.exception("Subscription renewal run failed")
        return None
    finally:
        _run_lock.release()


def _worker() -> None:
    # Wait before the first pass so startup is never held up by the payment provider.
    if _stop_event.wait(_STARTUP_DELAY_SECONDS):
        return
    while not _stop_event.is_set():
        run_subscription_renewals_once()
        if _stop_event.wait(_interval_seconds()):
            return


def start_subscription_renewal_scheduler() -> bool:
    """Start the renewal loop. Safe to call more than once; returns True if it started here."""
    if not bool(getattr(settings, "payments_recurring_charges_enabled", True)):
        logger.info("Subscription renewal scheduler disabled by configuration")
        return False

    global _thread
    with _thread_lock:
        if _thread is not None and _thread.is_alive():
            return False
        _stop_event.clear()
        _thread = threading.Thread(
            target=_worker,
            name="subscription-renewals",
            daemon=True,
        )
        _thread.start()
    atexit.register(stop_subscription_renewal_scheduler)
    logger.info(
        "Subscription renewal scheduler started: interval=%.0fs",
        _interval_seconds(),
    )
    return True


def stop_subscription_renewal_scheduler(wait: bool = False) -> None:
    global _thread
    _stop_event.set()
    with _thread_lock:
        thread = _thread
        _thread = None
    if wait and thread is not None and thread.is_alive():
        thread.join(timeout=5)
