from __future__ import annotations

import os
import signal
import subprocess
import sys
import time

SERVICE_PORTS = {
    "gateway": 8000,
    "auth": 8001,
    "story": 8002,
    "payments": 8003,
}


def _spawn_service(mode: str, port: int) -> subprocess.Popen[str]:
    env = os.environ.copy()
    env["APP_MODE"] = mode
    env["PORT"] = str(port)
    env.setdefault(
        "DB_BOOTSTRAP_ON_STARTUP",
        "true" if mode in {"gateway", "monolith"} else "false",
    )
    command = [sys.executable, "run.py"]
    return subprocess.Popen(command, env=env, text=True)


def _terminate_processes(processes: list[subprocess.Popen[str]]) -> None:
    for process in processes:
        if process.poll() is None:
            process.terminate()

    deadline = time.time() + 8
    while any(process.poll() is None for process in processes) and time.time() < deadline:
        time.sleep(0.2)

    for process in processes:
        if process.poll() is None:
            process.kill()


def main() -> int:
    print("[run_services.py] Starting gateway + auth + story + payments")
    processes: list[subprocess.Popen[str]] = []
    try:
        for mode, port in SERVICE_PORTS.items():
            process = _spawn_service(mode, port)
            processes.append(process)
            print(f"[run_services.py] {mode} started on port {port} (pid={process.pid})")

        while True:
            time.sleep(0.8)
            failed = next((process for process in processes if process.poll() is not None), None)
            if failed is not None:
                print(f"[run_services.py] A service exited unexpectedly with code {failed.returncode}")
                return int(failed.returncode or 1)
    except KeyboardInterrupt:
        print("\n[run_services.py] Stopping services...")
        return 0
    finally:
        _terminate_processes(processes)


if __name__ == "__main__":
    if os.name == "nt":
        signal.signal(signal.SIGINT, signal.SIG_DFL)
    raise SystemExit(main())

