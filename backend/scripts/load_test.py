from __future__ import annotations

import argparse
import json
import threading
import time
from collections import Counter
from dataclasses import dataclass
from typing import Any

import requests


@dataclass
class RunStats:
    total: int = 0
    success: int = 0
    failed: int = 0
    exception_count: int = 0
    latencies_ms: list[float] | None = None
    statuses: Counter[int] | None = None
    errors: Counter[str] | None = None

    def __post_init__(self) -> None:
        if self.latencies_ms is None:
            self.latencies_ms = []
        if self.statuses is None:
            self.statuses = Counter()
        if self.errors is None:
            self.errors = Counter()


def _parse_headers(raw_headers: list[str]) -> dict[str, str]:
    headers: dict[str, str] = {}
    for raw in raw_headers:
        if ":" not in raw:
            continue
        key, value = raw.split(":", 1)
        key = key.strip()
        value = value.strip()
        if key:
            headers[key] = value
    return headers


def _percentile(values: list[float], percent: float) -> float:
    if not values:
        return 0.0
    if percent <= 0:
        return values[0]
    if percent >= 100:
        return values[-1]
    idx = (len(values) - 1) * (percent / 100.0)
    lower = int(idx)
    upper = min(lower + 1, len(values) - 1)
    weight = idx - lower
    return values[lower] * (1.0 - weight) + values[upper] * weight


def _worker(
    *,
    base_url: str,
    path: str,
    method: str,
    headers: dict[str, str],
    body: dict[str, Any] | None,
    timeout_s: float,
    end_at: float,
    expected_status: int,
    stats: RunStats,
    lock: threading.Lock,
) -> None:
    url = f"{base_url.rstrip('/')}/{path.lstrip('/')}"
    session = requests.Session()
    while time.perf_counter() < end_at:
        started = time.perf_counter()
        try:
            if method == "GET":
                response = session.get(url, headers=headers, timeout=timeout_s)
            elif method == "POST":
                response = session.post(url, headers=headers, json=body, timeout=timeout_s)
            elif method == "PATCH":
                response = session.patch(url, headers=headers, json=body, timeout=timeout_s)
            elif method == "DELETE":
                response = session.delete(url, headers=headers, timeout=timeout_s)
            else:
                raise RuntimeError(f"Unsupported method: {method}")
            elapsed_ms = (time.perf_counter() - started) * 1000.0
            status_code = int(response.status_code)
            ok = status_code == expected_status
            with lock:
                stats.total += 1
                stats.latencies_ms.append(elapsed_ms)
                stats.statuses[status_code] += 1
                if ok:
                    stats.success += 1
                else:
                    stats.failed += 1
        except requests.RequestException as exc:
            elapsed_ms = (time.perf_counter() - started) * 1000.0
            error_key = type(exc).__name__
            with lock:
                stats.total += 1
                stats.failed += 1
                stats.exception_count += 1
                stats.latencies_ms.append(elapsed_ms)
                stats.errors[error_key] += 1


