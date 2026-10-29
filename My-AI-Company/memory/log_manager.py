"""
Auto-logging for every task.

Each task gets one JSON file in memory/logs/ named
<YYYYmmdd-HHMMSS>_<agent>_<task_id>.json, plus a compact line appended
to memory/logs/_index.jsonl so recent history is cheap to read.
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

LOG_DIR = Path(__file__).resolve().parent / "logs"
INDEX = LOG_DIR / "_index.jsonl"


def _ensure() -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)


def log_task(
    task_id: str,
    agent: str,
    action: str,
    status: str,
    payload=None,
    error: str | None = None,
    duration_ms: float | None = None,
) -> dict:
    """Write one task record to the per-task file and the index."""
    _ensure()
    record = {
        "task_id": task_id,
        "agent": agent,
        "action": action,
        "status": status,
        "payload": payload,
        "error": error,
        "duration_ms": duration_ms,
        "ts": datetime.now().isoformat(timespec="seconds"),
    }
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    filename = LOG_DIR / f"{stamp}_{agent}_{task_id}.json"
    filename.write_text(
        json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    with INDEX.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    return record


def recent(n: int = 30) -> list:
    """Return the last `n` task records from the index."""
    _ensure()
    if not INDEX.exists():
        return []
    lines = INDEX.read_text(encoding="utf-8").strip().splitlines()
    records = []
    for line in lines[-n:]:
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return records