def _print_report(*, stats: RunStats, duration_s: float) -> dict[str, Any]:
    latencies = sorted(stats.latencies_ms)
    total = stats.total
    success = stats.success
    failed = stats.failed
    success_rate = (success / total * 100.0) if total else 0.0
    rps = (total / duration_s) if duration_s > 0 else 0.0
    success_rps = (success / duration_s) if duration_s > 0 else 0.0

    p50 = _percentile(latencies, 50)
    p95 = _percentile(latencies, 95)
    p99 = _percentile(latencies, 99)
    avg = (sum(latencies) / len(latencies)) if latencies else 0.0
    minimum = latencies[0] if latencies else 0.0
    maximum = latencies[-1] if latencies else 0.0

    report = {
        "duration_seconds": round(duration_s, 3),
        "total_requests": total,
        "success_requests": success,
        "failed_requests": failed,
        "success_rate_percent": round(success_rate, 3),
        "rps": round(rps, 3),
        "success_rps": round(success_rps, 3),
        "latency_ms": {
            "min": round(minimum, 3),
            "avg": round(avg, 3),
            "p50": round(p50, 3),
            "p95": round(p95, 3),
            "p99": round(p99, 3),
            "max": round(maximum, 3),
        },
        "status_counts": dict(sorted(stats.statuses.items(), key=lambda item: item[0])),
        "error_counts": dict(stats.errors),
    }

    print("=== Load Test Report ===")
    print(f"Duration: {report['duration_seconds']} s")
    print(f"Requests: total={total} success={success} failed={failed}")
    print(f"Success rate: {report['success_rate_percent']}%")
    print(f"Throughput: rps={report['rps']} success_rps={report['success_rps']}")
    print(
        "Latency ms: "
        f"min={report['latency_ms']['min']} avg={report['latency_ms']['avg']} "
        f"p50={report['latency_ms']['p50']} p95={report['latency_ms']['p95']} "
        f"p99={report['latency_ms']['p99']} max={report['latency_ms']['max']}"
    )
    if report["status_counts"]:
        print(f"Statuses: {report['status_counts']}")
    if report["error_counts"]:
        print(f"Errors: {report['error_counts']}")

    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Simple concurrent HTTP load test")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000", help="API base URL")
    parser.add_argument("--path", default="/api/health", help="Request path")
    parser.add_argument("--method", default="GET", choices=["GET", "POST", "PATCH", "DELETE"], help="HTTP method")
    parser.add_argument("--duration", type=float, default=20.0, help="Run duration in seconds")
    parser.add_argument("--concurrency", type=int, default=50, help="Concurrent workers")
    parser.add_argument("--timeout", type=float, default=10.0, help="Request timeout in seconds")
    parser.add_argument("--warmup", type=float, default=3.0, help="Warm-up seconds before measurement")
    parser.add_argument("--expected-status", type=int, default=200, help="Expected HTTP status for success")
    parser.add_argument(
        "--min-success-rate",
        type=float,
        default=99.0,
        help="Minimum success rate percent for zero exit code",
    )
    parser.add_argument("--header", action="append", default=[], help="Header in 'Key: Value' format")
    parser.add_argument("--body-json", default="", help="JSON payload for POST/PATCH")
    parser.add_argument("--output-json", default="", help="Optional path to save JSON report")
    args = parser.parse_args()

    if args.concurrency < 1:
        raise SystemExit("concurrency must be >= 1")
    if args.duration <= 0:
        raise SystemExit("duration must be > 0")
    if args.timeout <= 0:
        raise SystemExit("timeout must be > 0")
    if args.warmup < 0:
        raise SystemExit("warmup must be >= 0")

    headers = _parse_headers(args.header)
    body: dict[str, Any] | None = None
    if args.body_json.strip():
        body = json.loads(args.body_json)

    warmup_end = time.perf_counter() + args.warmup
    if args.warmup > 0:
        warmup_stats = RunStats()
        warmup_lock = threading.Lock()
        warmup_threads = [
            threading.Thread(
                target=_worker,
                kwargs={
                    "base_url": args.base_url,
                    "path": args.path,
                    "method": args.method,
                    "headers": headers,
                    "body": body,
                    "timeout_s": args.timeout,
                    "end_at": warmup_end,
                    "expected_status": args.expected_status,
                    "stats": warmup_stats,
                    "lock": warmup_lock,
                },
                daemon=True,
            )
            for _ in range(args.concurrency)
        ]
        for thread in warmup_threads:
            thread.start()
        for thread in warmup_threads:
            thread.join()

    stats = RunStats()
    lock = threading.Lock()
    started = time.perf_counter()
    end_at = started + args.duration
    threads = [
        threading.Thread(
            target=_worker,
            kwargs={
                "base_url": args.base_url,
                "path": args.path,
                "method": args.method,
                "headers": headers,
                "body": body,
                "timeout_s": args.timeout,
                "end_at": end_at,
                "expected_status": args.expected_status,
                "stats": stats,
                "lock": lock,
            },
            daemon=True,
        )
        for _ in range(args.concurrency)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    duration_actual = max(time.perf_counter() - started, 0.001)

    report = _print_report(stats=stats, duration_s=duration_actual)
    if args.output_json.strip():
        with open(args.output_json, "w", encoding="utf-8") as file:
            json.dump(report, file, ensure_ascii=False, indent=2)

    if report["success_rate_percent"] < args.min_success_rate:
        print(
            f"FAIL: success_rate {report['success_rate_percent']}% "
            f"is below threshold {args.min_success_rate}%"
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
